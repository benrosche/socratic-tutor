# Change Log

All notable changes to the Socratic Tutor are documented in this file. Format
inspired by [Keep a Changelog](http://keepachangelog.com/).

## [0.2.0] — 2026-08-27

Rearchitected for **Positron / Posit Assistant**. Positron replaced Positron
Assistant with Posit Assistant in 2026.07, which does not consume the `vscode.chat`
API — so the v0.1 chat participant has neither a surface to register on nor a model
to call. This release replaces the delivery mechanism and keeps the pedagogy and the
notebook format unchanged.

### Added

- **MCP server** (`server/`) exposing `get_task_context` and `check_connection`,
  deployable to Railway. Bearer-token auth, self-reported student identity via
  header, SQL-backed per-student rate limiting, `/healthz` liveness endpoint.
- **Multi-course support.** One server and one database serve any number of
  classes. The bearer token *identifies the course*, so a token issued for one
  class cannot reach another's solutions — lookups, suggestions, escalation counts,
  rate limits and logging are all scoped to it. Without this, two courses that each
  have an `01_intro_to_r.qmd` would both produce task `01_intro_to_r-1` and the
  second load would silently overwrite the first. `npm run add-course` issues and
  rotates tokens (only hashes are stored); `npm run load` requires `--course` and
  refuses unknown ones.
- **Postgres schema** (`server/src/schema.ts`) with `courses`, `tasks` and `events`,
  applied via `npm run migrate`. Idempotent, including the upgrade from the
  single-course shape.
- **Persistent escalation level.** A student's position on the hint ladder is
  computed from their request history, so it survives new chat sessions — the hole
  in v0.1, where escalation reset with every fresh conversation.
- **Connection diagnostic.** A second tool, `check_connection`, reports server
  reachability, the student identity the server sees, database status, and how many
  tasks are loaded. Students invoke it by asking the tutor "are you connected?".
  Replaces v0.1's `@tutor test connection`, and distinguishes the failure modes that
  need different fixes: no server, no content loaded, database down. The skill is
  instructed to say plainly when the tool is unavailable rather than claim a
  connection it cannot verify.
- **Test suite** (`npm test`) — 43 tests over the Quarto parser plus auth, identity
  normalization, the diagnostic, solution lookup, escalation across independent
  requests, event logging, per-student rate limiting, and course isolation. Runs against a real
  Postgres, and refuses to run unless the database name contains `test`, since it
  truncates tables.
- **Solution loader** (`npm run load`) reading a local clone of the private
  solutions repo into Postgres. Supports `--dry-run` and `--prune`. Content updates
  no longer require a redeploy.
- **Tutor skill** (`templates/lab-repo/.posit/assistant/skills/tutor/SKILL.md`),
  following the Agent Skills spec. Invoked as `/tutor`.
- **Tutor agent** (`.posit/assistant/agents/tutor.agent.md`) whose `tools:` list
  omits editing and code execution, so the tutor cannot write into a student's file.
  In v0.1 this was a prompt request; it is now a capability restriction.
- **Instructor dashboard** (`dashboard/dashboard.qmd`) over the request log:
  requests per task, share of students reaching level 3+, per-student
  concentration, timing, and verbatim question text.
- **Student installer** (`install.R`). One line in the R console writes the skill
  and an `mcpServers` entry into the student's user-level Posit Assistant config,
  merging rather than overwriting and backing up first. `uninstall_tutor()`
  reverses it. Writing user-level config means the tutor works wherever students
  keep their notebooks, and keeps the class token out of the course repo — which
  matters when that repo is public. Resolves the home directory from
  `USERPROFILE`/`HOME` rather than `~`, since R expands `~` to Documents on
  Windows.
- Request logging, with a disclosure section in the README and a student-facing
  template in `templates/lab-repo/README.md`.

### Changed

- Students no longer install an extension. Setup is one line in the R console; the
  `.vsix`, the GitHub PAT, the four VS Code settings and the `.Renviron` variables
  are all gone.
- The tutoring prompt moved from `src/tutor-system-prompt.md` (compiled into the
  extension) to a markdown file in the lab repo, so it can be edited and pulled
  rather than repackaged and redistributed.
- Solutions are read from a local clone rather than the GitHub Contents API. No
  GitHub token is involved anywhere.

### Fixed

- **Documentation bug carried since 0.1.0.** The README and tutorial claimed a task
  heading could carry its ID inside a Quarto anchor (`{#sec-lesson-1 .task}`),
  "because the anchor contains the bare token". It does not — the parser matches the
  literal `{lesson-1}` including braces, so the documented form never parsed. Only
  the bare-brace form works, which is what `templates/solution-template.qmd` always
  used. Docs now describe the actual behavior.

### Moved

- The v0.1 VS Code extension is archived at `legacy/vscode-extension/` with its own
  README. It still works in stock VS Code + GitHub Copilot and does not work in
  Positron 2026.07+, Cursor, or Claude Code.

## [0.1.0] — 2026-05-18

Initial public release.

- Runtime-configurable solutions repository: `repoOwner`, `repoName`, `solutionsPath`, `fileExtension` exposed via VS Code Settings.
- GitHub PAT stored in OS-keychain-backed `SecretStorage` via the **Socratic Tutor: Set GitHub Token** command.
- System prompt generalized — no longer specific to a single language or domain.
- Chat participant ID changed to `socratic-tutor.tutor`.
