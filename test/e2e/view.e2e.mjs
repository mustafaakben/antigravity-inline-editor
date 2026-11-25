// End-to-end test of the Edits view in headless Chrome, against a mock MCP Apps host
// (harness.html) and the real plugin server. Run: npm run test:e2e
// Set CHROME_PATH if Chrome is not in a standard location; the test is skipped if none is found.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const CHROMES = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
async function findChrome() {
  for (const path of CHROMES) { try { await access(path); return path; } catch { /* next */ } }
  return null;
}

const chromePath = await findChrome();
const b64 = text => Buffer.from(text, 'utf8').toString('base64');
const unb64 = text => Buffer.from(text, 'base64').toString('utf8');
let chrome, http, mcp, profile, page, data;

// Plugin server over stdio, used by the harness for tools/call.
function startServer(dir) {
  const child = spawn(process.execPath, [join(root, 'plugin/server.mjs')], { env: { ...process.env, PLUGIN_DATA: dir }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map(); let next = 0;
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line); waiting.get(message.id)?.(message); waiting.delete(message.id);
  });
  return { child, call: message => new Promise(resolve => { const id = ++next; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ ...message, id }) + '\n'); }) };
}

async function cdpConnect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, m => m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return {
    call, close: () => ws.close(),
    async eval(expression) {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
  };
}

// Expressions evaluated in the harness page; `view` is the editor frame's document.
const V = 'document.getElementById("view").contentDocument';
const waitFor = async (expression, timeout = 6000) => {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { last = await page.eval(expression).catch(e => e.message); if (last === true) return; await delay(100); }
  throw new Error(`Timed out waiting for ${expression} (last: ${JSON.stringify(last)})`);
};
const status = () => page.eval(`${V}.getElementById('status').textContent`);
const editorText = () => page.eval(`[...${V}.querySelectorAll('.cm-line')].map(l => l.textContent).join('\\n')`);
const disk = () => page.eval('host.disk.get(host.file.resourceUri)').then(unb64);
// Waits until the reloaded frame (not the previous one) has loaded its file.
const waitForFreshView = () => waitFor(`(() => { const w = document.getElementById('view').contentWindow;
  return !w.__stale && w.document.getElementById('edits')?.dataset.ready === 'true'; })()`);
async function openFile(name, text, options = {}) {
  await page.eval(`host.canWrite = ${options.canWrite ?? true}; host.failWrites = false; host.file = ${JSON.stringify({ name, resourceUri: `antigravity-file://view-${Date.now()}/${name}` })};
    host.disk.set(host.file.resourceUri, ${JSON.stringify(Buffer.from(text, 'utf8').toString('base64'))}); host.context = null;
    document.getElementById('view').contentWindow.__stale = true; host.reload(); true`);
  await waitForFreshView();
}
async function click(selector) {
  const box = await page.eval(`(() => { const f = document.getElementById('view').getBoundingClientRect();
    const r = ${V}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: f.left + r.left + Math.min(r.width / 2, 20), y: f.top + r.top + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased'])
    await page.call('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
}
const type = text => page.call('Input.insertText', { text });
async function key(keyName, code, modifiers = 0) {
  for (const t of ['keyDown', 'keyUp']) await page.call('Input.dispatchKeyEvent', { type: t, key: keyName, code, modifiers, windowsVirtualKeyCode: keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : undefined });
}
const MOD = process.platform === 'darwin' ? 4 : 2; // Meta on macOS, Ctrl elsewhere.

before(async () => {
  if (!chromePath) return;
  data = await mkdtemp(join(tmpdir(), 'edits-e2e-data-'));
  profile = await mkdtemp(join(tmpdir(), 'edits-e2e-chrome-'));
  mcp = startServer(data);
  const editorHtml = await readFile(join(root, 'plugin/editor.html'));
  const harness = await readFile(join(root, 'test/e2e/harness.html'));
  http = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/mcp') {
      let body = ''; for await (const chunk of req) body += chunk;
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(await mcp.call(JSON.parse(body))));
    }
    res.setHeader('content-type', 'text/html');
    res.end(req.url.startsWith('/editor.html') ? editorHtml : harness);
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = 9300 + Math.floor(Math.random() * 500);
  chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=900,700', `http://127.0.0.1:${http.address().port}/`], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !page; i++) { try { page = await cdpConnect(port); } catch { await delay(200); } }
  await waitFor('!!window.host');
});

after(async () => {
  page?.close(); chrome?.kill(); mcp?.child.kill(); http?.close();
  await delay(300);
  for (const dir of [profile, data]) if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

// Locally the suite skips without Chrome; in CI a missing browser is a failure, not a green run.
if (!chromePath && process.env.CI) throw new Error('Chrome not found in CI. Set CHROME_PATH.');
const e2e = (name, fn) => test(name, { skip: !chromePath && 'Chrome not found (set CHROME_PATH)' }, fn);

e2e('opens the file the host passes and shows it as saved', async () => {
  await openFile('notes.txt', '# Title\n\nHello world\n');
  assert.equal(await editorText(), '# Title\n\nHello world\n');
  assert.equal(await status(), 'Saved');
  const init = await page.eval(`host.log.find(m => m.method === 'ui/initialize').params.appInfo.name`);
  assert.equal(init, 'Edits');
});

e2e('autosaves typed text and verifies it on disk', async () => {
  await openFile('notes.txt', 'alpha\n');
  await click('.cm-line');
  await key('End', 'End');
  await type(' beta');
  await waitFor(`host.disk.get(host.file.resourceUri) === ${JSON.stringify(b64('alpha beta\n'))}`);
  await waitFor(`${V}.getElementById('status').textContent === 'Saved'`);
});

e2e('keeps CRLF line endings and a byte order mark', async () => {
  await openFile('win.txt', '\ufeffone\r\ntwo\r\n');
  await click('.cm-line');
  await key('End', 'End');
  await type('!');
  await waitFor(`host.disk.get(host.file.resourceUri) === ${JSON.stringify(b64('\ufeffone!\r\ntwo\r\n'))}`);
});

e2e('picks up outside changes while there are no pending edits', async () => {
  await openFile('notes.txt', 'first\n');
  await page.eval(`host.disk.set(host.file.resourceUri, ${JSON.stringify(b64('changed by agent\n'))}); true`);
  await waitFor(`${V}.querySelector('.cm-line').textContent === 'changed by agent'`, 5000);
  assert.match(await page.eval(`${V}.getElementById('hint').textContent`), /Updated with changes made outside Edits/);
});

e2e('detects a conflict and keeps the user version on request', async () => {
  await openFile('notes.txt', 'base\n');
  await click('.cm-line');
  await key('End', 'End');
  await type(' mine');
  await page.eval(`host.disk.set(host.file.resourceUri, ${JSON.stringify(b64('theirs\n'))}); true`);
  await waitFor(`!${V}.getElementById('conflict').hidden`);
  assert.match(await status(), /changed on disk/);
  await click('#keep-mine');
  await waitFor(`host.disk.get(host.file.resourceUri) === ${JSON.stringify(b64('base mine\n'))}`);
});

e2e('undo after an autosave writes the earlier text back', async () => {
  await openFile('notes.txt', 'start\n');
  await click('.cm-line');
  await key('End', 'End');
  await type(' extra');
  await waitFor(`host.disk.get(host.file.resourceUri) === ${JSON.stringify(b64('start extra\n'))}`);
  await click('#undo');
  await waitFor(`host.disk.get(host.file.resourceUri) === ${JSON.stringify(b64('start\n'))}`);
});

e2e('opens find with the keyboard shortcut', async () => {
  await openFile('notes.txt', 'needle hay needle\n');
  await click('.cm-line');
  await key('f', 'KeyF', MOD);
  await waitFor(`!!${V}.querySelector('.edits-find input[aria-label=Find]')`);
  await type('needle');
  await waitFor(`${V}.querySelector('.edits-find-count').textContent.endsWith('of 2')`);
});

e2e('Quote attaches the selection as model context', async () => {
  await openFile('notes.txt', 'line one\nline two\n');
  await click('.cm-line');
  await key('Home', 'Home');
  await key('End', 'End', 8); // Shift+End selects the first line.
  await waitFor(`!${V}.getElementById('selection').hidden`);
  await click('#quote');
  await waitFor('!!host.context');
  const text = await page.eval('host.context.content[0].text');
  assert.match(text, /<quote file="notes.txt" lines="1">/);
  assert.match(text, /<selection>line one<\/selection>/);
  assert.equal(await page.eval(`${V}.getElementById('attached').hidden`), false);
});

e2e('restores unsaved edits after the view reloads', async () => {
  await openFile('draft.txt', 'saved text\n');
  await page.eval('host.failWrites = true; true');
  await click('.cm-line');
  await key('End', 'End');
  await type(' unsaved');
  await waitFor(`${V}.getElementById('status').textContent.includes('Retrying')`);
  await delay(800); // Let the recovery draft reach the server.
  await page.eval(`host.failWrites = false; document.getElementById('view').contentWindow.__stale = true; host.reload(); true`);
  await waitForFreshView();
  assert.equal(await editorText(), 'saved text unsaved\n');
  assert.equal(await status(), 'Restored unsaved edits');
  // Restored drafts are matched by name and contents, so they wait for the user before writing.
  await delay(1500);
  assert.equal(await disk(), 'saved text\n');
  await click('#save-restored');
  await waitFor(`host.disk.get(host.file.resourceUri) === ${JSON.stringify(b64('saved text unsaved\n'))}`);
});

e2e('a restored draft can be discarded', async () => {
  await openFile('discard.txt', 'kept\n');
  await page.eval('host.failWrites = true; true');
  await click('.cm-line');
  await key('End', 'End');
  await type(' lost');
  await waitFor(`${V}.getElementById('status').textContent.includes('Retrying')`);
  await delay(800);
  await page.eval(`host.failWrites = false; document.getElementById('view').contentWindow.__stale = true; host.reload(); true`);
  await waitForFreshView();
  await click('#discard-restored');
  await waitFor(`${V}.querySelector('.cm-line').textContent === 'kept'`);
  await page.eval(`document.getElementById('view').contentWindow.__stale = true; host.reload(); true`);
  await waitForFreshView();
  assert.equal(await status(), 'Saved', 'the discarded draft is gone');
  assert.equal(await disk(), 'kept\n');
});

e2e('Comment attaches the selection and the note', async () => {
  await openFile('notes.txt', 'alpha\nbeta\n');
  await click('.cm-line');
  await key('Home', 'Home');
  await key('End', 'End', 8);
  await waitFor(`!${V}.getElementById('selection').hidden`);
  await click('#comment');
  await waitFor(`!${V}.getElementById('composer').hidden`);
  await type('Rename this');
  await click('#composer-submit');
  await waitFor('!!host.context');
  const text = await page.eval('host.context.content[0].text');
  assert.match(text, /<comment file="notes.txt" lines="1">/);
  assert.match(text, /<note>Rename this<\/note>/);
  await click('#clear-attached');
  await waitFor('host.context.content.length === 0');
});

e2e('Markdown opens in Preview and switches to Edit', async () => {
  await openFile('readme.md', '# Hello\n\n- [x] done\n- [ ] todo\n\n<script>parent.pwned = 1</script>\n\n[site](https://example.com)\n');
  assert.equal(await page.eval(`${V}.getElementById('edits').dataset.mode`), 'preview');
  assert.equal(await page.eval(`${V}.querySelector('#preview h1').textContent`), 'Hello');
  // Visible, not just present: the preview fills the space and the editor is hidden.
  assert.ok(await page.eval(`${V}.getElementById('preview').getBoundingClientRect().height`) > 300);
  assert.ok(await page.eval(`${V}.querySelector('#preview h1').getBoundingClientRect().height`) > 0);
  assert.equal(await page.eval(`${V}.getElementById('code').getBoundingClientRect().height`), 0);
  assert.equal(await page.eval(`${V}.querySelectorAll('#preview input[type=checkbox]').length`), 2);
  assert.equal(await page.eval(`${V}.querySelector('#preview script')`), null, 'raw HTML is escaped');
  await click('#mode-edit');
  await waitFor(`${V}.getElementById('edits').dataset.mode === 'edit'`);
  await click('.cm-line');
  await key('End', 'End');
  await type(' world');
  await waitFor(`host.disk.get(host.file.resourceUri) === ${JSON.stringify(b64('# Hello world\n\n- [x] done\n- [ ] todo\n\n<script>parent.pwned = 1</script>\n\n[site](https://example.com)\n'))}`);
  await click('#mode-preview');
  await waitFor(`${V}.querySelector('#preview h1')?.textContent === 'Hello world'`);
  assert.equal(await page.eval('window.pwned'), undefined);
});

e2e('Preview follows outside changes', async () => {
  await openFile('live.md', '# One\n');
  await page.eval(`host.disk.set(host.file.resourceUri, ${JSON.stringify(b64('# Two\n'))}); true`);
  await waitFor(`${V}.querySelector('#preview h1')?.textContent === 'Two'`, 5000);
});

e2e('is read only when the host does not offer writes', async () => {
  await openFile('notes.txt', 'locked\n', { canWrite: false });
  assert.equal(await status(), 'Read only');
  await click('.cm-line');
  await type('x');
  await delay(1200);
  assert.equal(await disk(), 'locked\n');
});
