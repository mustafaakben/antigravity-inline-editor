# Security policy

## Supported versions

Security fixes go into the latest release. Update by running the install command again.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on the repository's Security tab, not in a public issue. Include the steps to reproduce, the output of `antigravity-inline-editor doctor` with anything private removed, and your OS and Antigravity versions. You will get an acknowledgement within a week.

## What this tool can access

- **Your files.** The view runs in Antigravity's isolated plugin frame and can read and write only the file Antigravity opened it for, through Antigravity's own file access. The plugin's server never reads or writes workspace files.
- **Recovery drafts.** Unsaved edits are stored in `~/.gemini/antigravity/plugin_data/inline-editor/drafts.json`, which may contain document text. The file is written with owner-only permissions on macOS and Linux and lives under your profile on Windows. Drafts older than 30 days are dropped.
- **The conversation.** Quote and Comment attach the selected text, with nearby lines, to your next message, only when you choose them.
- **Network.** The view's security policy blocks network requests. Its only outside resource is the Google Sans web font from `fonts.googleapis.com` and `fonts.gstatic.com`, the same address Antigravity loads it from, and only when Antigravity uses that font. The server makes no requests. Installing with npx downloads this package from GitHub.
- **Markdown Preview.** Raw HTML in documents is shown as text, not rendered, and links open outside the view only for `http` and `https`.

Version 0.6 and earlier connected to Antigravity's debugging port. Version 0.7 does not, and `install` removes the old background host.
