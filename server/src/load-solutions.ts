/**
 * Loads reference solutions from a local clone of the private solutions repo
 * into Postgres.
 *
 *   npm run load -- ../../socratic-tutor-solutions/notebook-solutions
 *   npm run load -- ../templates --dry-run
 *
 * Run this from your own machine against the Railway public connection string.
 * Content updates need no redeploy, and the public repo never contains course
 * content.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { allTaskIds, closePool, deleteTasks, upsertTask } from './db.js';
import { listTasks, notebookOf } from './solutions.js';

interface Args {
    dir: string;
    dryRun: boolean;
    prune: boolean;
    ext: string;
}

function parseArgs(argv: string[]): Args {
    const positional = argv.filter((a) => !a.startsWith('--'));
    const flags = new Set(argv.filter((a) => a.startsWith('--')));

    if (positional.length === 0) {
        console.error('Usage: npm run load -- <solutions-dir> [--dry-run] [--prune] [--ext=qmd]');
        process.exit(2);
    }

    const extFlag = argv.find((a) => a.startsWith('--ext='));

    return {
        dir: path.resolve(positional[0]),
        dryRun: flags.has('--dry-run'),
        prune: flags.has('--prune'),
        ext: (extFlag ? extFlag.split('=')[1] : 'qmd').replace(/^\./, ''),
    };
}

async function findNotebooks(dir: string, ext: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
    return entries
        .filter((e) => e.isFile() && e.name.endsWith(`.${ext}`))
        .map((e) => path.join(e.parentPath ?? dir, e.name))
        .sort();
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    let files: string[];
    try {
        files = await findNotebooks(args.dir, args.ext);
    } catch {
        console.error(`Cannot read ${args.dir}. Point this at the folder holding your .${args.ext} solution notebooks.`);
        process.exit(2);
    }

    if (files.length === 0) {
        console.error(`No .${args.ext} files under ${args.dir}.`);
        process.exit(2);
    }

    const loaded: string[] = [];
    const emptyFiles: string[] = [];

    for (const file of files) {
        const content = await fs.readFile(file, 'utf8');
        const tasks = listTasks(content);

        if (tasks.length === 0) {
            emptyFiles.push(path.relative(args.dir, file));
            continue;
        }

        for (const task of tasks) {
            if (!args.dryRun) {
                await upsertTask({
                    taskId: task.taskId,
                    notebook: notebookOf(task.taskId),
                    title: task.title,
                    solution: task.solution,
                });
            }
            loaded.push(task.taskId);
            console.log(`  ${task.taskId.padEnd(24)} ${task.solution.length.toString().padStart(6)} chars  ${task.title}`);
        }
    }

    const notebooks = new Set(loaded.map(notebookOf));
    console.log(
        `\n${args.dryRun ? '[dry run] would load' : 'Loaded'} ${loaded.length} task(s) across ${notebooks.size} notebook(s).`
    );

    // A file with no extractable task is nearly always a malformed heading or a
    // Solution callout missing its title — worth surfacing now rather than in a lab.
    if (emptyFiles.length > 0) {
        console.warn(
            `\nNo tasks found in ${emptyFiles.length} file(s): ${emptyFiles.join(', ')}\n` +
            '  Check that each task heading contains its ID in braces, e.g. `{r-lab-1}`,\n' +
            '  and that a `::: {.callout-tip title="Solution"}` block follows it.'
        );
    }

    if (args.prune) {
        const stale = (await allTaskIds()).filter((id) => !loaded.includes(id));
        if (stale.length > 0) {
            if (!args.dryRun) await deleteTasks(stale);
            console.log(`\n${args.dryRun ? '[dry run] would remove' : 'Removed'} ${stale.length} stale task(s): ${stale.join(', ')}`);
        }
    }

    await closePool();
}

main().catch(async (err) => {
    console.error(err);
    await closePool().catch(() => {});
    process.exit(1);
});
