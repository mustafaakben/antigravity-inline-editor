// macOS: a per-user LaunchAgent that starts the host at login and restarts it if it exits.
import { mkdir, writeFile, rename, rm, readFile, open, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const LABEL = 'antigravity-inline-editor';
export const plistPath = (home = homedir()) => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const domain = () => `gui/${process.getuid()}`;
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export function renderPlist({ node, script, logDir }) {
  const args = [node, script, 'watch'].map((arg) => `    <string>${xml(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(logDir, 'host.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDir, 'host-error.log'))}</string>
</dict>
</plist>
`;
}

export async function status() {
  let configured = false;
  try { await readFile(plistPath()); configured = true; } catch { /* not installed */ }
  try {
    const { stdout } = await run('/bin/launchctl', ['print', `${domain()}/${LABEL}`]);
    return { mechanism: 'launchd', configured, loaded: true, running: /state = running/.test(stdout) };
  } catch { return { mechanism: 'launchd', configured, loaded: false, running: false }; }
}

export async function install({ node, script, home }) {
  const logDir = join(home, 'logs');
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  for (const name of ['host.log', 'host-error.log']) {
    const handle = await open(join(logDir, name), 'a', 0o600);
    await handle.close();
    await chmod(join(logDir, name), 0o600);
  }
  const target = plistPath();
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, renderPlist({ node, script, logDir }), { mode: 0o644, flag: 'wx' });
    await run('/usr/bin/plutil', ['-lint', temporary]);
    await stop();
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
  await run('/bin/launchctl', ['bootstrap', domain(), target]);
  return status();
}

// launchd unloads asynchronously; bootstrapping before it finishes fails, so wait it out.
async function stop() {
  if (!(await status()).loaded) return;
  await run('/bin/launchctl', ['bootout', `${domain()}/${LABEL}`]).catch(() => {});
  for (let attempt = 0; attempt < 40 && (await status()).loaded; attempt++) await new Promise((done) => setTimeout(done, 250));
}

export async function uninstall() {
  await stop();
  await rm(plistPath(), { force: true });
  return status();
}
