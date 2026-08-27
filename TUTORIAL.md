# A Socratic AI tutor for programming classes

> **This is written for instructors** — why the thing exists, what it costs, and how
> to stand one up for your own course.
>
> **If you are a student in a course that already uses it**, you want two minutes of
> setup instead of an essay: see [For students](README.md#for-students) in the
> README, or your own course's lab repo README, which your instructor has filled in
> with the specifics.

## The problem

Teaching programming to a roomful of students is, before anything else, an attention-allocation problem. Twenty students get stuck on twenty different things at the same moment, and the instructor can only be in one place at once. The pressure to relieve that by handing out the worked solutions is constant — but doing so quietly undermines the thing you were trying to teach. Reading the solution feels like progress; it tells the student *what* the answer is without forcing them through the discomfort that builds the skill. Most students, given the choice between struggling for twenty minutes and copying a working snippet, copy. They are not wrong to: the immediate reward is real. But the productive struggle is the part that sticks.

The other tools available to a student in 2026 push in the same direction. A general-purpose chat assistant, asked "how do I solve this?", will gladly produce a clean, runnable solution — often within seconds. From the student's point of view, that is indistinguishable from getting the answer from the instructor. The fact that an AI happens to be the one handing it over does not change what was lost.

What would help, instead, is a tutor that has seen the reference solution but is constrained to never give it away. A tutor that asks where you are stuck, points at the missing concept, and nudges you one step further, but stops short of completing the task. That is what this project is.

## The idea

The tutor is a **skill** in Posit Assistant, backed by a small **MCP server** you run.

When a student selects *Tutor* from the agent dropdown and writes "I'm stuck":

1. The skill reads a task identifier the student has marked in their notebook (e.g. `#| task: r-lab-1`).
2. It calls `get_task_context` on your server, which looks up the reference solution and returns it as private model context — along with an escalation level.
3. The model replies with a diagnosis, a question, or a small scaffold, calibrated to that level.
4. The request is logged, so you can see where the class is stuck.

The student never sees the reference solution. The model uses it only as ground truth for diagnosing what is missing and deciding how strong a hint to give.

## What it looks like

> **Student:** *my model won't converge — what am I doing wrong?*
>
> **Tutor:** *Before we look at the model, what assumption is your formula making about which variables are part of the network and which are node attributes? Try running `summary()` on your network object first and tell me what you see.*
>
> **Student:** *(pastes summary output)*
>
> **Tutor:** *Good — notice that your tie variable is being read as a node attribute, not an edge. Your formula is then asking the estimator to predict something that isn't in the data. Look at the line where you build the network object; one argument is in the wrong position.*

## The escalation ladder, and why it needs a server

The tutor's responses get more concrete the longer a student is stuck: a guiding question first, then a scaffold, then a one-or-two-line snippet. The obvious way to implement this is to count turns in the conversation — which is what v0.1 did, and it has a hole you can drive a truck through. Open a new chat, and you're back at rung one.

Because the level is computed in Postgres from the request history, it survives fresh chat windows, restarts, and reinstalls. A student on their fourth ask about `r-lab-3` gets a fourth-ask answer even if this particular chat is thirty seconds old.

That is the one thing no purely client-side design can do, and it is most of the reason the server exists. The other reason is the dashboard.

## Seeing where the class is stuck

Every request is logged: student, task, level, question text, timestamp. A Quarto report renders that into the things you actually want to know.

The most useful panel is not "requests per task" but **the share of students who reached level 3 or higher**. A task with many requests but mostly level 1 is producing quick clarifications — probably a wording problem in the prompt. A task where half the class reaches level 3 is a task where people are genuinely stuck, and that is the one to rewrite.

The second most useful panel is the raw text of what students typed. Counts tell you *where*; the wording tells you *why*.

Two honest caveats. It measures asking, not struggling — a task with zero requests is ambiguous between "everyone got it" and "nobody tried it", so pair it with submission data before you act. And with thirty students across forty tasks the cells are thin; treat the top few tasks as signal and the rest as noise.

## How it works under the hood

- **Task ID detection.** The skill reads the `#| task: <id>` marker from the active editor, which Posit Assistant attaches as context by default. In v0.1 this was a regex scan in extension code; now it is a sentence of prose in a markdown file.
- **Solution storage.** A loader script parses your private solution notebooks and upserts them into Postgres. Solutions never live in the public repo or in the deployment, and **updating them needs no redeploy**.
- **Solution extraction.** Inside a notebook, the parser finds the heading whose text contains `{r-lab-1}`, then scans forward for the next Quarto callout titled `"Solution"` and captures its body, respecting nested fenced divs. This code is moved verbatim from v0.1 — it never depended on VS Code, so the notebook format you have already authored against is unchanged.
- **The skill.** The pedagogy — diagnose before answering, prefer questions to scaffolds and scaffolds to snippets, escalate, never reproduce the solution — lives in `SKILL.md` in the lab repo. It follows the Agent Skills spec, so the same file works in Claude Code and other compliant assistants.
- **Tool restriction.** The `Tutor` agent's `tools:` list omits editing and code execution. In v0.1, "don't write the solution into their file" was a request to the model. Now it is a capability the tutor doesn't have.

## Setting it up for your course

### Step 1 — Prepare your solutions repo

A private repo with one Quarto file per lesson. The structure, which
`templates/solution-template.qmd` demonstrates:

````markdown
# Sum the even numbers in a vector `{r-lab-1}`

**To-do:** Write a function `sum_even(x)` that returns the sum of all even numbers.

::: {.callout-caution collapse="true" title="Solution"}

```r
sum_even <- function(x) sum(x[x %% 2 == 0])
```

**Key points:**

- `x %% 2 == 0` produces a logical vector marking even entries.
:::
````

Two requirements, one of which the v0.1 docs got wrong:

- The heading must contain the task ID inside **bare braces**: `` `{r-lab-1}` ``. The parser matches the literal `{r-lab-1}` including the braces. The old tutorial claimed a Quarto anchor like `{#sec-r-lab-1 .task}` would also work *because the anchor contains the bare token* — it does not, and it never did. The shipped template always used the correct form, so notebooks written from it are fine.
- The solution must be wrapped in a callout titled `"Solution"`. Any callout type works; only the title matters.

### Step 2 — Deploy

Railway project → add Postgres → add a service from this repo with **Root Directory** `server`. Set `DATABASE_URL` to the Postgres reference. Then from `server/`:

```bash
npm install
npm run migrate                                  # create the tables
npm run add-course -- my-course-2026             # issue the class token — printed once
npm run load -- ../../my-solutions --course my-course-2026
```

The token *is* the course identity, so one server and one database serve any number
of classes and a token issued for one cannot reach another's solutions. The loader
refuses a course that does not exist, which makes the mistake hard to make.

`curl https://<app>.up.railway.app/healthz` should return `{"ok":true}`.

Then check that every exercise students can ask about actually has a solution behind
it — the one failure a clean load cannot catch, because it spans two repos:

```bash
npm run verify -- ../../my-lab-repo/labs --course my-course-2026
```

It exits non-zero and names the task IDs, so you can gate a publish on it.

### Step 3 — Wire up the lab repo

Copy `templates/lab-repo/.posit/` into the repo your students clone, and
`templates/lab-repo/README.md` too, filling in the disclosure section.

This gives students the **skill** and the **Tutor agent**. It does not connect them
to your server, and this is the one thing worth knowing before you spend an evening
debugging it: Posit Assistant reads skills from a workspace directory, but reads
`mcpServers` only from the user-level `<home>/.posit/assistant/settings.json`. Ship
a `settings.json` in the lab repo and you get a tutor that loads, tutors, and never
connects — silently, because from the model's side the tools simply do not exist.

### Step 4 — Point students at the installer

Change the `url` default in `install.R` to your server, then give students the class
token. They run one line in the R console:

```r
source("https://raw.githubusercontent.com/benrosche/socratic-tutor/master/install.R")
install_tutor(token = "...", student = "their-github-username")
```

It writes user-level config, then calls your server and reports the course, the
identity the server sees, and how many exercises are loaded — so a student knows
immediately whether it worked, rather than discovering it mid-lab. `tutor_check()`
re-runs that test later; `uninstall_tutor()` reverses it.

Then tell them to mark their cursor's chunk with `#| task:` — or rather, don't:
the markers are already in the worksheets you generated. Just tell them not to
delete them.

No extension to install, and the class token never lives in the lab repo.

## Customizing the tutor for your domain

The default skill is deliberately generic — it says "programming exercises" and avoids naming a language. For your course you will want to name the language, mention the libraries students should reach for first, and swap the Socratic example questions for ones in your domain's vocabulary.

The difference from v0.1 is that this is now just a markdown file. Edit it and commit; students pick it up by re-running `install_tutor()`, which re-downloads the skill — one line in the console. In v0.1 the same change meant editing the prompt, running `vsce package`, uploading a release, and asking twenty students to reinstall, which in practice meant the prompt was written once and never tuned. Tuning it against real student interactions is the whole game, so lowering that cost matters more than it sounds.

## Honest caveats

- **Students can read the skill.** It is a file in their open project. They can read the escalation policy, and they can edit or delete it. The `.vsix` was extractable too, but "unzip and rebuild an extension" and "open a file that's already in your editor" are different levels of friction. There is no technical fix. Some instructors will prefer to show it to students deliberately and talk about why the constraint is there — in a course where students will use AI professionally, that is a lesson rather than a leak.

- **It doesn't stop the plain Agent.** The dropdown that offers *Tutor* also offers *Agent*, which will happily write the function. The tutor is now an opt-in mode, not a gatekeeper. A project-level `permission` block denying `edit` in the lab repo makes the tutor the path of least resistance, but it is a speed bump — the setting is a text file students can change. Past that, this is a course-design question about what you grade, not a tooling one.

- **The class token is shared, and the payload contains the solution.** Together those mean a determined student can extract every solution via the API. Rate limiting, rotating the token each semester, and the dashboard's visibility all raise the cost, but none of them close it. If that trade is wrong for you, strip fenced code from the payload in the loader and keep the prose — the `**Key points:**` sections exist for exactly that, and it is about ten lines.

- **Tool results may be visible.** Depending on your Positron version, a student may be able to expand a tool call in the transcript and read what came back. Check this. If they can, the reference solution is one click away — weaker than v0.1, where it lived in an invisible prompt.

- **Identity is self-reported.** The username a student passes to `install_tutor()` is written into their own config and sent as a header; it is a label, not authentication. Anyone with the class token can claim any name. Fine for "which tasks is the class finding hard", unfit for anything touching a grade.

- **This is not a replacement for office hours.** It is a partial substitute for "I can't be everywhere at once" — not for the deeper guidance that comes from a human reading what a student has been struggling with for a week.

## Try it

The code is at [github.com/benrosche/socratic-tutor](https://github.com/benrosche/socratic-tutor). If you adopt it for your course, I'd be interested to hear how it goes — both the wins and the places where the model's hint quality breaks down.
