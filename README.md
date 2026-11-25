# antigravity-inline-editor

[![CI](https://github.com/mustafaakben/antigravity-inline-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/mustafaakben/antigravity-inline-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Unofficial.** This project is not affiliated with, endorsed by, or supported by Google. "Antigravity" is used only to describe the app this tool works with. It uses the app's documented plugin interfaces (MCP Apps), which are new and may still change. Use it at your own risk and keep your documents under version control.

**Edits** is a file viewer for the Antigravity desktop app that lets you edit text and code files in place in the side panel, with autosave, find and replace, and Quote and Comment into chat.

Since version 0.7, Edits is an Antigravity **plugin** built on [MCP Apps](https://antigravity.google/docs/mcp-apps), the app's official way for plugins to add UI. It no longer uses Antigravity's debugging port, which [Antigravity 2.33 stopped opening](https://antigravity.google/docs/changelog) for security reasons.

## Features

- **Edit in place.** Supported files open in Edits in the side panel. Markdown opens in **Preview**, with an **Edit** button to switch to the editor. Code gets line numbers and syntax colors, and follows the app's light and dark themes.
- **Autosave.** Changes are written 0.8 seconds after you stop typing, then read back to verify. ⌘S / Ctrl+S saves immediately.
- **Outside changes sync in.** When an agent or another app changes the file, Edits picks it up within about 2 seconds. If the disk changes while you have pending edits, you choose between **Use disk version** and **Keep mine**.
- **Undo and redo.** ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z) and toolbar buttons work across autosaves, including undoing an accidental Replace All.
- **Find and replace.** Match case, whole word, regular expressions, and a live match count. ⌘F finds; ⌥⌘F (Ctrl+Alt+F) adds replace.
- **Quote and Comment.** Select text in Preview or Edit, then choose **Quote** or **Comment** in the popup or the toolbar. The selection, its line numbers, and the surrounding lines are attached to your next message in the conversation.
- **Crash recovery.** Unsaved edits are kept in a private local file and restored when you reopen the file.

Keyboard shortcuts are shown with macOS symbols; on Windows and Linux use Ctrl for ⌘ and Alt for ⌥.

### File types

Edits opens Markdown (`.md`, `.markdown`, `.mdx`), plain text and logs, JavaScript and TypeScript, JSON, Python, CSS, XML, YAML, TOML, shell scripts, and common source files (C, C++, C#, Go, Rust, Java, Kotlin, Swift, Ruby, PHP, Lua, R, SQL, LaTeX). The full list is `EXTENSIONS` in [plugin/server.mjs](plugin/server.mjs).

Antigravity gives a file type to one viewer: when Edits claims a type, the app's own Preview and Raw views no longer appear for it. That is why Edits brings its own Markdown Preview, and why it leaves HTML, SVG, CSV, and TSV to Antigravity's native viewer.

## Requirements

- The Antigravity desktop app, version **2.34 or newer** (MCP Apps support)
- [Node.js](https://nodejs.org) 22.4 or newer to run the installer. The plugin's server runs on Antigravity's bundled Node.js when `node` is not on your path.

## Installation

The repository is private for now, so both methods need access to it on GitHub.

**With npx** (no clone needed):

```sh
npx github:mustafaakben/antigravity-inline-editor install
```

**From a clone:**

```sh
git clone https://github.com/mustafaakben/antigravity-inline-editor.git
cd antigravity-inline-editor
node bin/cli.mjs install
```

`install` copies the plugin to `~/.gemini/config/plugins/inline-editor`, where Antigravity finds it automatically. If you used version 0.6 or earlier, it also removes the old background host and its login service.

If Antigravity was already open, **quit and reopen it once** so it starts the plugin's server. Then open a supported file in the side panel. The plugin appears as **Edits** under **Customizations → Installed**.

## Usage

Open a supported file in the side panel. Markdown opens in Preview; choose **Edit** to change it. The status at the top reads **Saving…** while a write is pending and **Saved** once it is on disk.

```sh
antigravity-inline-editor status      # plugin version, Antigravity version, leftovers from 0.6
antigravity-inline-editor doctor      # paths and checks, for troubleshooting
```

If you installed from a clone, run `node bin/cli.mjs <command>` from the clone.

### Limits

- Files up to 10 MB of UTF-8 text. Edits refuses files with mixed line endings rather than change them.
- Images in the Markdown Preview do not load, because the view's security policy blocks web and relative image paths. Images embedded as `data:` URIs do.
- Quote and Comment add one attachment to your next message, which collects everything you quote until you leave the Edits pane; the next Quote after that starts a new attachment. **Clear** in the footer removes it. They are not Antigravity's native review comments, which plugins cannot create.
- Antigravity handles ⌘L and some other shortcuts itself, so use the Quote and Comment buttons.

## Updating

Run the install command again. Then restart the plugin's server from **Customizations → Installed → Edits**, or restart Antigravity.

## Uninstalling

```sh
npx github:mustafaakben/antigravity-inline-editor uninstall
```

This removes the plugin, so the affected file types go back to Antigravity's own viewer. Recovery drafts are kept; add `--purge` to delete them too.

## How it works

The plugin's MCP server registers a tool with a `file` entrypoint for the supported extensions. When you open one of those files, Antigravity renders the plugin's view (`plugin/editor.html`, a CodeMirror 6 editor) in an isolated frame and hands it an opaque URI for the file. The view reads and writes the file through Antigravity, and Antigravity does the file access itself. See [docs/how-it-works.md](docs/how-it-works.md).

## Privacy and security

Everything runs on your computer. The view runs in Antigravity's sandboxed frame with no network access, and it can only read and write the one file Antigravity opened it for. The plugin's server never touches your files; it only stores recovery drafts, which may contain document text, in `~/.gemini/antigravity/plugin_data/inline-editor/drafts.json` with owner-only permissions. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm ci && npm run check` before opening a pull request.

## License

[MIT](LICENSE). Bundled third-party software is listed in [plugin/THIRD_PARTY_LICENSES.txt](plugin/THIRD_PARTY_LICENSES.txt).
