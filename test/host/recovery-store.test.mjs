import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataDir, createRecoveryStore, fileUri } from '../../host/recovery-store.mjs';

const uri = 'file:///tmp/notes/draft.md';
const entry = (draft, baseline = Buffer.from('original\n').toString('base64')) =>
  ({ baseline, draft, eol: '\n', bom: false, position: { anchor: 1, head: 1, scrollTop: 0, scrollLeft: 0 } });

test('data folder per OS', () => {
  assert.equal(dataDir({ env: {}, platform: 'darwin', home: '/h' }), join('/h', 'Library', 'Application Support', 'antigravity-inline-editor'));
  assert.equal(dataDir({ env: { LOCALAPPDATA: 'C:\\L' }, platform: 'win32', home: 'C:\\U' }), join('C:\\L', 'antigravity-inline-editor'));
  assert.equal(dataDir({ env: {}, platform: 'linux', home: '/h' }), join('/h', '.local', 'share', 'antigravity-inline-editor'));
  assert.equal(dataDir({ env: { ANTIGRAVITY_INLINE_EDITOR_HOME: '/o' }, platform: 'linux', home: '/h' }), '/o');
});

test('fileUri accepts absolute file URIs only', () => {
  assert.equal(fileUri('file:///C:/Users/a/b.md'), 'file:///C:/Users/a/b.md');
  for (const bad of ['https://x/y', 'file:///a.md#frag', 'file:///a.md?q=1', 'relative.md', 42]) assert.throws(() => fileUri(bad), String(bad));
});

test('stores, reloads, and deletes drafts atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-store-'));
  try {
    const store = await createRecoveryStore(dir);
    assert.deepEqual(await store.handle({ type: 'put', uri, entry: entry('edited\n') }, 'client-a'), { ok: true });
    const saved = JSON.parse(await readFile(join(dir, 'drafts.json'), 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.entries[uri].draft, 'edited\n');
    if (process.platform !== 'win32') assert.equal((await stat(join(dir, 'drafts.json'))).mode & 0o777, 0o600);
    const reopened = await createRecoveryStore(dir);
    assert.equal(reopened.entries[uri].draft, 'edited\n');
    await reopened.handle({ type: 'delete', uri }, 'client-a');
    assert.deepEqual((await createRecoveryStore(dir)).entries, {});
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('another window cannot overwrite an active unsaved draft', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-store-'));
  try {
    const store = await createRecoveryStore(dir);
    await store.handle({ type: 'put', uri, entry: entry('window A\n') }, 'a');
    await assert.rejects(store.handle({ type: 'put', uri, entry: entry('window B\n') }, 'b'), /another app window/);
    store.release('a');
    assert.deepEqual(await store.handle({ type: 'put', uri, entry: entry('window B\n') }, 'b'), { ok: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects malformed entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-store-'));
  try {
    const store = await createRecoveryStore(dir);
    await assert.rejects(store.handle({ type: 'put', uri, entry: { draft: 'x' } }, 'a'), /Invalid recovery entry/);
    await assert.rejects(store.handle({ type: 'put', uri, entry: { ...entry('x'), baseline: '***' } }, 'a'), /encoding/);
    await assert.rejects(store.handle({ type: 'put', uri, entry: { ...entry('x'), eol: '\r' } }, 'a'), /text format/);
    await assert.rejects(store.handle({ type: 'rename', uri }, 'a'), /Invalid recovery request/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
