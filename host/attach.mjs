// Loads the Edits tab into Antigravity windows. `watch` runs as the background service: it waits
// for the app, attaches to every new or reloaded window, and serves crash-recovery drafts.
import { readFile, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, evaluate, isAppPage, APP_CHECK } from './discover.mjs';
import { createRecoveryStore, dataDir, ensurePrivateDir, MAX_PAYLOAD_BYTES } from './recovery-store.mjs';

const RUNTIME = new URL('../runtime/edits-tab.js', import.meta.url);
const BUNDLE = new URL('../dist/editor-core.bundle.js', import.meta.url);
const WATCH_INTERVAL = 1500;

// Versions come from the runtime files, so the host can never disagree with what it injects.
export function runtimeVersion(source) { return /const VERSION = '([^']+)'/.exec(source)?.[1] ?? null; }
export function coreVersion(source) { return Number(/version:\s*(\d+),\s*create/.exec(source)?.[1]) || null; }

export async function loadResources() {
  const [feature, core] = await Promise.all([readFile(RUNTIME, 'utf8'), readFile(BUNDLE, 'utf8')]);
  const version = runtimeVersion(feature), coreLevel = coreVersion(core);
  if (!version || !coreLevel) throw new Error('The runtime files are incomplete. Reinstall antigravity-inline-editor.');
  return { feature, core, version, coreLevel };
}

// Keeps only numeric, boolean, and version fields so page details never reach the terminal.
export function summary(value) {
  if (!value || typeof value !== 'object') return { result: value === undefined ? 'unavailable' : 'completed' };
  const result = {};
  for (const key of ['version', 'attached', 'editors', 'installed', 'removed', 'refused', 'skipped', 'dirty', 'recoveryPending', 'recoveryErrors']) {
    const item = value[key];
    if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) result[key] = item;
    else if (key === 'version' && typeof item === 'string' && /^[\w.-]{1,40}$/.test(item)) result[key] = item;
  }
  return Object.keys(result).length ? result : { result: 'completed' };
}

async function install(cdp, sessionId, resources, entries, clientId) {
  const state = await evaluate(cdp, sessionId, 'window.__agyEditsTab?.status() ?? null');
  if (state?.version === resources.version) return { ...state, skipped: true };
  // An older runtime may hold an unsaved draft in memory. Never replace it while dirty.
  if (state && state.dirty) return { ...state, refused: true };
  if (state && !(await evaluate(cdp, sessionId, 'window.__agyEditsTab.remove()'))?.removed) return { ...state, refused: true };
  await evaluate(cdp, sessionId,
    `window.__agyEditsRecovery=${JSON.stringify(entries)};window.__agyEditsClientId=${JSON.stringify(clientId)};true`);
  if (await evaluate(cdp, sessionId, `(window.__agyEditorCore?.version ?? 0) < ${resources.coreLevel}`)) await evaluate(cdp, sessionId, resources.core);
  return await evaluate(cdp, sessionId, resources.feature);
}

// One pass over the open windows: status, attach (without the recovery host), or remove.
export async function runOnce(action, options = {}) {
  const resources = action === 'attach' ? await loadResources() : null;
  const store = action === 'attach' ? await createRecoveryStore(options.home) : null;
  const cdp = await connect(options);
  const targets = [];
  try {
    const { targetInfos } = await cdp.call('Target.getTargets');
    for (const target of targetInfos.filter(isAppPage)) {
      let sessionId;
      try {
        ({ sessionId } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
        if (!await evaluate(cdp, sessionId, APP_CHECK)) continue;
        const value = action === 'attach' ? await install(cdp, sessionId, resources, store.entries, randomUUID())
          : action === 'remove' ? await evaluate(cdp, sessionId, 'window.__agyEditsTab?.remove() ?? ({installed:false,removed:true})')
            : await evaluate(cdp, sessionId, 'window.__agyEditsTab?.status() ?? ({installed:false})');
        targets.push(summary(value));
      } catch (error) { targets.push({ error: error.message }); }
      finally { if (sessionId) await cdp.call('Target.detachFromTarget', { sessionId }).catch(() => {}); }
    }
  } finally { cdp.close(); }
  return { app: true, windows: targets.length, targets };
}

// Ensures only one host runs per user. Stale locks from crashed processes are reclaimed.
export async function acquireLock(home = dataDir()) {
  await ensurePrivateDir(home);
  const filename = join(home, 'host.pid');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(filename, 'wx', 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => { await rm(filename, { force: true }); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw new Error('Cannot create the host lock.');
      const pid = await runningHostPid(home);
      if (pid === null) { await rm(filename, { force: true }); continue; }
      throw Object.assign(new Error(`The background host is already running (pid ${pid}).`), { code: 'ERUNNING' });
    }
  }
  throw new Error('Cannot acquire the host lock.');
}

// Returns the pid of a live host process, or null when none is running.
export async function runningHostPid(home = dataDir()) {
  let pid;
  try { pid = Number(await readFile(join(home, 'host.pid'), 'utf8')); } catch { return null; }
  if (!Number.isInteger(pid) || pid < 1) return null;
  try { process.kill(pid, 0); return pid; }
  catch (error) { return error.code === 'EPERM' ? pid : null; }
}

export async function watch(options = {}) {
  const home = options.home ?? dataDir();
  const resources = await loadResources();
  const releaseLock = await acquireLock(home);
  let store;
  try { store = await createRecoveryStore(home); }
  catch (error) { await releaseLock(); throw error; }
  let stopping = false, cdp, lastReport;
  const records = new Map();
  const stop = () => { stopping = true; cdp?.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const report = (state) => {
    const line = JSON.stringify({ time: new Date().toISOString(), ...state });
    const key = JSON.stringify(state);
    if (key !== lastReport) { console.log(line); lastReport = key; }
  };
  const release = (record) => { if (record?.clientId) store.release(record.clientId); };
  try {
    while (!stopping) {
      try {
        if (!cdp?.connected) {
          for (const record of records.values()) release(record);
          records.clear();
          cdp?.close();
          cdp = await connect(options);
          const current = cdp;
          current.onEvent((event) => {
            const record = [...records.values()].find((item) => item.sessionId === event.sessionId);
            if (!record) return;
            if (event.method === 'Runtime.executionContextsCleared') { release(record); record.clientId = null; return; }
            if (event.method !== 'Runtime.bindingCalled' || event.params.name !== '__agyEditsPersist') return;
            void (async () => {
              const clientId = record.clientId;
              let requestId, ok = false, error;
              try {
                if (!clientId || Buffer.byteLength(event.params.payload) > MAX_PAYLOAD_BYTES) throw new Error('Invalid recovery request.');
                const message = JSON.parse(event.params.payload);
                requestId = message.requestId;
                if (typeof requestId !== 'string' || requestId.length > 120) throw new Error('Invalid recovery request ID.');
                if (!await evaluate(current, record.sessionId, APP_CHECK, event.params.executionContextId)) throw new Error('Recovery requires the main app page.');
                await store.handle(message, clientId);
                ok = true;
              } catch (failure) { error = failure instanceof SyntaxError ? 'Invalid recovery JSON.' : failure.message; }
              if (typeof requestId === 'string' && requestId.length <= 120) {
                await evaluate(current, record.sessionId,
                  `window.__agyEditsPersistAck?.(${JSON.stringify(requestId)},${ok},${JSON.stringify(error ?? null)})`,
                  event.params.executionContextId).catch(() => {});
              }
            })();
          });
        }
        const { targetInfos } = await cdp.call('Target.getTargets');
        const targets = targetInfos.filter(isAppPage);
        const ids = new Set(targets.map((target) => target.targetId));
        for (const [id, record] of records) {
          if (ids.has(id)) continue;
          release(record);
          await cdp.call('Target.detachFromTarget', { sessionId: record.sessionId }).catch(() => {});
          records.delete(id);
        }
        let installed = 0, refused = 0;
        for (const target of targets) {
          let record = records.get(target.targetId);
          try {
            if (!record) {
              const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
              record = { sessionId, clientId: null };
              records.set(target.targetId, record);
              await cdp.call('Runtime.enable', {}, sessionId);
            }
            if (!await evaluate(cdp, record.sessionId, APP_CHECK)) continue;
            if (!record.clientId) {
              record.clientId = randomUUID();
              if (!record.bindingAdded) {
                await cdp.call('Runtime.addBinding', { name: '__agyEditsPersist' }, record.sessionId);
                record.bindingAdded = true;
              }
            }
            const value = await install(cdp, record.sessionId, resources, store.entries, record.clientId);
            if (value?.refused) refused++; else installed++;
          } catch {
            release(record);
            records.delete(target.targetId);
            await cdp.call('Target.detachFromTarget', { sessionId: record.sessionId }).catch(() => {});
          }
        }
        report({ connected: true, version: resources.version, windows: installed, refused });
      } catch (error) {
        report({ connected: false, waiting: error.code === 'ENOAPP' ? 'Antigravity is not running' : 'reconnecting' });
        cdp?.close();
      }
      if (!stopping) await delay(WATCH_INTERVAL);
    }
  } finally {
    for (const record of records.values()) release(record);
    cdp?.close();
    await store.flush();
    await releaseLock();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
