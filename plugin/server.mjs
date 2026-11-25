#!/usr/bin/env node
// Edits: an MCP Apps server for Antigravity. It registers a custom file viewer (an editor) for
// text and code files and stores crash-recovery drafts. Antigravity itself reads and writes the
// edited file for the view, so this server never touches workspace files.
// Zero dependencies: speaks MCP (JSON-RPC 2.0, one message per line) over stdio.
import { readFile, writeFile, mkdir, rename, chmod, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.7.0';
export const UI_URI = 'ui://inline-editor/editor.html';
export const MIME = 'text/html;profile=mcp-app';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const HERE = dirname(fileURLToPath(import.meta.url));

// File types Edits opens. Antigravity matches by extension only, and a claimed type no longer gets
// the app's own Preview and Raw views. So Edits leaves out types whose native preview matters
// (HTML, SVG, CSV, TSV) and brings its own Preview for Markdown.
export const EXTENSIONS = [
  '.md', '.markdown', '.mdx', '.txt', '.text', '.log',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.json', '.jsonc', '.json5', '.py', '.pyw', '.css', '.scss', '.less', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.sh', '.bash', '.zsh', '.ps1', '.bat',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php',
  '.lua', '.r', '.sql', '.tex', '.bib', '.rst', '.adoc',
];

const MAX_DRAFT_BYTES = 10 * 1024 * 1024;
const MAX_DRAFTS = 200;
const DRAFT_TTL = 30 * 24 * 60 * 60 * 1000;

const app = visibility => ({ ui: { visibility } });
export const TOOLS = [
  {
    name: 'edit_file',
    title: 'Edits',
    description: 'Opens a file in the Edits editor. Antigravity calls this when you open a supported file in the side panel.',
    inputSchema: { type: 'object', properties: { file: { type: 'object', properties: {
      name: { type: 'string' }, resourceUri: { type: 'string' } } } } },
    _meta: {
      ui: { resourceUri: UI_URI, visibility: ['app'] },
      'com.google.antigravity/ui': { entrypoints: [{ type: 'file', title: 'Edits', extensions: EXTENSIONS }] },
    },
  },
  {
    name: 'load_draft',
    description: 'Returns the stored recovery draft for a file version, if any.',
    inputSchema: { type: 'object', required: ['name', 'baseHash'], properties: {
      name: { type: 'string' }, baseHash: { type: 'string' } } },
    _meta: app(['app']),
  },
  {
    name: 'save_draft',
    description: 'Stores a recovery draft for unsaved edits.',
    inputSchema: { type: 'object', required: ['name', 'baseHash', 'draft'], properties: {
      name: { type: 'string' }, baseHash: { type: 'string' }, draft: { type: 'string' },
      position: { type: 'object' } } },
    _meta: app(['app']),
  },
  {
    name: 'clear_draft',
    description: 'Deletes the recovery draft for a file version.',
    inputSchema: { type: 'object', required: ['name', 'baseHash'], properties: {
      name: { type: 'string' }, baseHash: { type: 'string' } } },
    _meta: app(['app']),
  },
];

export function dataDir(env = process.env) {
  if (env.PLUGIN_DATA) return env.PLUGIN_DATA;
  return join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'inline-editor');
}

// Recovery drafts, keyed by file name and a hash of the file version they were based on, because
// file views receive an opaque per-view URI rather than the file's path.
export class DraftStore {
  constructor(directory) { this.file = join(directory, 'drafts.json'); this.directory = directory; this.queue = Promise.resolve(); }
  async #read() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      return value && typeof value === 'object' && value.drafts && typeof value.drafts === 'object' ? value.drafts : {};
    } catch { return {}; }
  }
  async #write(drafts) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, drafts }), { mode: 0o600 });
    await chmod(temp, 0o600).catch(() => {});
    await rename(temp, this.file);
  }
  #exclusive(task) { const run = this.queue.then(task, task); this.queue = run.catch(() => {}); return run; }
  static key(name, baseHash) {
    if (typeof name !== 'string' || !name || name.length > 1024) throw new Error('Invalid file name.');
    if (typeof baseHash !== 'string' || !/^[\w-]{1,128}$/.test(baseHash)) throw new Error('Invalid file version.');
    return `${name}\u0000${baseHash}`;
  }
  load(name, baseHash) {
    return this.#exclusive(async () => (await this.#read())[DraftStore.key(name, baseHash)] ?? null);
  }
  save(name, baseHash, draft, position = {}, now = Date.now()) {
    const key = DraftStore.key(name, baseHash);
    if (typeof draft !== 'string' || Buffer.byteLength(draft) > MAX_DRAFT_BYTES) throw new Error('Draft exceeds 10 MB.');
    const clean = {};
    for (const field of ['anchor', 'head', 'scrollAnchor', 'scrollOffset', 'scrollTop', 'scrollLeft']) {
      const number = position?.[field];
      if (Number.isFinite(number) && Math.abs(number) <= 1e9) clean[field] = number;
    }
    return this.#exclusive(async () => {
      const drafts = await this.#read();
      drafts[key] = { name, baseHash, draft, position: clean, updatedAt: now };
      const kept = Object.entries(drafts).filter(([, entry]) => now - (entry?.updatedAt ?? 0) < DRAFT_TTL)
        .sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, MAX_DRAFTS);
      await this.#write(Object.fromEntries(kept));
      return true;
    });
  }
  clear(name, baseHash) {
    const key = DraftStore.key(name, baseHash);
    return this.#exclusive(async () => {
      const drafts = await this.#read();
      if (!(key in drafts)) return false;
      delete drafts[key];
      if (Object.keys(drafts).length) await this.#write(drafts); else await rm(this.file, { force: true });
      return true;
    });
  }
}

const result = (structuredContent, text) => ({ content: [{ type: 'text', text }], structuredContent });

export function createServer({ html, store }) {
  const tools = {
    edit_file: async ({ file } = {}) => result({ file: file ?? null },
      file?.name ? `Opened ${file.name} in Edits.` : 'Edits is open. Open a text file from the side panel to edit it.'),
    load_draft: async ({ name, baseHash }) => result({ draft: await store.load(name, baseHash) }, 'Draft loaded.'),
    save_draft: async ({ name, baseHash, draft, position }) => result({ saved: await store.save(name, baseHash, draft, position) }, 'Draft stored.'),
    clear_draft: async ({ name, baseHash }) => result({ cleared: await store.clear(name, baseHash) }, 'Draft cleared.'),
  };
  // The only outside resource: Google Sans, from the same address Antigravity loads it from, so
  // the view's text matches the app when the user picked that font. No other network access.
  const resource = { uri: UI_URI, name: 'Edits', mimeType: MIME, _meta: { ui: { prefersBorder: false,
    csp: { resourceDomains: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'] } } } };
  const methods = {
    initialize: ({ protocolVersion } = {}) => ({
      protocolVersion: PROTOCOL_VERSIONS.includes(protocolVersion) ? protocolVersion : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'inline-editor', title: 'Edits', version: VERSION },
    }),
    ping: () => ({}),
    'tools/list': () => ({ tools: TOOLS }),
    'tools/call': async ({ name, arguments: args } = {}) => {
      if (!Object.hasOwn(tools, name)) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
      try { return await tools[name](args ?? {}); }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    },
    'resources/list': () => ({ resources: [resource] }),
    'resources/templates/list': () => ({ resourceTemplates: [] }),
    'resources/read': async ({ uri } = {}) => {
      if (uri !== UI_URI) throw Object.assign(new Error(`Unknown resource: ${uri}`), { code: -32002 });
      return { contents: [{ ...resource, text: await html() }] };
    },
  };
  // Returns the response for one JSON-RPC message, or null for notifications.
  return async function handle(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } };
    }
    const { id, method, params } = message;
    if (id === undefined || id === null) return null;
    if (!Object.hasOwn(methods, method)) return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    try { return { jsonrpc: '2.0', id, result: await methods[method](params) }; }
    catch (error) { return { jsonrpc: '2.0', id, error: { code: error.code ?? -32603, message: error.message } }; }
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  // INLINE_EDITOR_HTML lets a developer point at a fresh build; reopening the view picks it up.
  const htmlPath = process.env.INLINE_EDITOR_HTML || join(HERE, 'editor.html');
  const handle = createServer({ html: () => readFile(htmlPath, 'utf8'), store: new DraftStore(dataDir()) });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set();
  lines.on('line', line => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }) + '\n'); return; }
    const task = handle(message).then(response => { if (response) process.stdout.write(JSON.stringify(response) + '\n'); });
    pending.add(task); task.finally(() => pending.delete(task));
  });
  // Finish in-flight replies (such as a draft being written) before exiting.
  lines.on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
}
