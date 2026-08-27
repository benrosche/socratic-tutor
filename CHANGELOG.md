# Change Log

All notable changes to the Socratic Tutor are documented in this file. Format
inspired by [Keep a Changelog](http://keepachangelog.com/).

## [Unreleased]

### Added

- **`npm run verify`** (`server/src/verify.ts`). Compares the `#| task:` markers in
  the notebooks students open against the `tasks` rows loaded for a course, and
  exits non-zero listing any marker with no solution behind it. This is the one
  failure a clean `npm run load` cannot detect: the loader only sees the solutions
  repo, so it cannot know an exercise exists that nothing answers. Because task IDs
  derive from the solution notebook's filename, a renamed lab breaks the link while
  both sides still look correct on their own.

- **`tutor_check()`** in `install.R`, and `install_tutor()` now ends by calling it.
  Writing a config file always "succeeds", so the old installer reported success
  whether or not the tutor could reach anything. It now calls the course server and
  reports the course, the identity the server sees, and how many exercises are
  loaded — distinguishing a wrong token (401), an unreachable server, and a course
  with nothing loaded yet. Students can re-run `tutor_check()` at any time without
  retyping the token. Verification needs `curl`; without it the install still
  completes and says the check was skipped.

### Changed — lab-repo `settings.json`

- **`mcpServers` removed from the lab-repo template; replaced with a `permission`
  block.** A workspace `.posit/assistant/settings.json` configures `mcpServers` and
  **takes precedence over** the user-level file `install.R` writes, so shipping one
  silently overrode every student's working install. Its `{env:TUTOR_TOKEN}` /
  `{env:TUTOR_STUDENT}` placeholders were never expanded by anything — the literal
  string `{env:TUTOR_STUDENT}` went out as the username header, the server rejected
  it as invalid, and Posit Assistant dropped the server. The symptom was a tutor
  that loaded, tutored, and had no tools, with nothing indicating why.

  The file now contains only a `permission` block pre-approving
  `mcp__tutor__check_connection` and `mcp__tutor__get_task_context`. Without it each
  student meets a permission prompt on the first lookup, and dismissing it yields a
  tutor that still talks but cannot see the reference solution — vaguer hints, no
  error. Skills, agents and permissions from a workspace `.posit/` all work; only
  the server config has to come from `install.R`.

### Fixed

- **Sourcing `install.R` printed nothing**, which reads exactly like a failed
  install — the file only defines functions. It now prints what to run next.
- Documented the **permission prompt**: the first tutor lookup makes Positron ask
  whether to allow the course server (*Allow* / *Allow for this Session* /
  *Always Allow*). Dismissing it leaves a tutor that still talks but can no longer
  see the reference solution — vaguer hints with no error to explain them. Covered
  now in the README, the lab-repo template, the tutorial, and `install_tutor()`'s
  own closing message.
- **The dashboard could never connect.** `dashboard.qmd` passed the whole
  `postgresql://…` URL as `dbname` on the belief that libpq would expand it.
  RPostgres does not, so it was read as a literal database name and the connection
  silently fell back to `localhost:5432`, failing with a `connection refused` that
  pointed nowhere near the cause. The URL is now split into host/port/user/password.
  `bigint = "integer"` was added at the same time, so a SQL `count(*)` prints as
  `54` rather than `2.667954e-322`.

### Changed

- **README and TUTORIAL now separate the two audiences.** The README opens with a
  two-row table sending students and instructors to different halves, and the
  student half is first and self-contained — setup, use, its own troubleshooting
  table, and the disclosure. TUTORIAL says up front that it is written for
  instructors and links students elsewhere.
- **Corrected the claim that students install nothing.** They run `install.R`; a
  workspace `.posit/` supplies skills but not MCP servers, so a lab repo alone
  produces a tutor that loads, tutors and never connects. The lab-repo template
  README no longer tells students to set `TUTOR_TOKEN` and `TUTOR_STUDENT` in
  `~/.Renviron`, which never reached the process that reads them.
- Test count corrected to 45 (the README said 21, this file said 43).
- The tutorial's deploy step omitted `npm run add-course` and the now-mandatory
  `--course` flag on `npm run load`, so following it verbatim exited with an error.
- The dashboard section of the README said only "set `TUTOR_DATABASE_URL` … then
  render it". It now covers the R packages, how to get a public endpoint for the
  Postgres service, the `quarto render` invocation, and `TUTOR_COURSE`.

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
- **Test suite** (`npm test`) — 45 tests over the Quarto parser plus auth, identity
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
