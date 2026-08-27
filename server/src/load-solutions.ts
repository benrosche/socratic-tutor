/**
 * Loads reference solutions from a local clone of the private solutions repo
 * into Postgres.
 *
 *   npm run load -- <dir> --course sna-2026-fall
 *   npm run load -- <dir> --course sna-2026-fall --dry-run --prune
 *
 * Run this from your own machine against the Railway public connection string.
 * Content updates need no redeploy, and the public repo never contains course
 * content.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { allTaskIds, closePool, deleteTasks, listCourses, upsertTask } from './db.js';
import { listTasks, notebookOf } from './solutions.js';

interface Args {
    dir: string;
    course: string;
    dryRun: boolean;
    prune: boolean;
    ext: string;
}

function parseArgs(argv: string[]): Args {
    const positional = argv.filter((a) => !a.startsWith('--'));
    const flags = new Set(argv.filter((a) => a.startsWith('--')));

    const courseFlag = argv.find((a) => a.startsWith('--course='));
    // Also accept `--course <name>`, which is how people type it.
    const courseIdx = argv.indexOf('--course');
    const course = courseFlag
        ? courseFlag.split('=')[1]
        : courseIdx >= 0
          ? argv[courseIdx + 1]
          : undefined;

    if (positional.length === 0 || !course) {
        console.error('Usage: npm run load -- <solutions-dir> --course <course> [--dry-run] [--prune] [--ext=qmd]');
        console.error('\nThe course must already exist. Create one with:  npm run add-course -- <course>');
        process.exit(2);
    }

    const extFlag = argv.find((a) => a.startsWith('--ext='));

    return {
        dir: path.resolve(positional[0] === course ? positional[1] : positional[0]),
        course,
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

    if (!args.dryRun) {
        const known = (await listCourses()).map((c) => c.course);
        if (!known.includes(args.course)) {
            console.error(`Unknown course "${args.course}". Known: ${known.join(', ') || '(none)'}`);
            console.error(`Create it with:  npm run add-course -- ${args.course}`);
            await closePool();
            process.exit(2);
        }
    }

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
                    course: args.course,
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
        `\n${args.dryRun ? '[dry run] would load' : 'Loaded'} ${loaded.length} task(s) across ${notebooks.size} notebook(s) into course "${args.course}".`
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
        const stale = (await allTaskIds(args.course)).filter((id) => !loaded.includes(id));
        if (stale.length > 0) {
            if (!args.dryRun) await deleteTasks(args.course, stale);
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
