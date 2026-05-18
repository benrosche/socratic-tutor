# Change Log

All notable changes to the Socratic Tutor extension are documented in this file. Format inspired by [Keep a Changelog](http://keepachangelog.com/).

## [0.1.0] — 2026-05-18

Initial public release.

- Runtime-configurable solutions repository: `repoOwner`, `repoName`, `solutionsPath`, `fileExtension` exposed via VS Code Settings.
- GitHub PAT stored in OS-keychain-backed `SecretStorage` via the **Socratic Tutor: Set GitHub Token** command.
- System prompt generalized — no longer specific to a single language or domain.
- Chat participant ID changed to `socratic-tutor.tutor`.
