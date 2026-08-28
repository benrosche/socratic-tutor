# Socratic Tutor

A Socratic programming tutor for **Positron / Posit Assistant**. It helps students
work through lab exercises **without giving them the answer**: it looks up the
instructor's reference solution for whichever task the student is on, then replies
only with diagnoses, guiding questions and small scaffolds.

For the motivation and a full walkthrough, see [`TUTORIAL.md`](TUTORIAL.md).

### Which half of this do you need?

| You are | Start here | Takes |
|---|---|---|
| **A student** in a course that uses this | [For students](#for-students) | About two minutes — one line in the R console |
| **An instructor** setting this up for a class | [For instructors](#for-instructors) | An afternoon, most of it Railway |

Students need the class token from their instructor and nothing else. Instructors
need a Railway account and a repo of reference solutions.

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

## For students

Everything below this heading is for you. The rest of the README is your
instructor's problem.

You need **Positron 2026.07 or later**, and the **class token** your instructor
handed out. Nothing else.

### Install it

One line in the R console:

```r
source("https://raw.githubusercontent.com/benrosche/socratic-tutor/master/install.R")
```

That only loads the installer and tells you what to run next. Then:

```r
install_tutor(
  token   = "<the token your instructor gave you>",
  student = "<your GitHub username>"
)
```

Add `url = "https://<your-course-server>.up.railway.app"` if your instructor gives
you one; otherwise the default is used.

It writes the files, then **calls your course server and tells you what came back**:

```
  Connected to the course server.
    course        : sna-2026-fall
    it sees you as: benrosche
    exercises     : 54 loaded
```

If it says anything else — a rejected token, an unreachable server — the tutor will
not work, and restarting Positron will not fix it. Fix what it reports first.

Then **quit Positron completely** (every window, not a reload) and reopen it. Ask:

> `/tutor are you connected?`

It should report the same course and username. You can re-run `tutor_check()` in the
R console at any time without retyping the token, and `uninstall_tutor()` reverses
the install.

### Use it

In a notebook with a `#| task:` marker, select **Tutor** from the dropdown at the
bottom of the chat pane and ask away:

> My ERGM won't converge — what am I doing wrong?

Or use `/tutor <question>` for a one-off without switching modes.

**If Positron asks whether to allow the tutor to use the course server**, choose
**Always Allow**. Most course repos pre-approve this so you never see the prompt,
but if yours doesn't, that prompt is what stands between you and useful hints: a
tutor that has been denied keeps talking but can no longer see the reference
solution, so its hints get noticeably vaguer with no error to explain why. If that
happens, ask again and accept.

The tutor gets more concrete the more you ask about the **same** task: the first
answer is usually a question back, and by the third you get a small illustrative
snippet. Opening a fresh chat does not reset that, so there is nothing to game. It
will not write code into your files — that is a capability restriction, not a mood.

If the tutor says it is running *without* a server connection, that is a real
answer rather than a failure to try: it is instructed to say so plainly rather than
claim a connection it cannot verify. Hints still work, just from your code alone,
with no reference solution.

### If something is wrong

| Symptom | Fix |
|---|---|
| `install_tutor()` says the token was rejected (401) | Wrong class token. Ask your instructor. |
| `install_tutor()` cannot reach the server | Check your internet. If it persists, tell your instructor — it is probably their server. |
| Sourcing the installer printed nothing but "loaded" | That is correct. It only defines the commands; you still have to run `install_tutor(...)`. |
| Tutor says it has no server connection, but `tutor_check()` is fine | You did not fully quit Positron. Close every window and reopen. |
| `student_seen_by_server` is not your username | Re-run `install_tutor()` with the right username, or your history splits across two identities. |
| Tutor does not know your exercise | The `#| task:` marker has no solution behind it. Tell your instructor — it is not something you can fix. |
| Vague, generic hints | You may have denied the permission prompt. Ask again and choose *Allow* / *Always Allow*. Otherwise ask `/tutor are you connected?`. |

### What is recorded

Every request you make is logged: your username, which task, how many times you
have asked about it, **the text of your question verbatim**, and the time. Your
instructor reads this to see which exercises the class finds hard. See
[Data collected and disclosure](#data-collected-and-disclosure) for the full detail,
and ask your instructor about their retention policy.

---

## For instructors

Everything from here down is setup and operation. Students do not need any of it.

### What you need

- Positron **2026.07 or later** (Posit Assistant). Earlier versions shipped the
  deprecated Positron Assistant and behave differently.
- A [Railway](https://railway.app) account — one small Node service plus a Postgres
  add-on.
- A private GitHub repository holding your reference solutions as Quarto notebooks.
- R with `DBI`, `RPostgres`, `dplyr`, `ggplot2` if you want the dashboard.

---

## Setup, step by step

### 1. Deploy the server

Create a Railway project, add a **Postgres** database, then add a service from this
repository and set:

| Setting | Value |
|---|---|
| Source Repo | your fork of this repo |
| **Root Directory** | **`/server`** |
| Branch | `master` |
| Auto deploy | on |

Everything the deploy needs lives in `server/` — [`Dockerfile`](server/Dockerfile),
[`railway.toml`](server/railway.toml), and the schema, which is embedded in
`src/schema.ts` rather than shipped as a separate file. Nothing is referenced from
outside that directory, so the build context is exactly the root directory you set.

You can build the identical production image locally:

```bash
cd server
docker build -t tutor-server .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='postgresql://...?sslmode=disable' tutor-server
```

Set these service variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Reference the Postgres add-on (`${{Postgres.DATABASE_URL}}`) |
| `RATE_LIMIT` | Optional, default `30` requests per window |
| `RATE_WINDOW_MINUTES` | Optional, default `10` |
| `DASHBOARD_PASSWORD` | Optional. Enables the hosted dashboard at `/dashboard`. **Not** the class token — see [The dashboard](#the-dashboard) |

Class tokens are **not** environment variables — they live in the database, one per
course. See step 3.

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

### 3. Create the course and load its solutions

Each course gets its own class token, and that token is what identifies the course
to the server:

```bash
npm run add-course -- sna-2026-fall
```

This prints the token **once** — only its hash is stored. Pass `--token <value>` to
choose your own, or run it again on an existing course to rotate.

```bash
npm run load -- ../../socratic-tutor-solutions/sna-2026-fall --course sna-2026-fall
```

Add `--dry-run` to preview, and `--prune` to delete tasks that no longer exist in
your notebooks. The loader prints every task it found, so a malformed callout shows
up immediately rather than during a lab.

Solutions live in Postgres, not in this repo and not in the deployment. **Content
updates need no redeploy** — re-run `npm run load` and the change is live.

### 4. Check that every exercise has a solution

Task IDs live in two repos — the `#| task:` markers in the notebooks students open,
and the solution notebooks the loader reads. Nothing keeps them in step, and the
mismatch only shows up as "solution not found" in the middle of a lab:

```bash
npm run verify -- ../../your-lab-repo/labs --course sna-2026-fall
```

It reports per notebook how many markers resolve, names every marker with no
solution loaded, and exits non-zero — so you can gate publishing on it. Pass
`--pattern` if your student notebooks are not named `*-student.qmd`.

This is the failure a clean `npm run load` cannot catch: the loader only sees the
solutions repo, so it cannot know an exercise exists that nothing answers. Task IDs
come from the solution notebook's **filename**, so a renamed lab breaks the link
even when both sides look correct.

### 5. Set up the lab repo

Copy [`templates/lab-repo/.posit/`](templates/lab-repo/.posit/) into the repository
your students clone, and edit `settings.json` to replace `REPLACE-ME` with your
Railway URL.

That directory contains three things:

- `skills/tutor/SKILL.md` — the pedagogy. Invoked as `/tutor`.
- `agents/tutor.agent.md` — the **Tutor** entry in the agent dropdown. Its `tools:`
  list omits editing and code execution, so the tutor structurally cannot write into
  a student's file.
- `settings.json` — **permissions only**, no `mcpServers`. See below.

The `settings.json` pre-approves the two tutor tools:

```json
{
  "permission": {
    "mcp__tutor__check_connection": { "*": "allow" },
    "mcp__tutor__get_task_context": { "*": "allow" }
  }
}
```

Without it, the first time the tutor looks something up each student gets a
permission prompt (*Allow* / *Allow for this Session* / *Always Allow*). A student
who dismisses it keeps a tutor that talks but can no longer see the reference
solution — vaguer hints, no error explaining why. Shipping the block removes the
prompt entirely. The `tutor` in `mcp__tutor__…` is the server name `install.R`
writes, so leave it alone.

> The `tools:` names in the agent file should be reconciled with what your Positron
> version offers. Run **Chat: New Custom Agent…** from the Command Palette to
> generate a file listing the available tools, and adjust if they differ.

> **Never put `mcpServers` in the lab repo's `settings.json`.** A workspace
> `.posit/assistant/settings.json` *does* configure `mcpServers` — and it **takes
> precedence over** the user-level file that `install.R` writes. So a lab repo
> carrying one silently overrides every student's working install with whatever the
> repo says. If it uses a `{env:...}` placeholder, nothing expands it: the literal
> string `{env:TUTOR_STUDENT}` is sent as the username, the server rejects it as
> invalid, and Posit Assistant drops the server. The student sees a tutor that
> loads, tutors, and has no tools — with no error pointing at the cause.
>
> Skills, agents and the `permission` block from a workspace `.posit/` are all fine
> and are why the directory exists. Only the **server config** has to come from
> `install.R`.

### 6. Hand out the token

Give students that course's token, and point them at
[For students](#for-students). It is shared across the class; rotate it each
semester with `npm run add-course -- <course>`, which prints the new token once and
stores only its hash.

Because `install_tutor()` takes the token as an argument and writes it to the
student's own machine, it never has to live in the lab repo — public or private —
and never becomes an environment variable a student has to manage. If you changed
the `url` default in `install.R` to your own server, the line students run is just:

```r
install_tutor(token = "...", student = "<their-github-username>")
```

---

## Running several classes

One server and one database serve any number of courses. The token *is* the course
identity, so a token issued for one class cannot reach another's solutions — task
lookup, suggestions, escalation counts, rate limits and logging are all scoped to
the course its token resolves to.

```bash
npm run add-course -- stats-2026-fall
npm run load -- ../../socratic-tutor-solutions/stats-2026-fall --course stats-2026-fall
npm run add-course -- --list     # courses and how many tasks each has
```

This matters more than it looks. Task IDs come from notebook filenames, so two
courses that each have an `01_intro_to_r.qmd` both produce `01_intro_to_r-1`.
Without the course dimension the second load would silently overwrite the first and
students would start receiving the other class's solutions. The loader refuses to
write to a course that does not exist, which makes that mistake hard to make.

Each course gets its own lab repo, its own `settings.json`, and its own token. The
dashboard can be filtered by course.

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

There are two views of the same request log, for two different jobs.

### Hosted — `/dashboard`

The deployed server serves a live page at `https://<your-app>.up.railway.app/dashboard`.
It queries Postgres on every load, so it is never stale and there is nothing to
render. Use it to glance at where the class is during a lab.

Enable it by setting one service variable:

```bash
railway variables -s socratic-tutor --set "DASHBOARD_PASSWORD=<a long random string>"
```

The page then asks for it over HTTP Basic auth — any username, that password.
Share it with a TA if you have one; there are no per-user accounts.

> **This must not be your class token.** Every student has that, and this page shows
> every student's questions verbatim, under their username. It is a separate secret
> on purpose, and the class token is rejected here. If `DASHBOARD_PASSWORD` is unset
> the route answers 503 rather than serving openly — an accidentally public page
> here is a privacy incident, not a bug.

Add `?course=<course>` to filter, or use the links at the top of the page when you
run several classes. The page is `noindex, nofollow`, carries no client-side
JavaScript, and escapes question text on the way out.

It shows the most-asked exercises, the share of askers reaching level 3+, who is
asking, activity by day, the last 100 questions verbatim — and **lookups that found
no solution**, which is the one panel that reports your bugs rather than the
class's: those are students hitting a `#| task:` marker with nothing behind it. Run
[`npm run verify`](#4-check-that-every-exercise-has-a-solution) to see the whole set,
including the ones nobody has hit yet.

### Local — `dashboard.qmd`

[`dashboard/dashboard.qmd`](dashboard/dashboard.qmd) renders locally against the
same database and goes deeper — it has the full R toolkit, and can be taken further
than a served page should be. **Where the two overlap, this one is the reference.**
If you want another panel, it probably belongs here rather than on the hosted page.

Once:

```r
install.packages(c("DBI", "RPostgres", "dplyr", "ggplot2", "knitr"))
```

Put the Railway **public** connection string in `~/.Renviron` (`usethis::edit_r_environ()`):

```
TUTOR_DATABASE_URL=postgresql://postgres:PASSWORD@HOST.proxy.rlwy.net:PORT/railway
```

It must be the **public proxy** host, not `*.railway.internal` — the internal
hostname only resolves inside Railway. If the Postgres service has no public
endpoint yet, create one: **Settings → Networking → TCP Proxy** on port `5432`, or
`railway tcp-proxy create -s Postgres --port 5432`.

Then render:

```bash
quarto render dashboard/dashboard.qmd
```

Set `TUTOR_COURSE` to focus a single class; leave it unset to see every course in
one report:

```bash
TUTOR_COURSE=sna-2026-fall quarto render dashboard/dashboard.qmd
```

It answers:

- Which tasks generate the most requests.
- **Which tasks leave students genuinely stuck** — the share reaching level 3+,
  which separates a quick clarification from real confusion. This is the metric v0.1
  could not produce.
- Whether requests are concentrated in a few students or spread across the class.
- When the work actually happens.
- **What students typed, verbatim.**

The rendered `dashboard.html` is gitignored. It embeds usernames and question text,
so keep it local.

### Both views, two caveats

They measure *asking*, not struggling: a task with zero requests may mean everyone
understood it or that nobody attempted it. And with a class of thirty across forty
tasks, most cells are thin — treat the top few tasks as signal and the rest as
noise. Neither view is evidence for a grade.

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

The username is **self-reported and not authenticated**. It is a label for grouping
requests, not proof of identity: a student can pass someone else's username to
`install_tutor()` or change their own. Do not use this data for grading or for any
decision that requires the identity to be reliable.

Both dashboards expose this data in full. The hosted one is password-protected with
a secret students do not have; the rendered `dashboard.html` is gitignored. Keep it
that way — the data is only as private as the least careful place you put it.

---

## Security model, honestly

The class token is **shared across the class** and the payload contains the **full
reference solution**. Together that means a determined student can call the API
directly and extract every solution, and the token will eventually be shared.

What limits this:

- Per-student rate limiting (`RATE_LIMIT`, default 30 requests per 10 minutes).
- Rotating each course's token every semester with `npm run add-course`.
- The dashboard — a student hitting forty tasks in two minutes is conspicuous, and
  the hosted view makes that visible without rendering anything.

The dashboard password is a **separate** secret from the class token, and the class
token is explicitly rejected at `/dashboard`. Do not collapse the two: the whole
point is that holding the student credential must not reveal what the class asked.

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

These are the instructor-side failures. Student-side ones are in
[If something is wrong](#if-something-is-wrong) above — point students there.

| Symptom | Cause |
|---|---|
| A student's tutor has no server connection | Have them run `tutor_check()` in the R console. It separates a bad token, an unreachable server, and a config that was never installed. |
| Tutor has no connection but `tutor_check()` succeeds | Positron was reloaded rather than fully quit. It reads `mcpServers` at startup. |
| Skill loads and tutors, but no tools are available | `mcpServers` is missing from `<home>/.posit/assistant/settings.json`. A workspace-level `.posit/assistant/settings.json` supplies **skills** but not MCP servers — students must run `install.R`. |
| `check_connection` reports 0 tasks loaded | Server and database are fine; you haven't run `npm run load` yet. |
| `check_connection` reports `database: unreachable` | The service is up but `DATABASE_URL` is wrong or Postgres is down. |
| `student_seen_by_server` is not the expected username | They installed with a typo. Re-run `install_tutor()`, or their history splits across two identities. |
| `401 unauthorized` | Wrong class token. Re-issue with `npm run add-course -- <course>` if you have lost it — it only stores the hash. |
| `400 missing_student` / `400 invalid_student` | The username is absent or isn't a valid GitHub username (letters, digits, hyphens). |
| Tutor says the task is unknown | The `#| task:` ID has no match. The error lists known IDs in that notebook. Run `npm run verify` to find every marker in this state at once, rather than discovering them one lab at a time. |
| Dashboard fails with `connection refused` on `127.0.0.1:5432` | `TUTOR_DATABASE_URL` is unset, or points at `*.railway.internal`. Use the public proxy host. |
| `/dashboard` returns 503 "Dashboard disabled" | `DASHBOARD_PASSWORD` is not set on the service. This is the safe default, not a fault. |
| `/dashboard` keeps asking for the password | Any username works; only the password is checked. If you are pasting the class token, that is deliberately rejected. |
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

45 tests: 14 over the Quarto parser (no database needed) and 31 covering auth and
identity handling, the connection diagnostic, solution lookup, escalation
(including that it increments across *independent* requests — the "student opened a
fresh chat" case), event logging, per-student rate limiting, and course isolation.

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
