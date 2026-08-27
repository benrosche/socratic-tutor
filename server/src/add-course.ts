/**
 * Creates a course and issues its class token, or rotates the token of one that
 * already exists.
 *
 *   npm run add-course -- sna-2026-fall
 *   npm run add-course -- sna-2026-fall --token <your-own-token>
 *   npm run add-course -- --list
 *
 * The token is what identifies the course to the server, so each class gets its
 * own and one class's token cannot reach another's solutions. Only the hash is
 * stored, so this is the one and only time the token is printed — put it in that
 * course's lab repo, or hand it to students, before closing the terminal.
 */
import crypto from 'node:crypto';
import { closePool, listCourses, upsertCourse } from './db.js';

function generateToken(course: string): string {
    // Prefixed so an instructor running several classes can tell tokens apart at
    // a glance, with enough randomness that it is not guessable against a known URL.
    const slug = course.replace(/[^a-z\d]+/gi, '').slice(0, 12).toLowerCase();
    return `${slug}-${crypto.randomBytes(6).toString('hex')}`;
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);

    if (argv.includes('--list')) {
        const courses = await listCourses();
        if (courses.length === 0) {
            console.log('No courses yet. Create one with:  npm run add-course -- <course>');
        } else {
            for (const c of courses) {
                console.log(`  ${c.course.padEnd(24)} ${String(c.tasks).padStart(4)} tasks  ${c.active ? '' : '(inactive)'}`);
            }
        }
        await closePool();
        return;
    }

    const course = argv.find((a) => !a.startsWith('--'));
    if (!course) {
        console.error('Usage: npm run add-course -- <course> [--token <token>]');
        console.error('       npm run add-course -- --list');
        process.exit(2);
    }

    const tokenIdx = argv.indexOf('--token');
    const token = tokenIdx >= 0 ? argv[tokenIdx + 1] : generateToken(course);

    if (!token || token.length < 8) {
        console.error('A token must be at least 8 characters. Omit --token to have one generated.');
        process.exit(2);
    }

    await upsertCourse(course, token);

    console.log(`\nCourse "${course}" is ready.\n`);
    console.log(`  Class token:  ${token}\n`);
    console.log('Only the hash is stored, so this will not be shown again. Put it in that');
    console.log("course's lab repo settings.json as the Authorization bearer value:\n");
    console.log(`      "Authorization": "Bearer ${token}"\n`);
    console.log(`Then load the solutions:\n`);
    console.log(`      npm run load -- <solutions-dir> --course ${course}\n`);

    await closePool();
}

main().catch(async (err) => {
    console.error(err);
    await closePool().catch(() => {});
    process.exit(1);
});
