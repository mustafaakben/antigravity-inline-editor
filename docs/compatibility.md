# Compatibility

"Live" means the Edits tab was exercised inside a running Antigravity app. "CI" means automated tests on GitHub Actions, which cannot run Antigravity.

| OS | Antigravity | Status | Evidence |
|---|---|---|---|
| macOS 27.2 (Apple silicon) | 2.29.0 (Electron 44.5.1) | Supported | Live: install from npx and from a clone, automatic attach after reloads, autosave, disk sync, conflicts, undo/redo, find and replace, Comment, Quote, crash recovery, uninstall. CI: unit tests. |
| Windows 11 Pro (build 26200) | 2.28.2 (Electron 44.5.1) | Supported | Live: install from npx, Task Scheduler host, discovery under `%APPDATA%\Antigravity`, automatic attach to a new window, loading and autosaving a `C:` file with CRLF line endings kept, undo, disk sync, find bar, crash recovery, uninstall. Tested on an administrator account. CI: unit tests. |
| Linux (Ubuntu 24.04 under WSL 2) | not tested live | Experimental | Live without Antigravity: systemd user service install, host waiting for the app, uninstall, and the Node version check. CI: unit tests and packaged install and uninstall. A live test with Antigravity running on a Linux desktop is still needed. |

Node.js 22.4 or newer is required on every OS, including for `npx` (older npm versions bundled with Node 18 cannot run a package straight from GitHub). CI runs Node 22 and 24.

On Windows, remote testing could not send keystrokes to a background window, so typing was simulated through the editor's DOM; everything after the keystroke (autosave, conflict checks, file encoding) ran the real code path.

## Reporting results

If you run it on a combination that is not listed, please open an issue with the output of `antigravity-inline-editor doctor` (remove anything private) and what worked.
