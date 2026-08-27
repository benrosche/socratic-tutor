# Socratic Tutor v0.1 — VS Code extension (archived)

This is the original Socratic Tutor: a **VS Code chat participant** invoked as
`@tutor`. It is kept here because it still works, but it is **no longer
maintained**. New work happens in the v0.2 architecture at the root of this repo.

## Where it works

| Editor | Status |
|---|---|
| Stock VS Code + GitHub Copilot | Works |
| Positron ≤ 2026.06 (Positron Assistant) | Worked |
| **Positron ≥ 2026.07 (Posit Assistant)** | **Does not work** |
| Cursor | Does not work — no Chat Participant API |
| Claude Code | Not applicable — no chat participant concept |

## Why it stopped working in Positron

Positron replaced Positron Assistant with Posit Assistant in 2026.07. Posit
Assistant does not consume the `vscode.chat` API, and the extension depends on it
twice over:

- `vscode.chat.createChatParticipant` (`src/extension.ts`) is how `@tutor` appears
  in the chat pane at all.
- `request.model.sendRequest` (`src/extension.ts`) is the model call. The extension
  has no model of its own — it borrows the one attached to the incoming
  `ChatRequest`. No participant invocation means no request, means nothing to send
  the prompt to.

Renaming the participant does not help; both halves of the mechanism are gone. See
the root `TUTORIAL.md` for the migration.

## Known issue

The v0.1 README and tutorial claim a task heading may carry its ID inside a Quarto
anchor, e.g. `## Task 1 {#sec-lesson-1 .task}`. **That never worked.** The parser
matches the literal `{lesson-1}` including braces, which `{#sec-lesson-1 .task}`
does not contain. Only the bare-brace form parses:

```markdown
# Sum the even numbers in a vector `{r-lab-1}`
```

The shipped `templates/solution-template.qmd` always used the correct form, so
notebooks written from the template are unaffected. v0.2 documents this correctly
and its parser behaves the same way.

## Building it

```bash
npm install
npx vsce package
```

Then install the resulting `.vsix` via the Extensions panel → `...` →
**Install from VSIX...**. Configuration (GitHub PAT, repo owner/name) is described
in the git history of the root `README.md` at tag `v0.1.0`.
