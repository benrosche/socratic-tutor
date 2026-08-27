# Course labs — with the Socratic Tutor

> **Instructor:** copy this file into your lab repo and edit the bracketed parts.
> The disclosure section is not optional — students must be told what is recorded.

This repository holds the lab notebooks for [COURSE NAME]. It also ships a
**Socratic Tutor** you can ask for help while you work.

The tutor has seen the reference solution. It will not give it to you. It will tell
you what you are missing, ask you a question, and nudge you one step further.

---

## One-time setup

Run this in the R console. It loads the installer and prints what to do next:

```r
source("https://raw.githubusercontent.com/benrosche/socratic-tutor/master/install.R")
```

Then, with the class token [INSTRUCTOR] gave you:

```r
install_tutor(
  token   = "[the token your instructor gave you]",
  student = "[your GitHub username]"
)
```

It will tell you whether it worked:

```
  Connected to the course server.
    course        : [YOUR COURSE]
    it sees you as: [your username]
    exercises     : [N] loaded
```

If it says anything else, the tutor will not work and restarting will not fix it —
sort out what it reports first, or ask [INSTRUCTOR].

Finally, **quit Positron completely** — every window, not a reload — and reopen it.

To check later, run `tutor_check()` in the console. To remove it,
`uninstall_tutor()`.

---

## Using it

Each exercise chunk carries a marker telling the tutor which task you are on:

```r
#| task: r-lab-1

# your code here
```

Then either:

- **Select "Tutor"** from the dropdown at the bottom of the chat pane, and ask
  normally. Everything you ask stays in tutor mode.
- Or type **`/tutor`** followed by your question, for a one-off.

**If Positron asks whether to allow the tutor to use the course server**, choose
**Always Allow**. This repo normally pre-approves it so you never see the prompt —
but if you do, say yes. A tutor that has been denied keeps talking and can no
longer see the reference solution, so the hints go vague with nothing explaining
why. Ask again and accept if that happens.

Good questions to ask it:

> I'm not sure where to start on this one.

> My function returns 21 but the example says 12.

> Why does this line throw a subscript error?

The tutor gets more concrete the more you ask about the same task. The first answer
is usually a question back; by the third you'll get a small illustrative snippet.
That's deliberate — the struggle is the part that teaches.

**It won't write code into your files.** That's not a bug.

### Is it working?

Ask it:

> `/tutor are you connected?`

It will tell you whether it can reach the course server, **which username it sees
for you**, and how many exercises are loaded. If the username is wrong, re-run
`install_tutor()` with the right one and restart Positron.

If it says it has no server connection, it will still help you — just without
checking your work against the reference solution. Tell [INSTRUCTOR] if that
happens.

---

## What is recorded

Every time you ask the tutor for help, the following is stored in the course
database:

- The GitHub username you gave to `install_tutor()`
- Which task you asked about, and how many times you've asked about it
- **The text of your question, exactly as you typed it**
- The time

[INSTRUCTOR NAME] reads this to see which exercises the class is finding hard.
It is **not** used for grading. [Records are deleted at the end of the semester /
STATE YOUR RETENTION POLICY.]

If you would rather not have a question recorded, don't ask the tutor — ask in
office hours or on [FORUM].

---

## If it stops working

First run `tutor_check()` in the R console — it tests the connection directly and
says which part is broken.

| What you see | Fix |
|---|---|
| Sourcing the installer printed only "loaded" | That's correct. It just defines the commands — you still have to run `install_tutor(...)`. |
| "the server rejected the class token" | Wrong token. Ask [INSTRUCTOR]. |
| Tutor says no connection, but `tutor_check()` works | You reloaded instead of fully quitting Positron. Close every window and reopen. |
| Tutor says no connection, and `tutor_check()` says "not installed yet" | Run `install_tutor(...)` — sourcing alone doesn't install. |
| Wrong username reported | Re-run `install_tutor()` with the right one, then restart. |
| Tutor doesn't know your exercise | The `#\| task:` marker has no solution behind it. Tell [INSTRUCTOR] — you can't fix this one. |
| Vague, generic hints | You may have denied the permission prompt. Ask again and choose *Allow* / *Always Allow*. Otherwise ask `/tutor are you connected?`. |
