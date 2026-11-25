// Windows: a Task Scheduler task for the current user that starts the host at logon. A small
// VBScript launcher keeps the console window hidden. If the task cannot be registered (some
// managed PCs block it), a launcher in the user's Startup folder is used instead.
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const TASK = 'antigravity-inline-editor';
export const launcherPath = (home) => join(home, 'launch-host.vbs');
export const startupPath = (env = process.env) =>
  join(env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'antigravity-inline-editor.vbs');

// VBScript string literal: double any embedded quotes.
const vbs = (value) => `"${String(value).replaceAll('"', '""')}"`;

export function renderLauncher({ node, script, home }) {
  const command = `${vbs(`"${node}"`)} & " " & ${vbs(`"${script}"`)} & " watch"`;
  return `' antigravity-inline-editor: starts the host without a console window.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = ${vbs(home)}
shell.Run ${command}, 0, True
`;
}

// PowerShell single-quoted literal: double any embedded single quotes.
const ps = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function renderRegisterScript({ launcher }) {
  return [
    `$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${ps(`"${launcher}"`)}`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"`,
    `$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)`,
    `Register-ScheduledTask -TaskName ${ps(TASK)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`,
  ].join('; ');
}

const powershell = (command) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true });

async function taskState() {
  try {
    const { stdout } = await powershell(`(Get-ScheduledTask -TaskName ${ps(TASK)} -ErrorAction Stop).State`);
    return stdout.trim() || 'Unknown';
  } catch { return null; }
}

export async function status() {
  const state = await taskState();
  if (state) return { mechanism: 'task-scheduler', configured: true, loaded: true, running: state === 'Running' };
  let configured = false;
  try { await readFile(startupPath()); configured = true; } catch { /* not installed */ }
  return { mechanism: configured ? 'startup-folder' : 'task-scheduler', configured, loaded: configured, running: null };
}

export async function install({ node, script, home }) {
  await mkdir(home, { recursive: true });
  const launcher = launcherPath(home);
  const contents = renderLauncher({ node, script, home });
  await writeFile(launcher, contents);
  try {
    await powershell(renderRegisterScript({ launcher }));
    await rm(startupPath(), { force: true });
    await powershell(`Start-ScheduledTask -TaskName ${ps(TASK)}`);
  } catch {
    await mkdir(join(startupPath(), '..'), { recursive: true });
    await writeFile(startupPath(), contents);
    spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  return status();
}

export async function uninstall({ home }) {
  await powershell(`Unregister-ScheduledTask -TaskName ${ps(TASK)} -Confirm:$false -ErrorAction SilentlyContinue`).catch(() => {});
  await rm(startupPath(), { force: true });
  await rm(launcherPath(home), { force: true });
  return status();
}
