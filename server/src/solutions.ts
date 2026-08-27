/**
 * Quarto solution-notebook parsing.
 *
 * `extractTaskSolution` is moved verbatim from the v0.1 VS Code extension
 * (legacy/vscode-extension/src/extension.ts). It never depended on the `vscode`
 * module — it is pure string handling — so the notebook format instructors have
 * already authored against is unchanged in v0.2.
 */

export interface ParsedTask {
    taskId: string;
    title: string;
    solution: string;
}

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
export function extractTaskSolution(content: string, taskId: string): string | null {
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

/**
 * Enumerates every task in a notebook: the inverse of `extractTaskSolution`,
 * needed by the loader, which walks files rather than looking up a known ID.
 *
 * A task heading carries its ID as a bare `{token}` somewhere on the line, e.g.
 *
 *     # Sum the even numbers in a vector `{r-lab-1}`
 *
 * The `[\w-]` character class deliberately excludes Quarto's own brace
 * attributes — `{.task}` has a dot and `{#sec-foo .task}` has a hash and
 * spaces, so neither is mistaken for a task ID.
 *
 * Two headings in the wild break a naive first-match rule, so both are handled:
 * inline LaTeX contributes braces of its own (`$\mathbf{W}$` looks exactly like
 * a task ID named `W`), and it always precedes the real ID. Math spans are
 * therefore stripped first, and the *last* remaining match wins, since the
 * convention puts the ID at the end of the heading.
 */
export function listTasks(content: string): ParsedTask[] {
    const lines = content.split('\n');
    const tasks: ParsedTask[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
        if (!/^#{1,6}\s/.test(line)) continue;

        const searchable = line.replace(/\$[^$\n]*\$/g, '');
        const matches = [...searchable.matchAll(/\{([\w-]+)\}/g)];
        if (matches.length === 0) continue;

        const match = matches[matches.length - 1];
        const taskId = match[1];
        if (seen.has(taskId)) continue;
        seen.add(taskId);

        const solution = extractTaskSolution(content, taskId);
        if (solution === null) continue;

        tasks.push({ taskId, title: headingTitle(line, match[0]), solution });
    }

    return tasks;
}

/** The notebook a task belongs to: everything before the last '-'. */
export function notebookOf(taskId: string): string {
    return taskId.includes('-') ? taskId.substring(0, taskId.lastIndexOf('-')) : taskId;
}

/** Heading text with the leading hashes, the ID token, and stray backticks removed. */
function headingTitle(line: string, idToken: string): string {
    return line
        .replace(/^#{1,6}\s+/, '')
        .replace(idToken, '')
        .replace(/`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
