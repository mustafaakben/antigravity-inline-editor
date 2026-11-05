// Finds a running Antigravity desktop app and its windows. Antigravity starts Chromium with a
// dynamic remote-debugging port and records it in DevToolsActivePort inside its user-data folder.
// The file is re-read on every connection, so app restarts and port changes are picked up.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_NAME = 'Antigravity';

// Desktop renderer globals that browser guests and webviews do not have.
export const APP_CHECK = '!!(window === window.top && window.electronNative && window.nativeStorage && typeof window.extensions?.sendAuthorities === "function")';

// User-data folders to try, most specific first. ANTIGRAVITY_USER_DATA_DIR overrides discovery.
export function userDataDirCandidates({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const dirs = [];
  if (env.ANTIGRAVITY_USER_DATA_DIR) dirs.push(env.ANTIGRAVITY_USER_DATA_DIR);
  if (platform === 'darwin') dirs.push(join(home, 'Library', 'Application Support', APP_NAME));
  else if (platform === 'win32') dirs.push(join(env.APPDATA || join(home, 'AppData', 'Roaming'), APP_NAME));
  else dirs.push(join(env.XDG_CONFIG_HOME || join(home, '.config'), APP_NAME));
  return [...new Set(dirs)];
}

// Parses DevToolsActivePort: line 1 is the port, line 2 the browser WebSocket path.
export function parsePortFile(text) {
  const [portLine, path] = String(text).trim().split(/\r?\n/);
  const port = Number(portLine);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[\w-]+$/.test(path || '')) return null;
  return { port, path, url: `ws://127.0.0.1:${port}${path}` };
}

// Returns { userDataDir, port, path, url } for the first folder with a valid port file, or null.
export async function discover(options = {}) {
  for (const userDataDir of userDataDirCandidates(options)) {
    try {
      const endpoint = parsePortFile(await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8'));
      if (endpoint) return { userDataDir, ...endpoint };
    } catch { /* Missing folder or file: try the next candidate. */ }
  }
  return null;
}

// Opens a Chrome DevTools Protocol connection to the discovered endpoint.
export async function connect(options = {}) {
  const endpoint = await discover(options);
  if (!endpoint) throw Object.assign(new Error('Antigravity is not running, or its debugging port was not found.'), { code: 'ENOAPP' });
  const ws = new WebSocket(endpoint.url);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  const failPending = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('The DevTools connection closed.'));
    }
    pending.clear();
  };
  ws.addEventListener('message', ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.method) { for (const listener of listeners) listener(message); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`${request.method} failed (${message.error.code}).`));
    else request.resolve(message.result);
  });
  ws.addEventListener('close', failPending);
  ws.addEventListener('error', failPending);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Antigravity.')), 8000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Cannot connect to Antigravity DevTools.')); }, { once: true });
    });
  } catch (error) { ws.close(); throw error; }
  return {
    endpoint,
    get connected() { return ws.readyState === WebSocket.OPEN; },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 18000);
        pending.set(id, { method, resolve, reject, timer });
        try { ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
        catch { clearTimeout(timer); pending.delete(id); reject(new Error('Cannot send a DevTools request.')); }
      });
    },
    close() { ws.close(); failPending(); },
  };
}

// App windows are pages served by the local language server over https on loopback.
export function isAppPage(target) {
  if (target.type !== 'page') return false;
  try {
    const url = new URL(target.url);
    if (url.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false;
    return url.pathname === '/' || /^\/c\/[^/]+\/?$/.test(url.pathname);
  } catch { return false; }
}

export async function evaluate(cdp, sessionId, expression, contextId) {
  const response = await cdp.call('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, timeout: 15000,
    ...(contextId ? { contextId } : {}),
  }, sessionId);
  if (response.exceptionDetails) throw new Error('The feature evaluation failed in the app page.');
  return response.result?.value;
}
