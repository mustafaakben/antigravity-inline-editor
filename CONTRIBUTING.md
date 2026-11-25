# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set up

```sh
git clone https://github.com/mustafaakben/antigravity-inline-editor.git
cd antigravity-inline-editor
npm ci
npm run check        # unit tests + build freshness check
npm run test:e2e     # the view in headless Chrome
```

Node 22.4 or newer is required.

## Project layout

| Folder | Runs where | Contents |
|---|---|---|
| `bin/` | your computer | `cli.mjs`, the installer; `legacy/` removes what version 0.6 installed |
| `plugin/` | Antigravity | the plugin as installed: manifest, MCP server, built view (`editor.html`, committed), licenses |
| `src/` | inside the view frame | view sources: `main.js`, the CodeMirror wrapper, find bar, Markdown Preview, text helpers, styles |
| `scripts/` | development | `build.mjs`, which builds `plugin/editor.html` |
| `test/unit/` | development | `node:test` suites for the CLI, server, legacy cleanup, and text helpers |
| `test/e2e/` | development | the view in headless Chrome against a mock MCP Apps host |
| `docs/` | | architecture and compatibility notes |

## Making a change

1. Edit the sources. If you change anything in `src/`, run `npm run build` and commit `plugin/editor.html` with your change; CI fails if it is stale.
2. Bump `version` in `package.json`, `plugin/plugin.json`, `VERSION` in `plugin/server.mjs`, and `VERSION` in `src/main.js` together (a test keeps them equal).
3. Add an entry under **Unreleased** in `CHANGELOG.md`, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
4. Run `npm run test:e2e` (needs Chrome; set `CHROME_PATH` if it is not found).
5. Try it in Antigravity: `node bin/cli.mjs install`, restart the plugin's server from **Customizations → Installed → Edits** (or restart the app), and open a file. For quick view changes, set `INLINE_EDITOR_HTML` in the plugin's `mcp_config.json` `env` to your build; reopening the file picks it up.
6. Run `npm run check` and open a pull request describing what you changed and how you tested it.

## Interfaces

Edits depends on Antigravity's MCP Apps interfaces, listed in [docs/how-it-works.md](docs/how-it-works.md). When an Antigravity update breaks something, start there, and record the tested version in [docs/compatibility.md](docs/compatibility.md).
