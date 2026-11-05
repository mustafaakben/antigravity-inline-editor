import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { userDataDirCandidates, parsePortFile, discover, isAppPage } from '../../host/discover.mjs';

test('default user-data folder per OS', () => {
  assert.deepEqual(userDataDirCandidates({ env: {}, platform: 'darwin', home: '/h' }), [join('/h', 'Library', 'Application Support', 'Antigravity')]);
  assert.deepEqual(userDataDirCandidates({ env: { APPDATA: 'C:\\U\\AppData\\Roaming' }, platform: 'win32', home: 'C:\\U' }), [join('C:\\U\\AppData\\Roaming', 'Antigravity')]);
  assert.deepEqual(userDataDirCandidates({ env: {}, platform: 'linux', home: '/h' }), [join('/h', '.config', 'Antigravity')]);
  assert.deepEqual(userDataDirCandidates({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', home: '/h' }), [join('/x', 'Antigravity')]);
});

test('ANTIGRAVITY_USER_DATA_DIR is tried first', () => {
  const dirs = userDataDirCandidates({ env: { ANTIGRAVITY_USER_DATA_DIR: '/custom' }, platform: 'linux', home: '/h' });
  assert.equal(dirs[0], '/custom');
  assert.equal(dirs.length, 2);
});

test('parsePortFile accepts valid files and rejects bad ones', () => {
  assert.deepEqual(parsePortFile('58131\n/devtools/browser/abc-123\n'), { port: 58131, path: '/devtools/browser/abc-123', url: 'ws://127.0.0.1:58131/devtools/browser/abc-123' });
  assert.equal(parsePortFile('58131\r\n/devtools/browser/abc').port, 58131);
  for (const bad of ['', 'abc\n/devtools/browser/x', '70000\n/devtools/browser/x', '9222\n/other/path', '9222']) assert.equal(parsePortFile(bad), null, bad);
});

test('discover reads DevToolsActivePort from the override folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-discover-'));
  try {
    assert.equal(await discover({ env: { ANTIGRAVITY_USER_DATA_DIR: dir }, platform: 'linux', home: dir }), null);
    await writeFile(join(dir, 'DevToolsActivePort'), '9333\n/devtools/browser/test-id\n');
    const found = await discover({ env: { ANTIGRAVITY_USER_DATA_DIR: dir }, platform: 'linux', home: dir });
    assert.equal(found.userDataDir, dir);
    assert.equal(found.port, 9333);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('isAppPage keeps only local app windows', () => {
  assert.ok(isAppPage({ type: 'page', url: 'https://127.0.0.1:58142/' }));
  assert.ok(isAppPage({ type: 'page', url: 'https://127.0.0.1:58142/c/470e2802?project=x' }));
  assert.ok(!isAppPage({ type: 'page', url: 'https://example.com/' }));
  assert.ok(!isAppPage({ type: 'page', url: 'http://127.0.0.1:58142/' }));
  assert.ok(!isAppPage({ type: 'iframe', url: 'https://127.0.0.1:58142/' }));
  assert.ok(!isAppPage({ type: 'page', url: 'https://127.0.0.1:58142/settings/x' }));
  assert.ok(!isAppPage({ type: 'page', url: 'not a url' }));
});
