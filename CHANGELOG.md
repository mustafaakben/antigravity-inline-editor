# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions before 0.6.0 were developed before this repository existed and have no release tags.

## [Unreleased]

## [0.6.1] - 2026-11-05

### Fixed
- The Edits button now appears in file viewers that are not wrapped in a side-panel focus scope, as in Antigravity 2.28 on Windows.
- `uninstall` on macOS reports the service state after launchd has finished stopping it.
- Reinstalling on macOS waits for launchd to finish unloading the old service before loading the new one, so the service no longer fails to start on update.
- `install` stops a running host before starting the new one, so updates take effect on Windows, where starting an already-running task does nothing.

### Changed
- Windows is listed as supported after a live test on Windows 11 with Antigravity 2.28.2; Linux remains experimental.
- CI installs, reinstalls, and uninstalls the login service on macOS and Windows runners.

## [0.6.0] - 2026-11-05

### Added
- Packaged as `antigravity-inline-editor` with one command line: `install`, `uninstall`, `status`, `doctor`, `watch`, `attach`, and `detach`.
- Install with `npx github:mustafaakben/antigravity-inline-editor install` or from a clone. `install` copies the app to a per-user folder, so the login service never depends on an npx cache or a clone.
- Automatic discovery of Antigravity's debugging port on macOS, Windows, and Linux, with an `ANTIGRAVITY_USER_DATA_DIR` override and a `doctor` report.
- Login services for Windows (Task Scheduler, with a Startup-folder fallback) and Linux (systemd user service, with an XDG autostart fallback).
- Unit tests for discovery, the recovery store, service files, the command line, and the runtime text helpers.
- Continuous integration on macOS, Windows, and Linux with Node 22 and 24, including a check that the committed bundle matches its sources.
- `dist/THIRD_PARTY_LICENSES.txt` with the licenses of all bundled packages.

### Changed
- The macOS LaunchAgent label is `antigravity-inline-editor`; data, drafts, and logs live in the per-user app folder.
- Error messages describe Edits limits plainly.

## 0.5.1 - 2026-11-05

### Added
- Undo and Redo toolbar buttons, enabled only when there is something to undo or redo.

### Changed
- Changes loaded from disk, including Use disk version, apply as one undoable edit, so undo history survives disk syncs.

## 0.5.0 - 2026-11-05

### Added
- Autosave 0.8 seconds after typing pauses, and immediately on file switch, mode switch, or window close. Failed writes retry every 3 seconds.
- Disk sync every 2 seconds while the file has no pending edits.
- Use disk version and Keep mine choices when the disk changes while edits are pending.

### Changed
- Comment finishes a pending autosave first.

### Removed
- Save and Reload buttons.

## 0.4.2 - 2026-11-05

### Added
- Find bar styled like the app's own, with match case, whole word, regular expressions, a live match count, and previous/next navigation.
- Replace row revealed with a chevron or ⌥⌘F; Enter replaces one match, ⌘Enter replaces all.

### Changed
- The Find button toggles the bar, and Escape returns the cursor to the current match.

## 0.3.1 - 2026-11-05

### Changed
- Comments made in Edits match native comments field for field.

## 0.3.0 - 2026-11-05

### Added
- Comment (⌥⌘M) and Quote (⌘L) on selections, using the app's own comment list and chat chips.
- Quotes carry the selected text with the nearest lines before and after it.

## 0.2.0 - 2026-11-05

### Added
- Background host that attaches Edits to new and reloaded windows.
- Crash-recovery drafts.
- CodeMirror 6 editor with line numbers, wrapping, and indentation.
- Cursor and scroll restoration across file switches, and theme-matched syntax colors.

## 0.1.0 - 2026-11-05

### Added
- Edits tab beside Preview and Raw with explicit save, read-back verification, and conflict detection.

[Unreleased]: https://github.com/mustafaakben/antigravity-inline-editor/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/mustafaakben/antigravity-inline-editor/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/mustafaakben/antigravity-inline-editor/releases/tag/v0.6.0
