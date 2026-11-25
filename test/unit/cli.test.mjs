import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { supportsMcpApps } from '../../bin/cli.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url));
const exec = (args, env = {}) => run(process.execPath, [cli, ...args],
  { env: { ...process.env, ANTIGRAVITY_INLINE_EDITOR_LEGACY: 'skip', ...env } });
const exists = path => access(path).then(() => true, () => false);

test('help and version', async () => {
  assert.match((await exec([])).stdout, /Usage: antigravity-inline-editor <command>/);
  assert.match((await exec(['--version'])).stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('unknown commands and options fail clearly', async () => {
  await assert.rejects(exec(['bogus']), error => error.code === 1 && /Unknown command/.test(error.stderr));
  await assert.rejects(exec(['status', '--force']), error => error.code === 1 && /Unknown option/.test(error.stderr));
});

test('install copies the plugin, reinstall replaces it, uninstall removes it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-cli-'));
  const env = { ANTIGRAVITY_PLUGINS_DIR: join(dir, 'plugins'), ANTIGRAVITY_PLUGIN_DATA_DIR: join(dir, 'data') };
  const target = join(dir, 'plugins', 'inline-editor');
  try {
    await exec(['install'], env);
    await writeFile(join(target, 'stale.txt'), 'old');
    const { stdout } = await exec(['install'], env);
    assert.equal(JSON.parse(stdout.slice(0, stdout.lastIndexOf('}') + 1)).plugin.installed, true);
    for (const file of ['plugin.json', 'mcp_config.json', 'server.mjs', 'editor.html', 'assets/logo.svg'])
      assert.ok(await exists(join(target, file)), file);
    assert.equal(await exists(join(target, 'stale.txt')), false);
    const manifest = JSON.parse(await readFile(join(target, 'plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'inline-editor');
    const status = JSON.parse((await exec(['status'], env)).stdout);
    assert.equal(status.plugin.version, manifest.version);

    await mkdir(join(dir, 'data', 'inline-editor'), { recursive: true });
    await exec(['uninstall'], env);
    assert.equal(await exists(target), false);
    assert.equal(await exists(join(dir, 'data', 'inline-editor')), true, 'drafts are kept without --purge');
    await exec(['uninstall', '--purge'], env);
    assert.equal(await exists(join(dir, 'data', 'inline-editor')), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('doctor reports paths and the build', async () => {
  const report = JSON.parse((await exec(['doctor'], { ANTIGRAVITY_PLUGINS_DIR: '/nowhere/plugins' })).stdout);
  assert.equal(report.paths.plugins, '/nowhere/plugins');
  assert.equal(report.package.built, true);
  assert.equal(report.plugin.installed, false);
});

test('MCP Apps need Antigravity 2.34 or newer', () => {
  assert.equal(supportsMcpApps('2.33.9'), false);
  assert.equal(supportsMcpApps('2.34.0'), true);
  assert.equal(supportsMcpApps('2.35.1'), true);
  assert.equal(supportsMcpApps('3.0'), true);
  assert.equal(supportsMcpApps(null), null);
});
