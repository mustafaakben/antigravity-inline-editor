# How it works

Edits is an Antigravity plugin that provides an [MCP Apps](https://antigravity.google/docs/mcp-apps) custom file viewer. It uses only the plugin interfaces Antigravity documents, and nothing in the installed app is modified.

```
~/.gemini/config/plugins/inline-editor/      (copied there by `antigravity-inline-editor install`)
  plugin.json       name "inline-editor", shown as "Edits"
  mcp_config.json   one stdio server: node ${PLUGIN_ROOT}/server.mjs
  server.mjs        MCP server (no dependencies)
  editor.html       the view: one self-contained page, built from src/
        │
        │  Antigravity starts server.mjs and lists its tools
        ▼
tool edit_file, _meta:
  ui.resourceUri = ui://inline-editor/editor.html
  com.google.antigravity/ui.entrypoints = [{ type: "file", extensions: [".md", ".ts", …] }]
        │
        │  you open notes.md in the side panel
        ▼
Antigravity reads ui://inline-editor/editor.html, renders it in an isolated frame, and calls
edit_file with { file: { name: "notes.md", resourceUri: "antigravity-file://<view>/notes.md" } }
        │
        ▼
the view (JSON-RPC over postMessage, through @modelcontextprotocol/ext-apps):
  • resources/read  antigravity-file://…                  → file bytes (base64), answered by Antigravity
  • com.google.antigravity/resources/write { uri, blob }  → writes the file, answered by Antigravity
  • ui/update-model-context                                → Quote and Comment, attached to the next message
  • tools/call load_draft / save_draft / clear_draft       → recovery drafts, answered by server.mjs
```

## Server (`plugin/server.mjs`)

- Speaks MCP over stdio (newline-delimited JSON-RPC 2.0) with no dependencies, so the plugin folder needs no `node_modules`.
- `edit_file` is the file-viewer tool. Antigravity hides it from the model. It just echoes the file it was opened with.
- `load_draft`, `save_draft`, and `clear_draft` are callable only by the view (`visibility: ["app"]`). View frames have no lasting storage, so recovery drafts live in `${PLUGIN_DATA}/drafts.json` (`~/.gemini/antigravity/plugin_data/inline-editor/`), written atomically with owner-only permissions.
- The view receives an opaque URI, not the file's path, so drafts are keyed by file name plus a fingerprint of the exact disk contents they were based on. A draft is offered again only when the file on disk is unchanged since.
- `INLINE_EDITOR_HTML` can point the server at another build of the view, for development. Antigravity fetches the view fresh each time a file opens.

## View (`src/`, built into `plugin/editor.html`)

- `main.js` connects to Antigravity with the MCP Apps SDK, loads the file, and runs autosave: read-before-write conflict detection, then write, then read-back verification. A failed write retries every 3 seconds. While there are no pending edits it polls the file every 2 seconds to pick up outside changes.
- `editor-core.js` and `find-panel.js` are the CodeMirror 6 editor and find bar. Outside changes are applied as one minimal edit, so undo history survives disk syncs.
- `preview.js` renders the Markdown Preview with markdown-it. Raw HTML is escaped, so the preview cannot run code in a view that can write files.
- `text.js` decodes and encodes file bytes, keeping line endings and the byte order mark, and formats Quote and Comment.
- Colors come from the MCP Apps host style variables (`--color-background-primary`, `--color-text-primary`, …) that Antigravity derives from its theme, with fallbacks for every token.
- `npm run build` bundles everything into `plugin/editor.html`, because the view's default CSP blocks external scripts and styles.

## Interfaces this depends on

All of these are documented by Antigravity or by the MCP Apps specification. They were tested with Antigravity 2.35.1.

| Area | Interface |
|---|---|
| Plugin discovery | A folder with `plugin.json` under `~/.gemini/config/plugins/`; servers from `mcp_config.json` with `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` |
| File viewer | Tool `_meta["com.google.antigravity/ui"].entrypoints` with `type: "file"` and `extensions`; arguments `{ file: { name, resourceUri } }` |
| File access | `resources/read` on the `antigravity-file://` URI (base64 `blob`); `com.google.antigravity/resources/write` with `{ uri, blob }`, offered when `hostContext["com.google.antigravity/resources"].write` is present |
| Quote and Comment | `ui/update-model-context` (host capability `updateModelContext`) |
| Links | `ui/open-link` |
| Theme | `hostContext.theme` and `hostContext.styles.variables` |

Known limits of the surface: a claimed extension loses Antigravity's own Preview and Raw views, frames are removed without a teardown message (so Edits saves eagerly), and plugins cannot add native review comments.
