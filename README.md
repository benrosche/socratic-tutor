# Socratic Tutor

A Socratic programming tutor for **Positron / Posit Assistant**. It helps students
work through lab exercises **without giving them the answer**: it looks up the
instructor's reference solution for whichever task the student is on, then replies
only with diagnoses, guiding questions and small scaffolds.

Students get it by cloning the course lab repo. There is nothing to install, and no
credentials of yours end up on their machines.

For the motivation and a full walkthrough, see [`TUTORIAL.md`](TUTORIAL.md).

> **Upgrading from v0.1?** The VS Code extension is archived at
> [`legacy/vscode-extension/`](legacy/vscode-extension/). It still works in stock
> VS Code + Copilot but **not** in Positron 2026.07 or later, which replaced
> Positron Assistant with Posit Assistant and dropped the chat-participant surface
> `@tutor` depended on.

---

## How it works

```
socratic-tutor-solutions   (private repo)     .qmd notebooks with Solution callouts
        │  npm run load  — run locally, on demand
        ▼
   Railway Postgres  ── tasks | events ──►  dashboard.qmd  (rendered locally)
        ▲
        │
   Railway service: MCP server  ◄── https ──  Positron / Posit Assistant
                                              tutor skill + Tutor agent
```

1. A student writes code in a Quarto notebook with a task marker like `#| task: r-lab-1`.
2. They pick **Tutor** from the agent dropdown, or type `/tutor`, and ask for help.
3. The skill reads the task marker and calls `get_task_context` on your MCP server.
4. The server returns the reference solution as private model context, plus a
   **persistent escalation level** — how many times *this student* has asked about
   *this task*, counted across chat sessions.
5. The tutor replies with a hint calibrated to that level, and the request is logged
   so you can see where the class is stuck.

The escalation ladder is the part client-side tooling cannot do: opening a fresh
chat window does not reset it.

---

## What you need

- Positron **2026.07 or later** (Posit Assistant). Earlier versions shipped the
  deprecated Positron Assistant and behave differently.
- A [Railway](https://railway.app) account — one small Node service plus a Postgres
  add-on.
- A private GitHub repository holding your reference solutions as Quarto notebooks.
- R with `DBI`, `RPostgres`, `dplyr`, `ggplot2` if you want the dashboard.

---

## Instructor setup

### 1. Deploy the server

Create a Railway project, add a **Postgres** database, then add a service from this
repository and set its **Root Directory** to `server`. Railway reads
[`server/railway.toml`](server/railway.toml) for the build and health-check config.

Set these service variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Reference the Postgres add-on (`${{Postgres.DATABASE_URL}}`) |
| `CLASS_TOKEN` | A secret you generate — `openssl rand -hex 24`. This is what students receive. |
| `RATE_LIMIT` | Optional, default `30` requests per window |
| `RATE_WINDOW_MINUTES` | Optional, default `10` |

Once deployed, check it:

```bash
curl https://<your-app>.up.railway.app/healthz
# {"ok":true}
```

### 2. Create the tables

From `server/`, with `DATABASE_URL` pointing at the **public** Railway connection
string:

```bash
npm install
npm run migrate
```

### 3. Load your solutions

```bash
npm run load -- ../../socratic-tutor-solutions/notebook-solutions
```

Add `--dry-run` to preview, and `--prune` to delete tasks that no longer exist in
your notebooks. The loader prints every task it found, so a malformed callout shows
up immediately rather than during a lab.

Solutions live in Postgres, not in this repo and not in the deployment. **Content
updates need no redeploy** — re-run `npm run load` and the change is live.

### 4. Set up the lab repo

Copy [`templates/lab-repo/.posit/`](templates/lab-repo/.posit/) into the repository
your students clone, and edit `settings.json` to replace `REPLACE-ME` with your
Railway URL.

That directory contains three things:

- `skills/tutor/SKILL.md` — the pedagogy. Invoked as `/tutor`.
- `agents/tutor.agent.md` — the **Tutor** entry in the agent dropdown. Its `tools:`
  list omits editing and code execution, so the tutor structurally cannot write into
  a student's file.
- `settings.json` — points Posit Assistant at your server.

> The `tools:` names in the agent file should be reconciled with what your Positron
> version offers. Run **Chat: New Custom Agent…** from the Command Palette to
> generate a file listing the available tools, and adjust if they differ.

### 5. Hand out the token

Give students the `CLASS_TOKEN` value. One shared token for the class; rotate it
each semester.

---

## Student setup

Two lines in `~/.Renviron`, then restart Positron:

```
TUTOR_TOKEN=<the token your instructor gave you>
TUTOR_STUDENT=<your GitHub username>
```

Then, in a notebook with a `#| task:` marker, select **Tutor** from the dropdown at
the bottom of the chat pane and ask away:

> My ERGM won't converge — what am I doing wrong?

Or use `/tutor <question>` for a one-off without switching modes.

### Checking the connection

Ask the tutor directly:

> `/tutor are you connected?`

It calls `check_connection` and reports whether the server is reachable, **which
username the server sees for you** (the fastest way to catch a typo'd
`TUTOR_STUDENT`), how many tasks are loaded, and your request count in the current
rate-limit window.

If the tutor answers that it is running *without* a server connection, that is a
real answer, not a failure to try: the skill instructs it to say so plainly rather
than claim a connection it cannot verify. Hints still work — they are just based on
your code alone, with no reference solution and no memory of how often you have
asked.

---

## Solution file format

A ready-to-edit starter notebook lives at
[`templates/solution-template.qmd`](templates/solution-template.qmd).

- **One file per notebook or lesson.** Task IDs are `<notebook>-<n>`, so `r-lab-1`
  and `r-lab-2` both belong to notebook `r-lab`.
- **Each task is a heading containing its ID in bare braces:**

  ```markdown
  # Sum the even numbers in a vector `{r-lab-1}`
  ```

  The parser matches the literal `{r-lab-1}`, braces included. Quarto attribute
  blocks such as `{#sec-r-lab-1 .task}` do **not** match — the v0.1 docs claimed
  they did, and that was wrong.

- **Below the heading, a Quarto callout titled `"Solution"`:**

  ````markdown
  ::: {.callout-caution collapse="true" title="Solution"}

  ```r
  sum_even <- function(x) sum(x[x %% 2 == 0])
  ```

  **Key points:**

  - `x %% 2 == 0` produces a logical vector marking even entries.
  :::
  ````

  Any callout type works; only `title="Solution"` matters. Everything between the
  opening `:::` and its matching close is stored, respecting nested fenced divs.

---

## The dashboard

[`dashboard/dashboard.qmd`](dashboard/dashboard.qmd) renders locally against the
database. Set `TUTOR_DATABASE_URL` in `~/.Renviron` to the Railway **public**
connection string, then render it.

It answers:

- Which tasks generate the most requests.
- **Which tasks leave students genuinely stuck** — the share reaching level 3+,
  which separates a quick clarification from real confusion. This is the metric v0.1
  could not produce.
- Whether requests are concentrated in a few students or spread across the class.
- When the work actually happens.
- **What students typed, verbatim.**

Two caveats worth keeping in mind. It measures *asking*, not struggling: a task with
zero requests may mean everyone understood it or that nobody attempted it. And with
a class of thirty across forty tasks, most cells are thin — treat the top few tasks
as signal and the rest as noise.

The rendered HTML contains student data and is gitignored. Keep it local.

---

## Data collected and disclosure

**Every tutor request is logged.** The `events` table records:

| Field | Contents |
|---|---|
| `student` | The GitHub username the student set in `TUTOR_STUDENT`, lowercased |
| `task_id` | Which task they asked about |
| `level` | How many times they have asked about that task |
| `question` | **The text of their question, verbatim** |
| `ts` | Timestamp |

The instructor reads this data. Students must be told, in the syllabus and in the
lab repo's own README, that their questions are recorded and by whom they are read.
Decide and state a retention period — deleting the `events` rows at the end of each
semester is a reasonable default.

`TUTOR_STUDENT` is **self-reported and not authenticated**. It is a label for
grouping requests, not proof of identity: a student can type someone else's username
or change their own. Do not use this data for grading or for any decision that
requires the identity to be reliable.

---

## Security model, honestly

The class token is **shared across the class** and the payload contains the **full
reference solution**. Together that means a determined student can call the API
directly and extract every solution, and the token will eventually be shared.

What limits this:

- Per-student rate limiting (`RATE_LIMIT`, default 30 requests per 10 minutes).
- Rotating `CLASS_TOKEN` each semester.
- The dashboard — a student hitting forty tasks in two minutes is conspicuous.

If that trade is wrong for your course, the cheapest hardening is to stop shipping
working code in the payload: strip fenced code blocks in the loader and keep the
prose. The template's `**Key points:**` sections are written for exactly this, and
it is about ten lines in `server/src/load-solutions.ts`.

Also note that MCP tool results may be inspectable in the chat transcript, depending
on your Positron version. Check whether a student can expand a tool call and read
its payload — if they can, the reference solution is one click away, which is weaker
than v0.1, where it lived in an invisible prompt.

---

## Troubleshooting

Start with `/tutor are you connected?` — it distinguishes "no server", "server up
but no content loaded", and "server up but database down", which need different
fixes.

| Symptom | Cause |
|---|---|
| Tutor says it has no server connection | The MCP server isn't configured or reachable. Check `settings.json` has your real Railway URL, and that both env vars are set. |
| `check_connection` reports 0 tasks loaded | Server and database are fine; you haven't run `npm run load` yet. |
| `check_connection` reports `database: unreachable` | The service is up but `DATABASE_URL` is wrong or Postgres is down. |
| `student_seen_by_server` is not your username | Typo in `TUTOR_STUDENT`. Fix it and restart Positron, or your history splits across two identities. |
| `401 unauthorized` | `TUTOR_TOKEN` missing or wrong. Set it in `~/.Renviron` and restart Positron. |
| `400 missing_student` | `TUTOR_STUDENT` not set. |
| `400 invalid_student` | The value isn't a valid GitHub username (letters, digits, hyphens). |
| Tutor says the task is unknown | The `#| task:` ID has no match. The error lists known IDs in that notebook. |
| `/healthz` returns 503 | The service is up but cannot reach Postgres. Check `DATABASE_URL`. |
| Tutor works but gives generic hints | The tool call is probably failing. The skill degrades to code-only tutoring by design; check the server logs. |
| Slow first response of the day | Railway cold start. Check whether your plan keeps the service warm. |

---

## Running the tests

The escalation counter is SQL, so the suite runs against a real Postgres rather
than a mock — testing it against a fake would test the fake.

```bash
docker run -d --name tutor-test-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=tutor_test -p 5433:5432 postgres:16-alpine

cd server
DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/tutor_test npm test
```

21 tests covering auth and identity handling, the connection diagnostic, solution
lookup, escalation (including that it increments across *independent* requests —
the "student opened a fresh chat" case), event logging, and per-student rate
limiting.

The suite `TRUNCATE`s its tables, so it refuses to run unless the database name
contains `test`. Point it at your Railway database and it aborts with the password
masked rather than deleting your data.

---

## Customizing the tutor

The tutoring style lives in
[`templates/lab-repo/.posit/assistant/skills/tutor/SKILL.md`](templates/lab-repo/.posit/assistant/skills/tutor/SKILL.md).
It is plain markdown in the lab repo, so you can edit it, commit, and have students
pull — no rebuild and no redistribution. That is the main practical gain over v0.1,
where changing a hint policy meant repackaging a `.vsix`.

Being a plain file also means students can read it, and edit or delete it. There is
no technical fix for that. Some instructors will prefer to show it to them
deliberately and discuss why the constraint exists.

The skill follows the Agent Skills spec, so it also works in Claude Code and other
spec-compliant assistants.

---

## License

MIT. See [LICENSE.md](LICENSE.md).
