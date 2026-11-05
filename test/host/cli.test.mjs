import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url));
const exec = (args, env = {}) => run(process.execPath, [cli, ...args], { env: { ...process.env, ...env } });

test('help and version', async () => {
  assert.match((await exec([])).stdout, /Usage: antigravity-inline-editor <command>/);
  assert.match((await exec(['--version'])).stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('unknown commands and options fail clearly', async () => {
  await assert.rejects(exec(['bogus']), (error) => error.code === 1 && /Unknown command/.test(error.stderr));
  await assert.rejects(exec(['status', '--force']), (error) => error.code === 1 && /Unknown option/.test(error.stderr));
});

test('doctor explains when Antigravity is not found', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-cli-'));
  try {
    // Point discovery at an empty folder; the default folder is still searched, so only check shape.
    const { stdout } = await exec(['doctor'], { ANTIGRAVITY_USER_DATA_DIR: dir, ANTIGRAVITY_INLINE_EDITOR_HOME: join(dir, 'home') });
    const report = JSON.parse(stdout);
    assert.equal(report.discovery.searched[0], dir);
    assert.equal(report.dataDir, join(dir, 'home'));
    assert.equal(report.node.ok, true);
    assert.match(report.package.runtime, /^\d+\.\d+\.\d+$/);
    if (!report.discovery.found) assert.match(report.discovery.hint, /ANTIGRAVITY_USER_DATA_DIR/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
