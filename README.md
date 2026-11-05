# antigravity-inline-editor

[![CI](https://github.com/mustafaakben/antigravity-inline-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/mustafaakben/antigravity-inline-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Unofficial.** This project is not affiliated with, endorsed by, or supported by Google. "Antigravity" is used only to describe the app this tool works with. It relies on the app's internal interfaces, which can change with any update. Use it at your own risk and keep your documents under version control.

An **Edits** tab for the Antigravity desktop app. Open a file in Antigravity's side panel and edit it in place, next to Preview and Raw, with autosave, find and replace, and the same Comment and Quote actions the app offers on selections.

## Features

- **Edit in place.** Markdown files get Preview, Raw, and Edits; code files get Raw and Edits. Line numbers, wrapping, and syntax colors match Raw and follow the app's light, dark, and custom themes.
- **Autosave.** Changes are written 0.8 seconds after you stop typing, then read back to verify. ⌘S / Ctrl+S saves immediately.
- **Outside changes sync in.** When an agent or another app changes the file, Edits picks it up within about 2 seconds. If the disk changes while you have pending edits, you choose between **Use disk version** and **Keep mine**.
- **Undo and redo.** ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z) and toolbar buttons work across autosaves, including undoing an accidental Replace All.
- **Find and replace.** A find bar styled like the app's own: match case, whole word, regular expressions, live match count. ⌘F finds; ⌥⌘F (Ctrl+Alt+F) adds replace.
- **Comment and Quote.** Select text to add a pending comment (⌥⌘M) or quote it into the chat (⌘L) with the surrounding lines for context.
- **Crash recovery.** Pending edits are kept in a private local file and restored after a reload or crash.
- **Starts automatically.** A small background host attaches Edits to every Antigravity window, including new and reloaded ones, and waits quietly when the app is closed.

Keyboard shortcuts are shown with macOS symbols; on Windows and Linux use Ctrl for ⌘ and Alt for ⌥.

## Requirements

- [Node.js](https://nodejs.org) 22.4 or newer
- The Antigravity desktop app
- macOS (tested), Windows or Linux (see [compatibility](docs/compatibility.md))

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

Either way, `install` copies the app into your user folder, registers a login service, and attaches Edits to the Antigravity windows that are already open. If Antigravity is closed, Edits appears as soon as you open it. You can delete the clone afterwards.

| OS | Login service | App folder |
|---|---|---|
| macOS | LaunchAgent `antigravity-inline-editor` | `~/Library/Application Support/antigravity-inline-editor` |
| Windows | Task Scheduler task `antigravity-inline-editor` (Startup folder if blocked) | `%LOCALAPPDATA%\antigravity-inline-editor` |
| Linux | systemd user service (XDG autostart without systemd) | `~/.local/share/antigravity-inline-editor` |

## Usage

Open any text file in Antigravity's side panel and choose **Edits**. The status at the top reads **Saving…** while a write is pending and **Saved** once it is on disk.

```sh
antigravity-inline-editor status      # service, host, and Edits version per window
antigravity-inline-editor doctor      # what discovery found, for troubleshooting
```

If you installed from a clone without a global command, run `node bin/cli.mjs <command>` from the clone, or `node "<app folder>/app/bin/cli.mjs" <command>`.

### Finding Antigravity

The host finds the app on its own. Antigravity records its local debugging port in a file named `DevToolsActivePort` inside its user-data folder; the host reads that file on every connection, so app restarts and new windows are picked up without any setup. If Antigravity keeps its data somewhere unusual, set `ANTIGRAVITY_USER_DATA_DIR` to that folder before running `install`. `doctor` shows every folder it searched.

## Updating

Run the install command again. A window with unsaved edits keeps the previous version until those edits are saved, so nothing in progress is lost.

## Uninstalling

```sh
npx github:mustafaakben/antigravity-inline-editor uninstall
```

This stops the host, removes the login service, removes Edits from open windows, and deletes the app folder's `app/` copy. Recovery drafts are kept; add `--purge` to delete them too.

## How it works

The host connects to Antigravity's local debugging port and loads two scripts into each window: a CodeMirror 6 editor bundle and the Edits tab. The tab reads and writes files through the same file service that Preview and Raw use, adds comments to the app's own pending-comment list, and inserts quotes as native chat chips. Nothing in the installed app is modified. See [docs/how-it-works.md](docs/how-it-works.md) for the architecture and the internal interfaces it depends on.

## Privacy and security

Everything runs on your computer. The host talks only to Antigravity's loopback debugging port and never sends data over the network. Recovery drafts may contain document text and are stored with owner-only permissions. Access to the debugging port gives full control of the app, so the host never exposes it beyond your machine. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm ci && npm run check` before opening a pull request.

## License

[MIT](LICENSE). Bundled third-party software is listed in [dist/THIRD_PARTY_LICENSES.txt](dist/THIRD_PARTY_LICENSES.txt).
