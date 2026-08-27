# Course labs — with the Socratic Tutor

> **Instructor:** copy this file into your lab repo and edit the bracketed parts.
> The disclosure section is not optional — students must be told what is recorded.

This repository holds the lab notebooks for [COURSE NAME]. It also ships a
**Socratic Tutor** you can ask for help while you work.

The tutor has seen the reference solution. It will not give it to you. It will tell
you what you are missing, ask you a question, and nudge you one step further.

---

## One-time setup

Add two lines to your `~/.Renviron` file (create it if it doesn't exist), then
**restart Positron**:

```
TUTOR_TOKEN=[the token your instructor gave you]
TUTOR_STUDENT=[your GitHub username]
```

In Positron you can open the file with:

```r
usethis::edit_r_environ()
```

That's it. Nothing to install.

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
for you**, and how many exercises are loaded. If the username is wrong, fix
`TUTOR_STUDENT` and restart Positron.

If it says it has no server connection, it will still help you — just without
checking your work against the reference solution. Tell [INSTRUCTOR] if that
happens.

---

## What is recorded

Every time you ask the tutor for help, the following is stored in the course
database:

- The GitHub username you set in `TUTOR_STUDENT`
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

| What you see | Fix |
|---|---|
| "Missing or invalid class token" | Check `TUTOR_TOKEN` in `~/.Renviron`, then restart Positron. |
| "No student identifier" | Set `TUTOR_STUDENT` to your GitHub username, then restart Positron. |
| Tutor doesn't know your task | Check the `#| task:` marker matches the exercise you're on. |
| Vague, generic hints | The tutor probably can't reach the server. Tell [INSTRUCTOR]. |
