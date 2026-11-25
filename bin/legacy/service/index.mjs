// Picks the login-service implementation for this OS. Each implementation exposes the same API:
//   install({ node, script, home }), uninstall({ home }), status({ home })
// and pure render functions that tests use to check the generated service files.
import { realpath } from 'node:fs/promises';
import * as macos from './macos.mjs';
import * as windows from './windows.mjs';
import * as linux from './linux.mjs';

export const SERVICE_NAME = 'antigravity-inline-editor';

export function serviceFor(platform = process.platform) {
  if (platform === 'darwin') return macos;
  if (platform === 'win32') return windows;
  if (platform === 'linux') return linux;
  throw new Error(`Unsupported platform: ${platform}.`);
}

// Prefers a stable Node path over a versioned one (for example Homebrew's Cellar folder), so the
// service keeps working after Node upgrades. Falls back to the exact running executable.
export async function stableNode(execPath = process.execPath) {
  const exact = await realpath(execPath).catch(() => execPath);
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    try { if (await realpath(candidate) === exact) return candidate; } catch { /* not present */ }
  }
  return execPath;
}
