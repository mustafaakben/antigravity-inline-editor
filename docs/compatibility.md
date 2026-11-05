# Compatibility

"Live" means the Edits tab was exercised inside a running Antigravity app. "CI" means automated tests on GitHub Actions, which cannot run Antigravity.

| OS | Antigravity | Status | Evidence |
|---|---|---|---|
| macOS 27.2 (Apple silicon) | 2.29.0 (Electron 44.5.1) | Supported | Live: install, automatic attach, autosave, disk sync, conflicts, undo/redo, find and replace, Comment, Quote, crash recovery. CI: unit tests. |
| Windows | not yet tested live | Experimental | CI: unit tests, service files, CLI. |
| Linux | not yet tested live | Experimental | CI: unit tests, CLI, packaged install and uninstall without Antigravity. |

Node.js 22.4 or newer is required on every OS. CI runs Node 22 and 24.

## Reporting results

If you run it on a combination that is not listed, please open an issue with the output of `antigravity-inline-editor doctor` (remove anything private) and what worked.
