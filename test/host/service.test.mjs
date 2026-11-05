import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serviceFor } from '../../host/service/index.mjs';
import { renderPlist, LABEL } from '../../host/service/macos.mjs';
import { renderUnit, renderDesktopEntry } from '../../host/service/linux.mjs';
import { renderLauncher, renderRegisterScript, TASK } from '../../host/service/windows.mjs';
import { runtimeVersion, coreVersion } from '../../host/attach.mjs';

const run = promisify(execFile);
const tricky = { node: '/opt/node & co/bin/node', script: '/Users/a "b"/app/bin/cli.mjs', home: '/Users/a/data' };

test('serviceFor picks one implementation per OS', () => {
  for (const platform of ['darwin', 'win32', 'linux']) assert.equal(typeof serviceFor(platform).install, 'function');
  assert.throws(() => serviceFor('aix'), /Unsupported/);
});

test('macOS LaunchAgent escapes paths and keeps the host alive', async () => {
  const plist = renderPlist({ ...tricky, logDir: '/logs' });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<string>\/opt\/node &amp; co\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/Users\/a &quot;b&quot;\/app\/bin\/cli.mjs<\/string>/);
  assert.match(plist, /<string>watch<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  if (process.platform === 'darwin') {
    const dir = await mkdtemp(join(tmpdir(), 'agy-plist-'));
    try {
      await writeFile(join(dir, 'test.plist'), plist);
      await run('/usr/bin/plutil', ['-lint', join(dir, 'test.plist')]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('Linux unit and autostart entry quote arguments', () => {
  const unit = renderUnit(tricky);
  assert.match(unit, /^ExecStart="\/opt\/node & co\/bin\/node" "\/Users\/a \\"b\\"\/app\/bin\/cli.mjs" watch$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^WantedBy=default.target$/m);
  const desktop = renderDesktopEntry(tricky);
  assert.match(desktop, /^\[Desktop Entry\]$/m);
  assert.match(desktop, /^Exec="\/opt\/node & co\/bin\/node" .* watch$/m);
});

test('Windows launcher hides the console and quotes paths', () => {
  const launcher = renderLauncher({ node: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\Users\\a b\\app\\bin\\cli.mjs', home: 'C:\\Users\\a b\\data' });
  assert.match(launcher, /shell\.Run .*, 0, True/);
  assert.ok(launcher.includes('"""C:\\Program Files\\nodejs\\node.exe"""'));
  assert.ok(launcher.includes('"""C:\\Users\\a b\\app\\bin\\cli.mjs"""'));
  const script = renderRegisterScript({ launcher: "C:\\Users\\o'brien\\launch-host.vbs" });
  assert.ok(script.includes(`-TaskName '${TASK}'`));
  assert.ok(script.includes("o''brien"));
  assert.match(script, /-AtLogOn/);
  assert.match(script, /-RunLevel Limited/);
});

test('versions agree across package.json, runtime, and bundle', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const runtime = await readFile(new URL('../../runtime/edits-tab.js', import.meta.url), 'utf8');
  const coreSource = await readFile(new URL('../../runtime/editor-core.js', import.meta.url), 'utf8');
  const bundle = await readFile(new URL('../../dist/editor-core.bundle.js', import.meta.url), 'utf8');
  assert.equal(runtimeVersion(runtime), pkg.version);
  assert.equal(coreVersion(bundle), coreVersion(coreSource));
  assert.ok(coreVersion(bundle) > 0);
});
