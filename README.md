# Socratic Tutor for VS Code

A VS Code chat participant that helps your students work through programming exercises **without giving them the answer**. The tutor fetches the reference solution for the student's current task from a GitHub repository you control, but is instructed to respond only with diagnoses, guiding questions, and small scaffolds — never the full solution.

For the motivation behind this project and a full walkthrough of how to adopt it in your own course, see [`tutorial.md`](tutorial.md).

---

## How it works at a glance

1. A student writes code in a Quarto (`.qmd`) notebook with a task marker like `#| task: lesson-1`.
2. They open the VS Code Chat sidebar and ask `@tutor` for help.
3. The extension reads the task ID, fetches the corresponding solution notebook from your private GitHub repo, and extracts the `::: {.callout-tip title="Solution"}` block matching that task.
4. The reference solution is passed to the underlying language model as context — together with a system prompt that forbids reproducing it verbatim. The model returns a hint, question, or partial scaffold.

The tutor escalates over multiple turns: a guiding question first, then a stronger hint, then a small illustrative snippet — but never the complete working code.

---

## Prerequisites

- VS Code 1.108 or newer
- An active GitHub Copilot subscription (the tutor uses the VS Code Language Model API, which Copilot provides)
- A GitHub repository containing your reference solutions as Quarto notebooks (see *Solution file format* below)
- A GitHub Personal Access Token (PAT) with **Contents: Read** on that repository

---

## Installation

1. Download the latest `socratic-tutor-x.y.z.vsix` from the [Releases](https://github.com/benrosche/socratic-tutor-public/releases) page (or build it yourself with `vsce package`).
2. In VS Code, open the Extensions view (`Ctrl+Shift+X`), click the `...` menu → **Install from VSIX...**, and pick the file.
3. Reload the window.

---

## First-time setup

After installing, you need to tell the tutor (a) where your solutions live and (b) how to authenticate.

**Set the GitHub token (one-time, encrypted):**

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **Socratic Tutor: Set GitHub Token**.
3. Paste your PAT. It is stored in the operating system's keychain via VS Code's `SecretStorage` API — not in `settings.json`, not in any file you might accidentally commit.

To rotate or remove the token, run **Socratic Tutor: Clear GitHub Token** and set it again.

**Set the repository in Settings:**

Open Settings (`Ctrl+,`), search for **Socratic Tutor**, and fill in:

| Setting | Example | Notes |
|---|---|---|
| `Repo Owner` | `your-github-username` | The owner of the solutions repo |
| `Repo Name` | `course-solutions` | The repo containing solution notebooks |
| `Solutions Path` | `notebook-solutions` | Subfolder inside the repo; leave empty if solutions live at the root |
| `File Extension` | `qmd` | Without the dot. Defaults to `qmd` for Quarto. |

---

## Solution file format

The tutor expects solution notebooks to follow this convention:

- One file per "notebook" or "lesson", named after the prefix you use in task IDs. For task ID `lesson-1`, the file is `lesson.qmd`. For task ID `4_F_ERGM-1`, the file is `4_F_ERGM.qmd`. (Everything after the last `-` is treated as the task number within the notebook.)
- Inside each notebook, each task is a heading whose attributes contain the task ID in curly braces:

  ```markdown
  ## Task 1 {#sec-lesson-1 .task title="..." }
  ```

  Anywhere in that heading line, the bare `{lesson-1}` pattern must appear — the tutor matches on `\{taskId\}`.

- Below each heading, place a Quarto callout titled `"Solution"`:

  ```markdown
  ::: {.callout-tip title="Solution"}

  This is the reference solution the tutor will use as context.
  It is never shown verbatim to the student.

  ```r
  some_code_here()
  ```

  :::
  ```

The tutor extracts everything between the opening `:::` of that callout and its matching closing `:::`, respecting nested fenced divs.

---

## How students use it

Students don't need to know about GitHub tokens or settings — they just install the extension and chat with `@tutor`. To indicate which task they're on, they have three options:

1. A Quarto cell directive at the top of the file: `#| task: lesson-1`
2. Highlighting any line that contains that marker
3. Typing the slash command in the chat: `/task lesson-1`

Then in the chat sidebar:

> `@tutor I'm getting an error when I run my function.`

---

## Troubleshooting

- **"GitHub Token Not Set"** — run *Socratic Tutor: Set GitHub Token* from the Command Palette.
- **"Repository Not Configured"** — fill in `Repo Owner` and `Repo Name` in Settings.
- **"Notebook Not Found"** — the task ID prefix doesn't match any file in your solutions folder. Check spelling and the `solutionsPath` setting.
- **"Solution Not Found"** — the notebook exists, but no heading contains `{taskId}` or no `callout-* title="Solution"` block follows it.
- **No response from the tutor** — ensure GitHub Copilot is installed, enabled, and signed in.
- **Connection check** — ask `@tutor test connection` in chat to verify the extension can reach your repo.

---

## Customizing the tutor for your course

The tutoring style — escalation policy, scaffolding rules, output constraints — lives in a single string constant `TUTOR_SYSTEM_PROMPT` in [src/extension.ts](src/extension.ts). The wording is intentionally generic. To adapt it for your domain (e.g., specific language idioms, course-specific vocabulary), fork this repo, edit that constant, run `vsce package`, and distribute the new `.vsix` to your students.

---

## License

MIT. See [LICENSE.md](LICENSE.md).
