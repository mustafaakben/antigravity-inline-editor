#!/usr/bin/env node
// antigravity-inline-editor command line. Run without arguments for help.
import { cp, rm, rename, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { discover, userDataDirCandidates } from '../host/discover.mjs';
import { dataDir, ensurePrivateDir } from '../host/recovery-store.mjs';
import { runOnce, watch, runningHostPid, loadResources } from '../host/attach.mjs';
import { serviceFor, stableNode } from '../host/service/index.mjs';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_FILES = ['bin', 'host', 'runtime', 'dist', 'package.json', 'LICENSE', 'README.md', 'CHANGELOG.md'];

const HELP = `antigravity-inline-editor: unofficial Edits tab for the Antigravity desktop app.

Usage: antigravity-inline-editor <command>

  install     Copy the app to your user folder, start the background host at login, and
              attach Edits to every open Antigravity window.
  uninstall   Stop the host, remove Edits from open windows, and delete the installed copy.
              Recovery drafts are kept unless you add --purge.
  status      Show the service, the host, and the Edits version in each window.
  doctor      Show what discovery found: Node, Antigravity's debugging port, folders.
  watch       Run the host in the foreground (this is what the service runs).
  attach      Attach Edits to open windows once, without the background host.
  detach      Remove Edits from open windows. Refuses while a window has unsaved edits.

Environment:
  ANTIGRAVITY_USER_DATA_DIR       Antigravity's user-data folder, if not in the default place.
  ANTIGRAVITY_INLINE_EDITOR_HOME  Where this tool keeps its app copy, drafts, and logs.
`;

const print = (value) => console.log(JSON.stringify(value, null, 2));

function requireNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 4) || typeof WebSocket !== 'function')
    throw new Error(`Node 22.4 or newer is required (found ${process.versions.node}).`);
}

// Copies the package into <home>/app so the service never depends on an npx cache or a clone.
async function copyApp(home) {
  const app = join(home, 'app');
  if (resolve(PACKAGE_ROOT) === resolve(app)) return app;
  const staging = join(home, `app.${process.pid}.tmp`);
  await rm(staging, { recursive: true, force: true });
  for (const name of APP_FILES) {
    const source = join(PACKAGE_ROOT, name);
    try { await access(source); } catch { continue; }
    await cp(source, join(staging, name), { recursive: true });
  }
  await rm(app, { recursive: true, force: true });
  await rename(staging, app);
  return app;
}

async function windowsStatus() {
  if (!await discover()) return { app: false, windows: 0, targets: [] };
  try { return await runOnce('status'); }
  catch (error) { return { app: true, error: error.message }; }
}

async function status(home) {
  const service = await serviceFor().status({ home }).catch((error) => ({ error: error.message }));
  const pid = await runningHostPid(home);
  return { service, host: { running: pid !== null, pid }, antigravity: await windowsStatus() };
}

async function install() {
  requireNode();
  const home = await ensurePrivateDir(dataDir());
  const app = await copyApp(home);
  const { version } = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  const node = await stableNode();
  const service = await serviceFor().install({ node, script: join(app, 'bin', 'cli.mjs'), home });
  // Give the host a moment to discover Antigravity and attach.
  let result;
  for (let attempt = 0; attempt < 8; attempt++) {
    await delay(1000);
    result = await status(home);
    if (!result.antigravity.app || result.antigravity.targets?.every((target) => target.installed)) break;
  }
  print({ installed: true, version, home, node, ...result, service: { ...service, ...result.service } });
  if (!result.antigravity.app) console.log('\nAntigravity is not running. Edits will attach automatically when you open it.');
}

async function uninstall(purge) {
  const home = dataDir();
  const service = await serviceFor().uninstall({ home });
  const pid = await runningHostPid(home);
  if (pid) { try { process.kill(pid); } catch { /* already stopped */ } }
  let detached = { app: false };
  if (await discover()) detached = await runOnce('remove').catch((error) => ({ error: error.message }));
  const refused = detached.targets?.some((target) => target.removed === false);
  await rm(join(home, 'app'), { recursive: true, force: true });
  if (purge) await rm(home, { recursive: true, force: true });
  await rm(join(home, 'host.pid'), { force: true }).catch(() => {});
  print({ uninstalled: true, service, detached, purged: !!purge });
  if (refused) {
    console.log('\nA window still has unsaved edits, so Edits stayed in that window until it is reloaded.');
    process.exitCode = 1;
  }
}

async function doctor() {
  const endpoint = await discover();
  const resources = await loadResources().catch((error) => ({ error: error.message }));
  print({
    node: { version: process.versions.node, path: process.execPath, ok: typeof WebSocket === 'function' },
    platform: process.platform,
    package: { root: PACKAGE_ROOT, runtime: resources.version ?? resources.error, core: resources.coreLevel },
    dataDir: dataDir(),
    discovery: {
      searched: userDataDirCandidates(),
      found: endpoint ? { userDataDir: endpoint.userDataDir, port: endpoint.port } : null,
      hint: endpoint ? undefined : 'Open Antigravity. If it is installed somewhere unusual, set ANTIGRAVITY_USER_DATA_DIR to its user-data folder (the one containing DevToolsActivePort).',
    },
    ...(await status(dataDir())),
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') { process.stdout.write(HELP); return; }
  if (command === '--version' || command === '-v') {
    console.log(JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version);
    return;
  }
  const flags = new Set(rest);
  const known = { uninstall: ['--purge'] }[command] ?? [];
  for (const flag of flags) if (!known.includes(flag)) throw new Error(`Unknown option ${flag}. Run with --help.`);
  if (command === 'install') return install();
  if (command === 'uninstall') return uninstall(flags.has('--purge'));
  if (command === 'status') return print(await status(dataDir()));
  if (command === 'doctor') return doctor();
  if (command === 'watch') { requireNode(); return watch(); }
  if (command === 'attach' || command === 'detach') {
    requireNode();
    const result = await runOnce(command === 'attach' ? 'attach' : 'remove');
    print(result);
    if (result.targets.some((target) => target.refused || target.removed === false)) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown command "${command}". Run with --help.`);
}

main().catch((error) => {
  console.error(`antigravity-inline-editor: ${error.message}`);
  process.exitCode = 1;
});
