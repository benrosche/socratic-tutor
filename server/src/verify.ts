/**
 * Checks that every exercise a student can ask about has a solution the tutor can
 * actually serve.
 *
 *   npm run verify -- <lab-dir> --course sna-2026-fall
 *   npm run verify -- <lab-dir> --course sna-2026-fall --pattern '*.qmd'
 *
 * It compares the two ends of the pipeline:
 *
 *   the `#| task:` markers in the students' lab notebooks
 *   the `tasks` rows `npm run load` put in the course database
 *
 * A marker with no row is what shows a student "solution not found" mid-lab. A row
 * with no marker is a solution nobody can reach.
 *
 * This deliberately does not parse Solution callouts — `npm run load` already
 * reports notebooks it could not parse, and `solutions.ts` is the one parser.
 * The question only this can answer is whether what got loaded matches what the
 * labs ask for, which is the failure that survives a clean load.
 *
 * Exits 1 when a marker has no solution, so it can gate a publish.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { allTaskIds, closePool, listCourses } from './db.js';

interface Args {
    dir: string;
    course: string;
    pattern: string;
}

function parseArgs(argv: string[]): Args {
    const positional = argv.filter((a) => !a.startsWith('--'));

    const courseFlag = argv.find((a) => a.startsWith('--course='));
    const courseIdx = argv.indexOf('--course');
    const course = courseFlag
        ? courseFlag.split('=')[1]
        : courseIdx >= 0
          ? argv[courseIdx + 1]
          : undefined;

    if (positional.length === 0 || !course) {
        console.error('Usage: npm run verify -- <lab-dir> --course <course> [--pattern <glob>]');
        console.error('\n  <lab-dir>  the folder of notebooks students actually open,');
        console.error('             e.g. ../../sna-2026-fall-student/r-labs');
        process.exit(2);
    }

    const patternFlag = argv.find((a) => a.startsWith('--pattern='));
    const patternIdx = argv.indexOf('--pattern');
    const pattern = patternFlag
        ? patternFlag.split('=')[1]
        : patternIdx >= 0
          ? argv[patternIdx + 1]
          : '*-student.qmd';

    return {
        dir: path.resolve(positional[0] === course ? positional[1] : positional[0]),
        course,
        pattern,
    };
}

/** Only `*` is supported — enough for `*-student.qmd` without a glob dependency. */
function globToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

/**
 * Every `#| task: <id>` marker in a notebook, in order of appearance.
 *
 * Matched loosely on leading whitespace because the marker is often indented
 * inside a chunk, but anchored at the end so a mention in prose ("use `#| task:
 * 01-1`, which is how the tutor knows…") is not mistaken for a real marker.
 */
const MARKER = /^\s*#\|\s*task:\s*([A-Za-z0-9_]+-\d+)\s*$/;

function markersIn(content: string): string[] {
    const ids: string[] = [];
    for (const line of content.split('\n')) {
        const m = MARKER.exec(line);
        if (m && !ids.includes(m[1])) ids.push(m[1]);
    }
    return ids;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const known = (await listCourses()).map((c) => c.course);
    if (!known.includes(args.course)) {
        console.error(`Unknown course "${args.course}". Known: ${known.join(', ') || '(none)'}`);
        await closePool();
        process.exit(2);
    }

    const match = globToRegExp(args.pattern);
    let files: string[];
    try {
        const entries = await fs.readdir(args.dir, { withFileTypes: true, recursive: true });
        files = entries
            .filter((e) => e.isFile() && match.test(e.name))
            .map((e) => path.join(e.parentPath ?? args.dir, e.name))
            .sort();
    } catch {
        console.error(`Cannot read ${args.dir}. Point this at the folder of notebooks students open.`);
        await closePool();
        process.exit(2);
    }

    if (files.length === 0) {
        console.error(`No files matching "${args.pattern}" under ${args.dir}.`);
        await closePool();
        process.exit(2);
    }

    const loaded = await allTaskIds(args.course);
    if (loaded.length === 0) {
        console.error(`No tasks loaded for course "${args.course}". Run \`npm run load\` first.`);
        await closePool();
        process.exit(2);
    }

    const seen = new Set<string>();
    for (const file of files) {
        const ids = markersIn(await fs.readFile(file, 'utf8'));
        ids.forEach((id) => seen.add(id));
        const ok = ids.filter((id) => loaded.includes(id)).length;
        const name = path.relative(args.dir, file);
        console.log(`  ${name.padEnd(52)} ${String(ok).padStart(3)}/${String(ids.length).padEnd(3)} markers resolve`);
    }

    const markers = [...seen].sort();
    const missing = markers.filter((id) => !loaded.includes(id));
    const orphan = loaded.filter((id) => !seen.has(id)).sort();

    console.log(
        `\n${markers.length} marker(s) across ${files.length} notebook(s); ` +
        `${loaded.length} solution(s) loaded for "${args.course}".`
    );

    // Not a failure: a solution can legitimately be loaded before the lab that uses
    // it is published. Still worth naming, since the usual cause is a renamed task.
    if (orphan.length > 0) {
        console.warn(`\n${orphan.length} loaded solution(s) no notebook refers to:`);
        console.warn(orphan.map((id) => `  ${id}`).join('\n'));
    }

    if (missing.length > 0) {
        console.error(`\nNO SOLUTION LOADED for ${missing.length} marker(s) — these show "not found":`);
        console.error(missing.map((id) => `  ${id}`).join('\n'));
        console.error(
            '\nAnnotate the solution notebook — a heading carrying `{task-id}` followed by a\n' +
            '`::: {.callout-tip title="Solution"}` block — then re-run:\n' +
            `      npm run load -- <solutions-dir> --course ${args.course}\n` +
            '\nRemember task IDs come from the solution notebook\'s filename, so the notebook\n' +
            'must be named to produce them.'
        );
        console.error(`\nFAIL: ${markers.length - missing.length} resolve, ${missing.length} do not`);
        await closePool();
        process.exit(1);
    }

    console.log(`\nOK: all ${markers.length} markers resolve.`);
    await closePool();
}

main().catch(async (err) => {
    console.error(err);
    await closePool().catch(() => {});
    process.exit(1);
});
