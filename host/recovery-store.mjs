// Crash-recovery drafts. The Edits tab sends each pending draft here over a DevTools binding, and
// the host stores it atomically in drafts.json (owner-only permissions) inside the data folder.
// Recovery never writes the edited document itself; autosave does that inside the app.
import { readFile, mkdir, chmod, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_ENTRY_BYTES / 3);

// Per-user data folder: the installed app copy, recovery drafts, logs, and the host lock.
export function dataDir({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  if (env.ANTIGRAVITY_INLINE_EDITOR_HOME) return env.ANTIGRAVITY_INLINE_EDITOR_HOME;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'antigravity-inline-editor');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'antigravity-inline-editor');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'antigravity-inline-editor');
}

export async function ensurePrivateDir(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

export function fileUri(value) {
  if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid recovery file URI.');
  let uri;
  try { uri = new URL(value); } catch { throw new Error('Invalid recovery file URI.'); }
  if (uri.protocol !== 'file:' || uri.search || uri.hash || uri.username || uri.password || !uri.pathname.startsWith('/')) {
    throw new Error('Recovery requires an absolute file URI.');
  }
  return uri.href;
}

export function recoveryEntry(value, clientId) {
  if (!value || typeof value !== 'object' || typeof value.baseline !== 'string' || typeof value.draft !== 'string') {
    throw new Error('Invalid recovery entry.');
  }
  if (Buffer.byteLength(value.draft, 'utf8') > MAX_ENTRY_BYTES || value.baseline.length > MAX_BASE64_LENGTH) {
    throw new Error('Recovery document exceeds 2 MB.');
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_PAYLOAD_BYTES) throw new Error('Recovery payload exceeds 16 MB.');
  if (value.baseline.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.baseline)) {
    throw new Error('Invalid recovery baseline encoding.');
  }
  const baseline = Buffer.from(value.baseline, 'base64');
  if (baseline.length > MAX_ENTRY_BYTES) throw new Error('Recovery document exceeds 2 MB.');
  if (baseline.toString('base64') !== value.baseline) throw new Error('Invalid recovery baseline encoding.');
  if (!['\n', '\r\n'].includes(value.eol) || typeof value.bom !== 'boolean') throw new Error('Invalid recovery text format.');
  const position = {};
  for (const key of ['anchor', 'head', 'scrollTop', 'scrollLeft']) {
    const number = value.position?.[key] ?? 0;
    if (!Number.isFinite(number) || number < 0 || number > 1000000000) throw new Error('Invalid editor position.');
    position[key] = key === 'anchor' || key === 'head' ? Math.min(Math.floor(number), value.draft.length) : number;
  }
  if (value.position?.scrollAnchor !== undefined) {
    const anchor = value.position.scrollAnchor;
    if (!Number.isInteger(anchor) || anchor < 0) throw new Error('Invalid scroll anchor.');
    position.scrollAnchor = Math.min(anchor, value.draft.length);
  }
  if (value.position?.scrollOffset !== undefined) {
    const offset = value.position.scrollOffset;
    if (!Number.isFinite(offset) || Math.abs(offset) > 10000000) throw new Error('Invalid scroll offset.');
    position.scrollOffset = offset;
  }
  return {
    baseline: value.baseline, draft: value.draft, eol: value.eol, bom: value.bom,
    position, clientId, lastUpdated: Date.now(),
  };
}

function dirty(entry) {
  return entry.draft !== Buffer.from(entry.baseline, 'base64').toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

// The URI is only a map key here. Recovery never writes the document itself.
export async function createRecoveryStore(directory = dataDir()) {
  await ensurePrivateDir(directory);
  const filename = join(directory, 'drafts.json');
  const entries = Object.create(null);
  try {
    const stored = JSON.parse(await readFile(filename, 'utf8'));
    if (stored.version !== 1 || !stored.entries || typeof stored.entries !== 'object' || Array.isArray(stored.entries)) {
      throw new Error('Invalid recovery store.');
    }
    for (const [uri, entry] of Object.entries(stored.entries)) {
      const validated = recoveryEntry(entry, typeof entry.clientId === 'string' ? entry.clientId.slice(0, 200) : 'recovered');
      entries[fileUri(uri)] = { ...validated, lastUpdated: Number.isFinite(entry.lastUpdated) ? entry.lastUpdated : validated.lastUpdated };
    }
    await chmod(filename, 0o600);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Recovery store cannot be read. Preserve drafts.json and inspect it before restarting.');
  }
  let queue = Promise.resolve();
  const owners = new Map();
  const retired = new Set();
  return {
    get entries() { return structuredClone(entries); },
    release(clientId) {
      retired.add(clientId);
      for (const [uri, owner] of owners) if (owner === clientId) owners.delete(uri);
    },
    handle(message, clientId) {
      const operation = queue.then(async () => {
        if (!message || !['put', 'delete'].includes(message.type) || typeof clientId !== 'string' || clientId.length > 200) {
          throw new Error('Invalid recovery request.');
        }
        if (retired.has(clientId)) throw new Error('Recovery page changed before the draft was stored.');
        const uri = fileUri(message.uri);
        const owner = owners.get(uri);
        if (owner && owner !== clientId && entries[uri] && dirty(entries[uri]) &&
          !(message.type === 'put' && message.entry?.draft === entries[uri].draft)) {
          throw new Error('Draft is active in another app window.');
        }
        const next = { ...entries };
        if (message.type === 'delete') delete next[uri];
        else next[uri] = recoveryEntry(message.entry, clientId);
        const temporary = join(directory, `.drafts-${process.pid}-${randomUUID()}.tmp`);
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(JSON.stringify({ version: 1, entries: next }), 'utf8');
            await handle.sync();
          } finally { await handle.close(); }
          await rename(temporary, filename);
        } catch {
          throw new Error('Recovery storage write failed.');
        } finally { await rm(temporary, { force: true }).catch(() => {}); }
        if (next[uri]) entries[uri] = next[uri];
        else delete entries[uri];
        if (next[uri] && dirty(next[uri]) && !retired.has(clientId)) owners.set(uri, owner && !retired.has(owner) ? owner : clientId);
        else owners.delete(uri);
        return { ok: true };
      });
      queue = operation.catch(() => {});
      return operation;
    },
    async flush() { await queue; },
  };
}
