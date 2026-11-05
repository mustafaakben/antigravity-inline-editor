# Security policy

## Supported versions

Security fixes go into the latest release. Update by running the install command again.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on the repository's Security tab, not in a public issue. Include the steps to reproduce, the output of `antigravity-inline-editor doctor` with anything private removed, and your OS and Antigravity versions. You will get an acknowledgement within a week.

## What this tool can access

- **Antigravity's debugging port.** The host connects to the loopback port Antigravity records in `DevToolsActivePort`. That port gives full control of the app's windows. The host only connects to `127.0.0.1`, never opens or forwards a port, and only loads its own two scripts into Antigravity windows.
- **Your files.** The Edits tab reads and writes files only through Antigravity's own file service, and only the file you open in Edits.
- **Recovery drafts.** Pending edits are stored in `drafts.json` inside the per-user app folder, which may contain document text. The folder is created with owner-only permissions on macOS and Linux and lives under your profile on Windows.
- **Network.** Nothing is sent over the network. Installing with npx downloads this package from GitHub.

Anyone who can run programs as your user can already reach the same debugging port, so the host does not add a new way in. Do not run the host as a different or elevated user.
