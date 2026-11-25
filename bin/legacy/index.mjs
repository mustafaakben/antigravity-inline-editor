// Cleanup for version 0.6 and earlier, which attached Edits over Antigravity's debugging port
// from a background host started by a login service. Antigravity 2.33 removed that port, so the
// plugin replaces the host; `install` and `uninstall` remove whatever the old version left behind.
import { readFile, rm, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { serviceFor } from './service/index.mjs';

// The old per-user folder: app copy, host lock, logs, and recovery drafts.
export function legacyDir({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  if (env.ANTIGRAVITY_INLINE_EDITOR_HOME) return env.ANTIGRAVITY_INLINE_EDITOR_HOME;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'antigravity-inline-editor');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'antigravity-inline-editor');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'antigravity-inline-editor');
}

async function hostPid(dir) {
  let pid;
  try { pid = Number(await readFile(join(dir, 'host.pid'), 'utf8')); } catch { return null; }
  if (!Number.isInteger(pid) || pid < 1) return null;
  try { process.kill(pid, 0); return pid; } catch (error) { return error.code === 'EPERM' ? pid : null; }
}

const exists = path => access(path).then(() => true, () => false);

// Tests set ANTIGRAVITY_INLINE_EDITOR_LEGACY=skip so they never touch this machine's login services.
const skip = () => process.env.ANTIGRAVITY_INLINE_EDITOR_LEGACY === 'skip';

export async function legacyStatus({ dir = legacyDir(), service = serviceFor() } = {}) {
  if (skip()) return { service: false, host: null, app: false };
  const state = await service.status({ home: dir }).catch(() => ({ configured: false }));
  return { service: !!state.configured, host: await hostPid(dir), app: await exists(join(dir, 'app')) };
}

// Removes the old login service, stops the old host, and deletes its app copy. Old recovery
// drafts stay unless purge is set, in case they hold edits that never reached disk.
export async function removeLegacy({ purge = false, dir = legacyDir(), service = serviceFor() } = {}) {
  if (skip()) return { found: false, service: false, host: null, app: false };
  const found = await legacyStatus({ dir, service });
  if (found.service) await service.uninstall({ home: dir }).catch(() => {});
  const pid = await hostPid(dir);
  if (pid !== null) {
    try { process.kill(pid); } catch { /* already stopped */ }
    for (let attempt = 0; attempt < 25 && await hostPid(dir) !== null; attempt++) await delay(200);
  }
  await rm(join(dir, 'app'), { recursive: true, force: true });
  await rm(join(dir, 'host.pid'), { force: true });
  if (purge) await rm(dir, { recursive: true, force: true });
  return { found: found.service || found.host !== null || found.app, ...found };
}
