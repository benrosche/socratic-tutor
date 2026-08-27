/**
 * Parser tests. No database needed — `npm test` runs these alongside the
 * integration suite, but they also pass standalone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractTaskSolution, listTasks, notebookOf } from '../solutions.js';

function notebook(...headings: string[]): string {
    return headings
        .map(
            (h) =>
                `${h}\n\n::: {.callout-tip title="Solution"}\n\ncode for ${h}\n\n:::\n`
        )
        .join('\n');
}

describe('listTasks', () => {
    it('reads a bare-brace task id from a heading', () => {
        const tasks = listTasks(notebook('# Sum the evens `{r-lab-1}`'));
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].taskId, 'r-lab-1');
        assert.equal(tasks[0].title, 'Sum the evens');
    });

    // Regression: `$\mathbf{W}$` in a heading previously matched as a task
    // named "W", shadowing the real id later on the line.
    it('ignores braces inside inline LaTeX', () => {
        const tasks = listTasks(
            notebook('## Build the weight matrix $\\mathbf{W}$ `{influence-2}`')
        );
        assert.deepEqual(tasks.map((t) => t.taskId), ['influence-2']);
    });

    it('takes the last candidate when a heading has several', () => {
        const tasks = listTasks(notebook('## Compare {alpha} and {beta} `{lab-3}`'));
        assert.deepEqual(tasks.map((t) => t.taskId), ['lab-3']);
    });

    it('ignores Quarto attribute blocks, which are not task ids', () => {
        // Documented in v0.1 as working; it never did, and still does not.
        assert.deepEqual(listTasks(notebook('## Task 1 {#sec-lab-1 .task}')), []);
    });

    it('skips a heading whose solution callout is missing', () => {
        assert.deepEqual(listTasks('# Orphan `{lab-9}`\n\nno callout here\n'), []);
    });

    it('does not treat a task marker in a code chunk as a heading', () => {
        const content = '```{r}\n#| task: r-lab-1\n```\n' + notebook('# Real `{r-lab-2}`');
        assert.deepEqual(listTasks(content).map((t) => t.taskId), ['r-lab-2']);
    });

    it('deduplicates repeated ids', () => {
        const content = notebook('# One `{lab-1}`') + notebook('# One again `{lab-1}`');
        assert.equal(listTasks(content).length, 1);
    });

    it('strips backticks from the recovered title', () => {
        const [task] = listTasks(notebook('# Use `sum()` on a vector `{lab-1}`'));
        assert.equal(task.title, 'Use sum() on a vector');
    });
});

describe('extractTaskSolution', () => {
    it('captures the callout body', () => {
        const solution = extractTaskSolution(notebook('# T `{lab-1}`'), 'lab-1');
        assert.equal(solution, 'code for # T `{lab-1}`');
    });

    it('respects nested fenced divs', () => {
        const content =
            '# T `{lab-1}`\n\n::: {.callout-tip title="Solution"}\n\n' +
            '::: {.panel-tabset}\ninner\n:::\n\nouter\n\n:::\n';
        const solution = extractTaskSolution(content, 'lab-1');
        assert.match(solution!, /inner/);
        assert.match(solution!, /outer/);
    });

    it('does not run past the next task heading', () => {
        const content = '# A `{lab-1}`\n\nno solution\n\n' + notebook('# B `{lab-2}`');
        assert.equal(extractTaskSolution(content, 'lab-1'), null);
    });

    it('returns null for an unknown id', () => {
        assert.equal(extractTaskSolution(notebook('# T `{lab-1}`'), 'lab-2'), null);
    });
});

describe('notebookOf', () => {
    it('drops the trailing task number', () => {
        assert.equal(notebookOf('09_ergms-12'), '09_ergms');
        assert.equal(notebookOf('r-lab-1'), 'r-lab');
    });

    it('returns the id unchanged when there is no hyphen', () => {
        assert.equal(notebookOf('lab'), 'lab');
    });
});
