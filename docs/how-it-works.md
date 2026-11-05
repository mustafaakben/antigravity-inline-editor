# How it works

antigravity-inline-editor adds an Edits tab to the Antigravity desktop app without changing the installed app. A small Node process (the host) loads two scripts into each Antigravity window over the app's local debugging port.

```
login service (launchd / Task Scheduler / systemd)
        │  node <app folder>/app/bin/cli.mjs watch
        ▼
host/attach.mjs ── every 1.5 s ──▶ host/discover.mjs
        │                          reads <Antigravity user data>/DevToolsActivePort
        │                          connects to ws://127.0.0.1:<port>/devtools/browser/<id>
        ▼
for each Antigravity window (new or reloaded):
        1. dist/editor-core.bundle.js   CodeMirror 6 + runtime/find-panel.js
        2. runtime/edits-tab.js         the Edits tab
        ▼
inside the window, edits-tab.js:
        • reads and writes files through Antigravity's file service (autosave)
        • adds comments to the app's pending-comment list
        • inserts quotes into the chat input as native chips
        • sends pending drafts back to the host ──▶ host/recovery-store.mjs (drafts.json)
```

## Host

- **Discovery** (`host/discover.mjs`). Antigravity starts Chromium with a dynamic remote-debugging port and writes it to `DevToolsActivePort` in its user-data folder: `~/Library/Application Support/Antigravity` on macOS, `%APPDATA%\Antigravity` on Windows, and `$XDG_CONFIG_HOME/Antigravity` (default `~/.config/Antigravity`) on Linux. `ANTIGRAVITY_USER_DATA_DIR` overrides the search. The file is read again on every connection, so restarts and port changes need no setup.
- **Attaching** (`host/attach.mjs`). The host lists page targets, keeps pages served from `https://127.0.0.1` (paths `/` and `/c/<conversation>`), and confirms each is the desktop renderer by checking the preload globals `window.electronNative`, `window.nativeStorage`, and `window.extensions.sendAuthorities`. It loads the editor bundle when the page has an older core version, then the Edits tab. A window that already runs the same version is skipped; a window with an older version is upgraded only when it has no unsaved edits.
- **Recovery** (`host/recovery-store.mjs`). The host adds a DevTools binding named `__agyEditsPersist`. The tab sends each pending draft through it; the host validates the entry, writes `drafts.json` atomically with owner-only permissions, and acknowledges through `window.__agyEditsPersistAck`. Drafts are restored after a reload and autosaved when the disk still matches.
- **Services** (`host/service/`). `install` copies the package to `<app folder>/app` and registers a per-user login service that runs `cli.mjs watch`. Only one host runs per user, guarded by `host.pid`.

## Runtime

- **Editor** (`runtime/editor-core.js`, `runtime/find-panel.js`). CodeMirror 6 with Antigravity's Prism tokenizer for syntax colors, so highlighting matches Raw exactly. The find bar is a CodeMirror panel that reuses the native find bar's classes and Material Symbols icons. Outside text changes are applied as one minimal edit so undo history survives disk syncs.
- **Tab** (`runtime/edits-tab.js`). Adds the Edits button next to Raw, hosts the editor in the File Viewer, autosaves with read-before-write conflict detection and read-back verification, polls the disk while there are no pending edits, and implements Comment and Quote.

## Internal interfaces this depends on

These are Antigravity internals observed in version 2.29.0. Any of them can change in an update; this list is where to start when something breaks.

| Area | Interface |
|---|---|
| Window detection | Preload globals `electronNative`, `nativeStorage`, `extensions.sendAuthorities`; app page URLs on `https://127.0.0.1` |
| File viewer DOM | `[aria-label="File Viewer header"]`, `nav[aria-label="File path breadcrumbs"] [data-uri]`, `[data-side-panel-focus-scope="true"]`, `div[aria-label="File Viewer"][tabindex="0"]`, the `Preview` and `Raw` buttons, `.file-viewer-root` |
| File service | `POST /exa.language_server_pb.LanguageServerService/ReadFile` and `/WriteFile` (Connect JSON, base64 content) with the `x-codeium-csrf-token` header from `window.__APP_CONFIG__.csrfToken` |
| Theme | CSS variables such as `--background`, `--foreground`, `--border`, `--secondary`, `--editor-*`, `--syntax-*`; `window.Prism` and Raw's `.token` classes |
| Comment | The Redux store and comment `scopeToken` found by walking the React fiber above the File Viewer; action `comments/addFileComment` with `{ fileUri, scope, commentId, selection, comment, initialPositioning }` |
| Quote | The chat input registry's `getActiveEditor()` (a Lexical editor); node type `beautifulMention` and its replacement `contextScopeItemMention`; mention data `{ data: JSON.stringify({ textBlock: { fileLineRange, content } }) }` |
| Styling | Native class names such as `agy-selection-pill`, `agy-field`, `selection-popup`, plus the app's Tailwind utilities |

Globals the runtime defines in each window: `__agyEditsTab` (status and removal), `__agyEditorCore`, `__agyEditsRecovery`, `__agyEditsClientId`, `__agyEditsPersistAck`.
