#!/usr/bin/env node
// antigravity-inline-editor command line. Run without arguments for help.
// Edits is an Antigravity plugin (an MCP App file viewer). `install` copies plugin/ into
// Antigravity's plugin folder, where the app discovers it without a restart.
import { cp, rm, rename, readFile, access, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { legacyDir, legacyStatus, removeLegacy } from './legacy/index.mjs';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PLUGIN_SOURCE = join(PACKAGE_ROOT, 'plugin');
export const PLUGIN_NAME = 'inline-editor';
const MIN_APP = [2, 34, 0];

const HELP = `antigravity-inline-editor: unofficial Edits file viewer for the Antigravity desktop app.

Usage: antigravity-inline-editor <command>

  install     Install the Edits plugin into Antigravity (no restart needed) and remove the
              background host left by version 0.6 or earlier.
  uninstall   Remove the plugin. Recovery drafts are kept unless you add --purge.
  status      Show whether the plugin is installed, its version, and the Antigravity version.
  doctor      Show paths and checks for troubleshooting.

Environment:
  ANTIGRAVITY_PLUGINS_DIR   Antigravity's global plugin folder (default ~/.gemini/config/plugins).
  ANTIGRAVITY_APP           Path to Antigravity.app (macOS), used to read the app version.
`;

const print = value => console.log(JSON.stringify(value, null, 2));
const exists = path => access(path).then(() => true, () => false);
const readJson = path => readFile(path, 'utf8').then(JSON.parse, () => null);

export const pluginsDir = (env = process.env) => env.ANTIGRAVITY_PLUGINS_DIR || join(homedir(), '.gemini', 'config', 'plugins');
export const pluginDataDir = (env = process.env) => join(env.ANTIGRAVITY_PLUGIN_DATA_DIR || join(homedir(), '.gemini', 'antigravity', 'plugin_data'), PLUGIN_NAME);

// Reads the installed Antigravity version where it can be found without running the app.
async function appVersion(env = process.env) {
  if (process.platform !== 'darwin') return null;
  const app = env.ANTIGRAVITY_APP || '/Applications/Antigravity.app';
  try {
    const { stdout } = await promisify(execFile)('/usr/bin/defaults', ['read', join(app, 'Contents', 'Info.plist'), 'CFBundleShortVersionString']);
    return stdout.trim() || null;
  } catch { return null; }
}

export function supportsMcpApps(version) {
  if (!version) return null;
  const parts = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((parts[i] || 0) !== MIN_APP[i]) return (parts[i] || 0) > MIN_APP[i];
  return true;
}

// Copies plugin/ through a staging folder so Antigravity never sees a half-written plugin.
async function copyPlugin(target) {
  if (!await exists(join(PLUGIN_SOURCE, 'editor.html'))) throw new Error('plugin/editor.html is missing. Run `npm run build` first.');
  await mkdir(pluginsDir(), { recursive: true });
  const staging = `${target}.${process.pid}.tmp`;
  await rm(staging, { recursive: true, force: true });
  await cp(PLUGIN_SOURCE, staging, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
}

async function status() {
  const target = join(pluginsDir(), PLUGIN_NAME);
  const manifest = await readJson(join(target, 'plugin.json'));
  const version = await appVersion();
  return {
    plugin: { installed: !!manifest, version: manifest?.version ?? null, path: target },
    antigravity: { version, mcpApps: supportsMcpApps(version) },
    legacy: await legacyStatus(),
  };
}

async function install() {
  const target = join(pluginsDir(), PLUGIN_NAME);
  await copyPlugin(target);
  const legacy = await removeLegacy();
  const result = await status();
  print({ installed: true, ...result, legacyRemoved: legacy.found });
  if (result.antigravity.mcpApps === false)
    console.log(`\nAntigravity ${result.antigravity.version} is too old: Edits needs 2.34 or newer. Update Antigravity, then reopen a file.`);
  else console.log('\nOpen a text or code file in Antigravity\'s side panel to edit it in Edits.');
}

async function uninstall(purge) {
  const target = join(pluginsDir(), PLUGIN_NAME);
  const was = await exists(target);
  await rm(target, { recursive: true, force: true });
  if (purge) await rm(pluginDataDir(), { recursive: true, force: true });
  const legacy = await removeLegacy({ purge });
  print({ uninstalled: was, purged: !!purge, legacyRemoved: legacy.found });
}

async function doctor() {
  const manifest = await readJson(join(PLUGIN_SOURCE, 'plugin.json'));
  print({
    node: { version: process.versions.node, path: process.execPath },
    platform: process.platform,
    package: { root: PACKAGE_ROOT, plugin: manifest?.version ?? null, built: await exists(join(PLUGIN_SOURCE, 'editor.html')) },
    paths: { plugins: pluginsDir(), pluginData: pluginDataDir(), legacy: legacyDir() },
    ...(await status()),
    hint: 'If Edits does not open, check Customizations > Installed in Antigravity for the "Edits" plugin and its MCP server status.',
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
  if (command === 'status') return print(await status());
  if (command === 'doctor') return doctor();
  throw new Error(`Unknown command "${command}". Run with --help.`);
}

// npm links the bin, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(`antigravity-inline-editor: ${error.message}`);
    process.exitCode = 1;
  });
}
