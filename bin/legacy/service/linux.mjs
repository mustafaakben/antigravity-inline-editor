// Linux: a systemd user service. Without a systemd user session (for example some WSL setups),
// an XDG autostart entry starts the host with the desktop session instead.
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const UNIT = 'antigravity-inline-editor.service';
const configHome = () => process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
export const unitPath = () => join(configHome(), 'systemd', 'user', UNIT);
export const autostartPath = () => join(configHome(), 'autostart', 'antigravity-inline-editor.desktop');

// systemd and desktop-entry values: quote each argument and escape quotes and backslashes.
const quote = (value) => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export function renderUnit({ node, script }) {
  return `[Unit]
Description=antigravity-inline-editor host (Edits tab for Antigravity)
After=graphical-session.target

[Service]
ExecStart=${quote(node)} ${quote(script)} watch
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

export function renderDesktopEntry({ node, script }) {
  return `[Desktop Entry]
Type=Application
Name=antigravity-inline-editor
Comment=Edits tab host for Antigravity
Exec=${quote(node)} ${quote(script)} watch
NoDisplay=true
X-GNOME-Autostart-enabled=true
`;
}

async function systemdAvailable() {
  try { await run('systemctl', ['--user', 'show-environment']); return true; } catch { return false; }
}

export async function status() {
  if (await systemdAvailable()) {
    let configured = false;
    try { await readFile(unitPath()); configured = true; } catch { /* not installed */ }
    const active = await run('systemctl', ['--user', 'is-active', UNIT]).then(({ stdout }) => stdout.trim() === 'active', () => false);
    return { mechanism: 'systemd', configured, loaded: configured, running: active };
  }
  let configured = false;
  try { await readFile(autostartPath()); configured = true; } catch { /* not installed */ }
  return { mechanism: 'xdg-autostart', configured, loaded: configured, running: null };
}

export async function install({ node, script, home }) {
  if (await systemdAvailable()) {
    await mkdir(join(configHome(), 'systemd', 'user'), { recursive: true });
    await writeFile(unitPath(), renderUnit({ node, script }));
    await run('systemctl', ['--user', 'daemon-reload']);
    await run('systemctl', ['--user', 'enable', UNIT]);
    await run('systemctl', ['--user', 'restart', UNIT]);
    return status();
  }
  await mkdir(join(configHome(), 'autostart'), { recursive: true });
  await writeFile(autostartPath(), renderDesktopEntry({ node, script }));
  // Start now as well; the autostart entry covers future logins.
  spawn(node, [script, 'watch'], { detached: true, stdio: 'ignore', cwd: home }).unref();
  return status();
}

export async function uninstall() {
  if (await systemdAvailable()) {
    await run('systemctl', ['--user', 'disable', '--now', UNIT]).catch(() => {});
    await rm(unitPath(), { force: true });
    await run('systemctl', ['--user', 'daemon-reload']).catch(() => {});
  }
  await rm(autostartPath(), { force: true });
  return status();
}
