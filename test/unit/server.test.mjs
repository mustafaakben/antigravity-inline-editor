import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, DraftStore, TOOLS, EXTENSIONS, UI_URI, MIME } from '../../plugin/server.mjs';

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'edits-server-'));
  try { await fn(new DraftStore(dir), dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const rpc = (handle, method, params, id = 1) => handle({ jsonrpc: '2.0', id, method, params });

test('initialize negotiates a protocol version and declares tools and resources', async () => withStore(async store => {
  const handle = createServer({ html: async () => '<html></html>', store });
  const { result } = await rpc(handle, 'initialize', { protocolVersion: '2025-06-18' });
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.deepEqual(result.capabilities, { tools: {}, resources: {} });
  assert.equal((await rpc(handle, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-11-25');
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await rpc(handle, 'nope')).error.code, -32601);
}));

test('the file viewer tool declares the MCP Apps UI and a file entrypoint', () => {
  const tool = TOOLS.find(t => t.name === 'edit_file');
  assert.equal(tool._meta.ui.resourceUri, UI_URI);
  assert.ok(UI_URI.startsWith('ui://'));
  const [entry] = tool._meta['com.google.antigravity/ui'].entrypoints;
  assert.equal(entry.type, 'file');
  assert.deepEqual(entry.extensions, EXTENSIONS);
  for (const ext of EXTENSIONS) assert.match(ext, /^\.[a-z0-9]+$/);
  assert.equal(new Set(EXTENSIONS).size, EXTENSIONS.length);
  // Types whose native preview matters stay with Antigravity.
  for (const ext of ['.html', '.htm', '.svg', '.csv', '.tsv', '.pdf', '.png']) assert.ok(!EXTENSIONS.includes(ext), ext);
  for (const t of TOOLS.filter(t => t.name !== 'edit_file')) assert.deepEqual(t._meta.ui.visibility, ['app']);
});

test('resources/read serves the view as an MCP App document', async () => withStore(async store => {
  const handle = createServer({ html: async () => '<!doctype html><p>view</p>', store });
  const { result } = await rpc(handle, 'resources/read', { uri: UI_URI });
  assert.equal(result.contents[0].mimeType, MIME);
  assert.equal(result.contents[0].text, '<!doctype html><p>view</p>');
  assert.equal((await rpc(handle, 'resources/read', { uri: 'ui://other' })).error.code, -32002);
  assert.equal((await rpc(handle, 'resources/list')).result.resources[0].uri, UI_URI);
}));

test('edit_file echoes the file it was opened with', async () => withStore(async store => {
  const handle = createServer({ html: async () => '', store });
  const file = { name: 'a.md', resourceUri: 'antigravity-file://x/a.md' };
  const { result } = await rpc(handle, 'tools/call', { name: 'edit_file', arguments: { file } });
  assert.deepEqual(result.structuredContent, { file });
  assert.match(result.content[0].text, /a\.md/);
}));

test('drafts round-trip, are private, and are cleared', async () => withStore(async (store, dir) => {
  const handle = createServer({ html: async () => '', store });
  const call = (name, args) => rpc(handle, 'tools/call', { name, arguments: args }).then(r => r.result);
  assert.equal((await call('load_draft', { name: 'a.md', baseHash: 'h-1' })).structuredContent.draft, null);
  await call('save_draft', { name: 'a.md', baseHash: 'h-1', draft: 'text', position: { anchor: 2, head: 2, bogus: 'x' } });
  const { draft } = (await call('load_draft', { name: 'a.md', baseHash: 'h-1' })).structuredContent;
  assert.equal(draft.draft, 'text');
  assert.deepEqual(draft.position, { anchor: 2, head: 2 });
  assert.equal((await call('load_draft', { name: 'a.md', baseHash: 'h-2' })).structuredContent.draft, null);
  if (process.platform !== 'win32') assert.equal((await stat(join(dir, 'drafts.json'))).mode & 0o777, 0o600);
  await call('clear_draft', { name: 'a.md', baseHash: 'h-1' });
  await assert.rejects(readFile(join(dir, 'drafts.json')));
}));

test('invalid draft arguments are reported as tool errors', async () => withStore(async store => {
  const handle = createServer({ html: async () => '', store });
  const { result } = await rpc(handle, 'tools/call', { name: 'save_draft', arguments: { name: 'a', baseHash: '../x', draft: '' } });
  assert.equal(result.isError, true);
  assert.equal((await rpc(handle, 'tools/call', { name: 'rm_rf', arguments: {} })).error.code, -32602);
}));

test('concurrent saves keep every draft', async () => withStore(async store => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(`f${i}.md`, 'h', `d${i}`)));
  for (let i = 0; i < 20; i++) assert.equal((await store.load(`f${i}.md`, 'h')).draft, `d${i}`);
}));
