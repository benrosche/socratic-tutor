import * as vscode from 'vscode';

// --- CONFIGURATION ---
// All instructor-specific configuration lives in VS Code Settings or SecretStorage.
// Owner / repo / folder / file extension: Settings UI (search "Socratic Tutor").
// GitHub PAT: command palette → "Socratic Tutor: Set GitHub Token".
const SECRET_KEY_TOKEN = "socraticTutor.githubToken";

interface TutorConfig {
    owner: string;
    repo: string;
    solutionsPath: string;
    fileExtension: string;
}

function readConfig(): TutorConfig {
    const cfg = vscode.workspace.getConfiguration("socraticTutor");
    return {
        owner: (cfg.get<string>("repoOwner") ?? "").trim(),
        repo: (cfg.get<string>("repoName") ?? "").trim(),
        solutionsPath: (cfg.get<string>("solutionsPath") ?? "").trim(),
        fileExtension: (cfg.get<string>("fileExtension") ?? "qmd").trim().replace(/^\./, ""),
    };
}

function apiBase(cfg: TutorConfig): string {
    const base = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents`;
    return cfg.solutionsPath ? `${base}/${cfg.solutionsPath}` : base;
}

const NOTEBOOK_CACHE = new Map<string, string>();

// --- THE TUTOR'S BRAIN (System Instructions) ---
// Instructors are encouraged to fork the public repo and adapt the wording below
// to their language, framework, and pedagogical style. The escalation policy and
// scaffolding structure are intentionally subject-agnostic.
const TUTOR_SYSTEM_PROMPT = (fileName: string, taskId: string, solution: string) => `
You are a Socratic and scaffolded tutor for programming exercises.

Context:
- File: "${fileName}"
- Task: "## ${taskId}"
- Internal reference solution: ${solution}

Goal:
Help the student solve the task themselves without giving the full final answer.

Core behavior:
1. Do NOT provide the complete final solution for the task.
2. Prefer questions, hints, and partial scaffolds over direct answers.
3. Adapt to the student's current progress:
   - If they are stuck at the start, help them identify the next sub-step.
   - If they have partial code, critique it and suggest the smallest useful improvement.
   - If they are close, give a targeted hint instead of restating the whole approach.
4. Keep responses concise, actionable, and tied to the student's code.
5. Use the chat history to avoid repeating hints, track prior misconceptions, and gradually adjust support.

Instruction hierarchy:
1. First diagnose what the student is missing.
2. Then ask one focused guiding question when appropriate.
3. Then give one concise hint or micro-scaffold.
4. Only if needed, provide a partial code skeleton.

Scaffolding rules:
1. If the student has little or no meaningful code, break the task into 2-4 logical steps before suggesting syntax.
2. For syntax or function-usage issues, point them to their language's documentation or built-in help.
3. For complex logic, provide a code skeleton with placeholders like "..." or comments.
4. You may provide short local snippets (1-3 lines) to illustrate syntax or repair a small bug.
5. Never provide the complete working code for the whole task.
6. Prefer solving one subproblem at a time.

Feedback style:
1. Start by acknowledging what the student did correctly, if anything.
2. Point out one specific issue at a time.
3. Explain errors in plain language.
4. End with one concrete next step for the student.

When reviewing student code:
1. Identify whether the issue is conceptual, structural, or syntactic.
2. If conceptual, explain the missing idea briefly and ask a guiding question.
3. If structural, suggest how to reorganize the task into steps.
4. If syntactic, point to the likely function or line and optionally give a tiny example.

Socratic mode:
Prefer prompts like:
- "What inputs does this function need before it can run?"
- "What should this step return?"
- "How could you verify this intermediate result is shaped the way you expect?"
- "Which library or built-in function is most likely to help here?"

Escalation policy:
- First response on an issue: guiding question + small hint.
- Second response on the same issue: stronger hint + partial scaffold.
- Third response on the same issue: very small illustrative snippet, but still not the full solution.

Output constraints:
1. Never claim the student's code is correct unless it clearly is.
2. Never invent functions, libraries, or language behavior.
3. Never reveal the full working answer from the reference solution.
4. Never repeat the same hint if it has already been given.
5. Use the reference solution only to assess correctness and choose hints. Do not reproduce it verbatim.

Preferred response pattern:
- Brief diagnosis
- One guiding question
- One hint or scaffold
- One concrete next step
`;

export function activate(context: vscode.ExtensionContext) {
    let currentTaskId: string | undefined;

    context.subscriptions.push(
        vscode.commands.registerCommand("socraticTutor.setGithubToken", async () => {
            const value = await vscode.window.showInputBox({
                prompt: "Paste a GitHub Personal Access Token with read access to your solutions repo.",
                password: true,
                ignoreFocusOut: true,
                placeHolder: "github_pat_..."
            });
            if (value === undefined) return;
            if (!value.trim()) {
                vscode.window.showWarningMessage("Socratic Tutor: empty token, nothing stored.");
                return;
            }
            await context.secrets.store(SECRET_KEY_TOKEN, value.trim());
            vscode.window.showInformationMessage("Socratic Tutor: GitHub token saved to SecretStorage.");
        }),
        vscode.commands.registerCommand("socraticTutor.clearGithubToken", async () => {
            await context.secrets.delete(SECRET_KEY_TOKEN);
            vscode.window.showInformationMessage("Socratic Tutor: GitHub token cleared.");
        })
    );

    const handler: vscode.ChatRequestHandler = async (request, chatContext, response, token) => {
        const cfg = readConfig();
        const githubToken = await context.secrets.get(SECRET_KEY_TOKEN);

        if (!githubToken) {
            response.markdown(
                "### 🔑 GitHub Token Not Set\n" +
                "Run the command **Socratic Tutor: Set GitHub Token** from the Command Palette " +
                "(`Ctrl+Shift+P`) and paste a Personal Access Token with read access to your " +
                "solutions repository."
            );
            return;
        }

        if (!cfg.owner || !cfg.repo) {
            response.markdown(
                "### ⚙️ Repository Not Configured\n" +
                "Open VS Code Settings (`Ctrl+,`), search for **Socratic Tutor**, and set " +
                "`Repo Owner` and `Repo Name` to point at your solutions repository."
            );
            return;
        }

        const userPrompt = request.prompt.toLowerCase();

        if (userPrompt.includes("test connection") || userPrompt.includes("have access")) {
            response.progress("Checking GitHub access...");
            const status = await testConnection(githubToken, cfg);
            response.markdown(status);
            return;
        }

        const detectedId = getTaskId(request);
        if (detectedId) {
            currentTaskId = detectedId;
        }

        if (!currentTaskId) {
            response.markdown(
                "### 🔍 Task ID Missing\nI'm ready to help, but I don't know which task you're on!\n\n" +
                "Add a marker like `#| task: lesson-1` to your code chunk, or type `/task lesson-1`."
            );
            return;
        }

        const notebookName = currentTaskId.includes('-')
            ? currentTaskId.substring(0, currentTaskId.lastIndexOf('-'))
            : currentTaskId;
        const fileName = `${notebookName}.${cfg.fileExtension}`;

        response.progress(`Consulting solutions for ${currentTaskId}...`);

        const notebookContent = await fetchNotebook(fileName, githubToken, cfg);

        if (!notebookContent) {
            response.markdown(`### ⚠️ Notebook Not Found\nI'm looking for **${fileName}** in the repository to help with task **${currentTaskId}**, but it's missing. Check your Task ID!`);
            return;
        }

        const solution = extractTaskSolution(notebookContent, currentTaskId);

        if (!solution) {
            response.markdown(`### ⚠️ Solution Not Found\nI found **${fileName}**, but couldn't locate a solution block for task **${currentTaskId}**. Make sure the task ID matches a heading in the notebook.`);
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        const studentCode = activeEditor?.document.getText() || "No code visible.";
        const selection = activeEditor
            ? activeEditor.document.getText(activeEditor.selection)
            : "";

        const messages: vscode.LanguageModelChatMessage[] = [
            vscode.LanguageModelChatMessage.User(
                TUTOR_SYSTEM_PROMPT(fileName, currentTaskId, solution)
            )
        ];

        for (const turn of chatContext.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push(
                    vscode.LanguageModelChatMessage.User(turn.prompt)
                );
            } else if (turn instanceof vscode.ChatResponseTurn) {
                let fullMessage = "";

                for (const part of turn.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        fullMessage += part.value.value;
                    }
                }

                if (fullMessage.trim()) {
                    messages.push(
                        vscode.LanguageModelChatMessage.Assistant(fullMessage)
                    );
                }
            }
        }

        messages.push(
            vscode.LanguageModelChatMessage.User(
                `Tutor the student without giving the full solution.

STUDENT SELECTION:
${selection || "None"}

FULL STUDENT CODE:
${studentCode}

STUDENT QUESTION:
${request.prompt}`
            )
        );

        const chatResponse = await request.model.sendRequest(messages, {}, token);
        for await (const fragment of chatResponse.text) {
            response.markdown(fragment);
        }
    };

    const tutor = vscode.chat.createChatParticipant('socratic-tutor.tutor', handler);
    context.subscriptions.push(tutor);
}

// --- TASK ID DETECTION ---

function getTaskId(request: vscode.ChatRequest): string | undefined {
    if (request.command === 'task') return request.prompt.trim();

    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const taskRegex = /(?:#\||\|#|#)\s*task\s*:?\s*([\w-]+)/i;

    const selectionMatch = editor.document.getText(editor.selection).match(taskRegex);
    if (selectionMatch) return selectionMatch[1];

    const topOfFile = editor.document.getText(new vscode.Range(0, 0, 100, 0));
    const fileMatch = topOfFile.match(taskRegex);
    if (fileMatch) return fileMatch[1];

    return undefined;
}

// --- SOLUTION EXTRACTION ---

/**
 * Extracts the solution callout block for a specific task from a full Quarto notebook.
 *
 * Strategy:
 * 1. Find the heading (any level) whose text contains `{taskId}` (e.g., `{lesson-1}`).
 * 2. From that heading, scan forward for the next `::: {.callout-* ... title="Solution"}` block.
 * 3. Capture everything inside that block up to its closing `:::`.
 *
 * The closing `:::` is identified by tracking nesting depth of fenced divs.
 */
function extractTaskSolution(content: string, taskId: string): string | null {
    const lines = content.split('\n');

    const headingPattern = new RegExp(`\\{${escapeRegex(taskId)}\\}`);
    let headingIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i]) && headingPattern.test(lines[i])) {
            headingIndex = i;
            break;
        }
    }

    if (headingIndex === -1) return null;

    const solutionStartRegex = /^:::\s*\{\.callout-\w+[^}]*title\s*=\s*"Solution"/;
    let solutionStart = -1;

    for (let i = headingIndex + 1; i < lines.length; i++) {
        if (i > headingIndex + 1 && /^#{1,6}\s/.test(lines[i]) && /\{[\w-]+\}/.test(lines[i])) {
            break;
        }
        if (solutionStartRegex.test(lines[i])) {
            solutionStart = i;
            break;
        }
    }

    if (solutionStart === -1) return null;

    let depth = 1;
    let solutionEnd = -1;

    for (let i = solutionStart + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (/^:::+\s*\{/.test(trimmed) || /^:::+\s+\w/.test(trimmed)) {
            depth++;
        } else if (/^:::+\s*$/.test(trimmed)) {
            depth--;
            if (depth === 0) {
                solutionEnd = i;
                break;
            }
        }
    }

    if (solutionEnd === -1) return null;

    return lines.slice(solutionStart + 1, solutionEnd).join('\n').trim();
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- GITHUB FETCHING ---

async function testConnection(token: string, cfg: TutorConfig): Promise<string> {
    try {
        const res = await fetch(apiBase(cfg), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VS-Code-Socratic-Tutor'
            }
        });

        if (res.status === 200) {
            const files: any = await res.json();
            const ext = `.${cfg.fileExtension}`;
            const matching = files
                .filter((f: any) => typeof f.name === "string" && f.name.endsWith(ext))
                .map((f: any) => f.name);

            return `✅ **Connection Successful!**\n\nI can see \`${cfg.owner}/${cfg.repo}${cfg.solutionsPath ? "/" + cfg.solutionsPath : ""}\`. Found **${matching.length}** solution notebooks (\`${ext}\`).`;
        }

        return `❌ **GitHub Error ${res.status}**: Check that the token has read access to \`${cfg.owner}/${cfg.repo}\` and that the path \`${cfg.solutionsPath}\` exists.`;
    } catch (err) {
        return `❌ **Network Error**: ${err}`;
    }
}

async function fetchNotebook(fileName: string, token: string, cfg: TutorConfig): Promise<string | null> {
    const cacheKey = `${cfg.owner}/${cfg.repo}/${cfg.solutionsPath}/${fileName}`;
    if (NOTEBOOK_CACHE.has(cacheKey)) return NOTEBOOK_CACHE.get(cacheKey)!;

    const url = `${apiBase(cfg)}/${fileName}`;

    try {
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3.raw',
                'User-Agent': 'VS-Code-Socratic-Tutor'
            }
        });

        if (!res.ok) return null;

        const text = await res.text();
        NOTEBOOK_CACHE.set(cacheKey, text);
        return text;
    } catch {
        return null;
    }
}

export function deactivate() {}
