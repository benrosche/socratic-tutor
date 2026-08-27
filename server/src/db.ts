import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | undefined;

/**
 * Created on first use rather than at import, so `npm run load -- --dry-run` and
 * `--help`-style paths work before a database exists.
 *
 * Railway's internal hostname speaks plain TCP inside the private network, while
 * the public proxy (used by the loader and the dashboard from your laptop)
 * requires TLS. Its certificate is not in Node's trust store, hence the relaxed
 * verification — the connection is still encrypted.
 */
export function getPool(): pg.Pool {
    if (_pool) return _pool;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set. On Railway this is injected by the Postgres add-on; locally, copy the public connection string from the Railway dashboard.');
    }

    const isInternal = /\.railway\.internal|localhost|127\.0\.0\.1/.test(connectionString);

    _pool = new Pool({
        connectionString,
        ssl: isInternal ? false : { rejectUnauthorized: false },
        max: 5,
    });
    return _pool;
}

/** Safe to call even if no connection was ever opened. */
export async function closePool(): Promise<void> {
    if (!_pool) return;
    const p = _pool;
    _pool = undefined;
    await p.end();
}

export interface TaskRow {
    task_id: string;
    notebook: string;
    title: string | null;
    solution: string;
}

export async function getTask(taskId: string): Promise<TaskRow | null> {
    const { rows } = await getPool().query<TaskRow>(
        'select task_id, notebook, title, solution from tasks where task_id = $1',
        [taskId]
    );
    return rows[0] ?? null;
}

/** Task IDs that look close to what was asked for, to help a student who typo'd. */
export async function suggestTasks(taskId: string, limit = 5): Promise<string[]> {
    const notebook = taskId.includes('-') ? taskId.substring(0, taskId.lastIndexOf('-')) : taskId;
    const { rows } = await getPool().query<{ task_id: string }>(
        'select task_id from tasks where notebook = $1 order by task_id limit $2',
        [notebook, limit]
    );
    return rows.map((r) => r.task_id);
}

/**
 * How many times this student has already asked about this task. The escalation
 * level is this + 1. Persisting it server-side is the whole point of the server:
 * opening a fresh chat window does not reset it.
 */
export async function countPriorAsks(student: string, taskId: string): Promise<number> {
    const { rows } = await getPool().query<{ n: string }>(
        'select count(*) as n from events where student = $1 and task_id = $2 and found',
        [student, taskId]
    );
    return Number(rows[0].n);
}

/** Requests by this student in the last `minutes`, for rate limiting. */
export async function countRecentRequests(student: string, minutes: number): Promise<number> {
    const { rows } = await getPool().query<{ n: string }>(
        `select count(*) as n from events
         where student = $1 and ts > now() - ($2 || ' minutes')::interval`,
        [student, String(minutes)]
    );
    return Number(rows[0].n);
}

export async function logEvent(e: {
    student: string;
    taskId: string;
    level: number;
    question: string | null;
    found: boolean;
}): Promise<void> {
    await getPool().query(
        'insert into events (student, task_id, level, question, found) values ($1, $2, $3, $4, $5)',
        [e.student, e.taskId, e.level, e.question, e.found]
    );
}

export async function upsertTask(t: {
    taskId: string;
    notebook: string;
    title: string;
    solution: string;
}): Promise<void> {
    await getPool().query(
        `insert into tasks (task_id, notebook, title, solution, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (task_id) do update
           set notebook = excluded.notebook,
               title = excluded.title,
               solution = excluded.solution,
               updated_at = now()`,
        [t.taskId, t.notebook, t.title, t.solution]
    );
}

/** Summary of loaded content, for the connection diagnostic. */
export async function taskStats(): Promise<{ count: number; notebooks: string[]; updatedAt: string | null }> {
    const { rows } = await getPool().query<{ n: string; notebooks: string[]; updated: Date | null }>(
        `select count(*) as n,
                coalesce(array_agg(distinct notebook) filter (where notebook is not null), '{}') as notebooks,
                max(updated_at) as updated
         from tasks`
    );
    return {
        count: Number(rows[0].n),
        notebooks: rows[0].notebooks ?? [],
        updatedAt: rows[0].updated ? rows[0].updated.toISOString() : null,
    };
}

/** Task IDs currently in the database, so the loader can report removals. */
export async function allTaskIds(): Promise<string[]> {
    const { rows } = await getPool().query<{ task_id: string }>('select task_id from tasks order by task_id');
    return rows.map((r) => r.task_id);
}

export async function deleteTasks(taskIds: string[]): Promise<void> {
    if (taskIds.length === 0) return;
    await getPool().query('delete from tasks where task_id = any($1)', [taskIds]);
}
