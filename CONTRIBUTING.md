# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set up

```sh
git clone https://github.com/mustafaakben/antigravity-inline-editor.git
cd antigravity-inline-editor
npm ci
npm run check        # unit tests + bundle freshness check
```

Node 22.4 or newer is required.

## Project layout

| Folder | Runs where | Contents |
|---|---|---|
| `bin/` | your computer | `cli.mjs`, the single command users run |
| `host/` | your computer (Node) | discovery, attaching to windows, recovery drafts, per-OS login services |
| `runtime/` | inside the Antigravity window | the Edits tab, the CodeMirror wrapper, the find bar |
| `dist/` | inside the Antigravity window | the built editor bundle (committed) and third-party licenses |
| `scripts/` | development | `build.mjs` |
| `test/` | development | `node:test` suites for `host/` and `runtime/` |
| `docs/` | | architecture and compatibility notes |

## Making a change

1. Edit the sources. If you change `runtime/editor-core.js` or `runtime/find-panel.js`, run `npm run build` and commit `dist/` with your change; CI fails if `dist/` is stale.
2. Bump versions so running windows pick up the change:
   - `version` in `package.json` and `VERSION` in `runtime/edits-tab.js` (a test keeps them equal).
   - The editor core `version` at the bottom of `runtime/editor-core.js` when the bundle changes.
3. Add an entry under **Unreleased** in `CHANGELOG.md`, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
4. Try it against a real Antigravity window: `node bin/cli.mjs install`, then `node bin/cli.mjs status`.
5. Run `npm run check` and open a pull request describing what you changed and how you tested it.

## Internal interfaces

The runtime depends on Antigravity's internal page structure and services, listed in [docs/how-it-works.md](docs/how-it-works.md). When an Antigravity update breaks something, start there, and record the tested version in [docs/compatibility.md](docs/compatibility.md).
