# Compatibility

"Live" means Edits was exercised inside a running Antigravity app. "Browser" means the view ran in headless Chrome against a mock MCP Apps host (`npm run test:e2e`). "CI" means automated tests on GitHub Actions, which cannot run Antigravity.

## Version 0.7 (plugin)

| OS | Antigravity | Status | Evidence |
|---|---|---|---|
| macOS 27.2 (Apple silicon) | 2.35.1 | Partly tested live | Live: plugin discovered and its server started after an app restart; supported files open in Edits. Browser: load, autosave, CRLF and BOM kept, disk sync, conflicts, undo across saves, find, Quote, crash recovery, Preview, read-only mode. CI: unit tests. |
| Windows | 2.34 or newer | Not tested live | The plugin uses no OS-specific code. CI: unit tests and install round trip. |
| Linux | 2.34 or newer | Not tested live | As Windows. |

Antigravity 2.34.0 is the first version that renders MCP Apps views. Versions before 2.33 still work with Edits 0.6.

## Version 0.6 (debugging-port host)

Version 0.6 attached to Antigravity's debugging port. Antigravity 2.33.0 stopped opening that port at startup, so 0.6 does not work with 2.33 or newer.

| OS | Antigravity | Status |
|---|---|---|
| macOS 27.2 | 2.29.0 | Worked (live) |
| Windows 11 Pro | 2.28.2 | Worked (live) |

## Reporting results

If you run it on a combination that is not listed, please open an issue with the output of `antigravity-inline-editor doctor` (remove anything private) and what worked.
