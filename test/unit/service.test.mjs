import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serviceFor } from '../../bin/legacy/service/index.mjs';
import { renderPlist, LABEL } from '../../bin/legacy/service/macos.mjs';
import { renderUnit, renderDesktopEntry } from '../../bin/legacy/service/linux.mjs';
import { renderLauncher, renderRegisterScript, TASK } from '../../bin/legacy/service/windows.mjs';
import { removeLegacy, legacyDir } from '../../bin/legacy/index.mjs';

const run = promisify(execFile);
const tricky = { node: '/opt/node & co/bin/node', script: '/Users/a "b"/app/bin/cli.mjs', home: '/Users/a/data' };

test('serviceFor picks one implementation per OS', () => {
  for (const platform of ['darwin', 'win32', 'linux']) assert.equal(typeof serviceFor(platform).install, 'function');
  assert.throws(() => serviceFor('aix'), /Unsupported/);
});

test('macOS LaunchAgent escapes paths and keeps the host alive', async () => {
  const plist = renderPlist({ ...tricky, logDir: '/logs' });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<string>\/opt\/node &amp; co\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/Users\/a &quot;b&quot;\/app\/bin\/cli.mjs<\/string>/);
  assert.match(plist, /<string>watch<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  if (process.platform === 'darwin') {
    const dir = await mkdtemp(join(tmpdir(), 'agy-plist-'));
    try {
      await writeFile(join(dir, 'test.plist'), plist);
      await run('/usr/bin/plutil', ['-lint', join(dir, 'test.plist')]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('Linux unit and autostart entry quote arguments', () => {
  const unit = renderUnit(tricky);
  assert.match(unit, /^ExecStart="\/opt\/node & co\/bin\/node" "\/Users\/a \\"b\\"\/app\/bin\/cli.mjs" watch$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^WantedBy=default.target$/m);
  const desktop = renderDesktopEntry(tricky);
  assert.match(desktop, /^\[Desktop Entry\]$/m);
  assert.match(desktop, /^Exec="\/opt\/node & co\/bin\/node" .* watch$/m);
});

test('Windows launcher hides the console and quotes paths', () => {
  const launcher = renderLauncher({ node: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\Users\\a b\\app\\bin\\cli.mjs', home: 'C:\\Users\\a b\\data' });
  assert.match(launcher, /shell\.Run .*, 0, True/);
  assert.ok(launcher.includes('"""C:\\Program Files\\nodejs\\node.exe"""'));
  assert.ok(launcher.includes('"""C:\\Users\\a b\\app\\bin\\cli.mjs"""'));
  const script = renderRegisterScript({ launcher: "C:\\Users\\o'brien\\launch-host.vbs" });
  assert.ok(script.includes(`-TaskName '${TASK}'`));
  assert.ok(script.includes("o''brien"));
  assert.match(script, /-AtLogOn/);
  assert.match(script, /-RunLevel Limited/);
});

// The service code only remains to remove what version 0.6 installed.
test('removeLegacy uninstalls the old service and deletes the app copy, keeping drafts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-legacy-'));
  let configured = true;
  const service = { status: async () => ({ configured }), uninstall: async () => { configured = false; } };
  try {
    await mkdir(join(dir, 'app', 'bin'), { recursive: true });
    await writeFile(join(dir, 'drafts.json'), '{}');
    const result = await removeLegacy({ dir, service });
    assert.equal(result.found, true);
    assert.equal(configured, false);
    await assert.rejects(readFile(join(dir, 'app', 'bin')));
    assert.equal(await readFile(join(dir, 'drafts.json'), 'utf8'), '{}');
    assert.equal((await removeLegacy({ dir, service })).found, false);
    await removeLegacy({ dir, service, purge: true });
    await assert.rejects(readFile(join(dir, 'drafts.json')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('legacyDir matches the folders version 0.6 used', () => {
  assert.equal(legacyDir({ env: {}, platform: 'darwin', home: '/Users/a' }), '/Users/a/Library/Application Support/antigravity-inline-editor');
  assert.equal(legacyDir({ env: { LOCALAPPDATA: 'C:\\L' }, platform: 'win32', home: 'C:\\U' }), join('C:\\L', 'antigravity-inline-editor'));
  assert.equal(legacyDir({ env: {}, platform: 'linux', home: '/home/a' }), '/home/a/.local/share/antigravity-inline-editor');
});

test('versions agree across package.json, the plugin manifest, the server, and the view', async () => {
  const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
  const pkg = JSON.parse(await read('package.json'));
  const manifest = JSON.parse(await read('plugin/plugin.json'));
  const server = /export const VERSION = '([^']+)'/.exec(await read('plugin/server.mjs'))[1];
  const view = /const VERSION = '([^']+)'/.exec(await read('src/main.js'))[1];
  assert.deepEqual([manifest.version, server, view], [pkg.version, pkg.version, pkg.version]);
});
