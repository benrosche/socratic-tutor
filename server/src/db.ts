import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | undefined;

/**
 * Created on first use rather than at import, so `npm run load -- --dry-run` and
 * `--help`-style paths work before a database exists.
 *
 * Railway's private network speaks plain TCP, while its public proxy (used by the
 * loader and the dashboard from your laptop) requires TLS with a certificate that
 * is not in Node's trust store — hence the relaxed verification there. The
 * connection is still encrypted.
 */
export function getPool(): pg.Pool {
    if (_pool) return _pool;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set. On Railway this is injected by the Postgres add-on; locally, copy the public connection string from the Railway dashboard.');
    }

    // An explicit sslmode in the URL always wins, so a self-hosted or containerized
    // Postgres without TLS can be addressed by any hostname.
    const sslDisabled = /[?&]sslmode=disable\b/.test(connectionString);
    const isInternal = /\.railway\.internal|localhost|127\.0\.0\.1|host\.docker\.internal/.test(connectionString);

    _pool = new Pool({
        connectionString,
        ssl: sslDisabled || isInternal ? false : { rejectUnauthorized: false },
        max: 5,
        // pg defaults to waiting forever. Without this a bad or not-yet-reachable
        // host makes /healthz hang rather than answer, which a platform health
        // check reports as "service unavailable" with nothing to diagnose.
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30_000,
    });
    _pool.on('error', (err) => console.error('[db] idle client error', err.message));
    return _pool;
}

/** Safe to call even if no connection was ever opened. */
export async function closePool(): Promise<void> {
    if (!_pool) return;
    const p = _pool;
    _pool = undefined;
    await p.end();
}

// --- COURSES -------------------------------------------------------------

/** Tokens are stored hashed, so the database never holds a usable class token. */
export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Resolves a bearer token to a course. This is the whole multi-course access
 * model: the token decides which course's content the request can reach.
 */
export async function courseForToken(token: string): Promise<string | null> {
    const { rows } = await getPool().query<{ course: string }>(
        'select course from courses where token_hash = $1 and active',
        [hashToken(token)]
    );
    return rows[0]?.course ?? null;
}

export async function upsertCourse(course: string, token: string): Promise<void> {
    await getPool().query(
        `insert into courses (course, token_hash) values ($1, $2)
         on conflict (course) do update set token_hash = excluded.token_hash, active = true`,
        [course, hashToken(token)]
    );
}

export async function listCourses(): Promise<{ course: string; active: boolean; tasks: number }[]> {
    const { rows } = await getPool().query<{ course: string; active: boolean; tasks: string }>(
        `select c.course, c.active, count(t.task_id) as tasks
         from courses c left join tasks t using (course)
         group by c.course, c.active order by c.course`
    );
    return rows.map((r) => ({ course: r.course, active: r.active, tasks: Number(r.tasks) }));
}

// --- TASKS ---------------------------------------------------------------

export interface TaskRow {
    task_id: string;
    notebook: string;
    title: string | null;
    solution: string;
}

export async function getTask(course: string, taskId: string): Promise<TaskRow | null> {
    const { rows } = await getPool().query<TaskRow>(
        'select task_id, notebook, title, solution from tasks where course = $1 and task_id = $2',
        [course, taskId]
    );
    return rows[0] ?? null;
}

/** Task IDs that look close to what was asked for, to help a student who typo'd. */
export async function suggestTasks(course: string, taskId: string, limit = 5): Promise<string[]> {
    const notebook = taskId.includes('-') ? taskId.substring(0, taskId.lastIndexOf('-')) : taskId;
    const { rows } = await getPool().query<{ task_id: string }>(
        'select task_id from tasks where course = $1 and notebook = $2 order by task_id limit $3',
        [course, notebook, limit]
    );
    return rows.map((r) => r.task_id);
}

export async function upsertTask(t: {
    course: string;
    taskId: string;
    notebook: string;
    title: string;
    solution: string;
}): Promise<void> {
    await getPool().query(
        `insert into tasks (course, task_id, notebook, title, solution, updated_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (course, task_id) do update
           set notebook = excluded.notebook,
               title = excluded.title,
               solution = excluded.solution,
               updated_at = now()`,
        [t.course, t.taskId, t.notebook, t.title, t.solution]
    );
}

/** Task IDs currently loaded for a course, so the loader can report removals. */
export async function allTaskIds(course: string): Promise<string[]> {
    const { rows } = await getPool().query<{ task_id: string }>(
        'select task_id from tasks where course = $1 order by task_id',
        [course]
    );
    return rows.map((r) => r.task_id);
}

export async function deleteTasks(course: string, taskIds: string[]): Promise<void> {
    if (taskIds.length === 0) return;
    await getPool().query('delete from tasks where course = $1 and task_id = any($2)', [course, taskIds]);
}

/** Summary of loaded content for one course, for the connection diagnostic. */
export async function taskStats(course: string): Promise<{ count: number; notebooks: string[]; updatedAt: string | null }> {
    const { rows } = await getPool().query<{ n: string; notebooks: string[]; updated: Date | null }>(
        `select count(*) as n,
                coalesce(array_agg(distinct notebook) filter (where notebook is not null), '{}') as notebooks,
                max(updated_at) as updated
         from tasks where course = $1`,
        [course]
    );
    return {
        count: Number(rows[0].n),
        notebooks: rows[0].notebooks ?? [],
        updatedAt: rows[0].updated ? rows[0].updated.toISOString() : null,
    };
}

// --- EVENTS --------------------------------------------------------------

/**
 * How many times this student has already asked about this task, within this
 * course. The escalation level is this + 1. Persisting it server-side is the
 * whole point of the server: opening a fresh chat window does not reset it.
 */
export async function countPriorAsks(course: string, student: string, taskId: string): Promise<number> {
    const { rows } = await getPool().query<{ n: string }>(
        'select count(*) as n from events where course = $1 and student = $2 and task_id = $3 and found',
        [course, student, taskId]
    );
    return Number(rows[0].n);
}

/** Requests by this student in the last `minutes`, for rate limiting. */
export async function countRecentRequests(course: string, student: string, minutes: number): Promise<number> {
    const { rows } = await getPool().query<{ n: string }>(
        `select count(*) as n from events
         where course = $1 and student = $2 and ts > now() - ($3 || ' minutes')::interval`,
        [course, student, String(minutes)]
    );
    return Number(rows[0].n);
}

export async function logEvent(e: {
    course: string;
    student: string;
    taskId: string;
    level: number;
    question: string | null;
    found: boolean;
}): Promise<void> {
    await getPool().query(
        'insert into events (course, student, task_id, level, question, found) values ($1, $2, $3, $4, $5, $6)',
        [e.course, e.student, e.taskId, e.level, e.question, e.found]
    );
}
