/**
 * Integration tests. These run against a real Postgres — the escalation counter
 * is SQL, so testing it against a mock would test the mock.
 *
 *   docker run -d --name tutor-test-pg -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=tutor_test -p 5433:5432 postgres:16-alpine
 *
 *   DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/tutor_test npm test
 *
 * The suite TRUNCATES its tables, so it refuses to run against a database whose
 * name does not contain "test".
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.CLASS_TOKEN ??= 'test-class-token';
process.env.RATE_LIMIT ??= '5';
process.env.RATE_WINDOW_MINUTES ??= '10';

const { createApp } = await import('../app.js');
const { closePool, getPool, upsertTask } = await import('../db.js');
const { SCHEMA_SQL } = await import('../schema.js');

const TOKEN = process.env.CLASS_TOKEN!;

let server: Server;
let base: string;

function headers(student?: string, token: string | null = TOKEN): Record<string, string> {
    const h: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
    };
    if (token !== null) h.Authorization = `Bearer ${token}`;
    if (student !== undefined) h['X-Tutor-Student'] = student;
    return h;
}

async function rpc(body: unknown, h: Record<string, string>): Promise<Response> {
    return fetch(`${base}/mcp`, { method: 'POST', headers: h, body: JSON.stringify(body) });
}

/** `Response.json()` is typed `unknown`; these are our own fixtures. */
async function json(res: Response): Promise<any> {
    return res.json();
}

/** Unwraps the SSE envelope the streamable-HTTP transport replies with. */
async function parseSse(res: Response): Promise<any> {
    const text = await res.text();
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    assert.ok(line, `no SSE data frame in response: ${text.slice(0, 300)}`);
    return JSON.parse(line.slice(6));
}

async function callTool(
    name: string,
    args: Record<string, unknown>,
    student = 'alice-nyu'
): Promise<{ isError: boolean; payload: any }> {
    const res = await rpc(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
        headers(student)
    );
    const env = await parseSse(res);
    assert.ok(env.result, `tool call errored: ${JSON.stringify(env).slice(0, 300)}`);
    return { isError: !!env.result.isError, payload: JSON.parse(env.result.content[0].text) };
}

before(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL must be set to a scratch database. See the header of this file.');
    if (!/test/i.test(url)) {
        throw new Error(`Refusing to run: these tests TRUNCATE tables and "${url.replace(/:[^:@]*@/, ':***@')}" does not look like a test database.`);
    }

    await getPool().query(SCHEMA_SQL);

    await new Promise<void>((resolve) => {
        server = createApp().listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
});

beforeEach(async () => {
    await getPool().query('truncate events, tasks');
    await upsertTask({
        taskId: 'r-lab-1',
        notebook: 'r-lab',
        title: 'Sum the even numbers',
        solution: 'sum_even <- function(x) sum(x[x %% 2 == 0])',
    });
    await upsertTask({
        taskId: 'r-lab-2',
        notebook: 'r-lab',
        title: 'Count words',
        solution: 'count_words <- function(s) length(strsplit(trimws(s), "\\\\s+")[[1]])',
    });
});

describe('authentication', () => {
    it('rejects a request with no token', async () => {
        const res = await rpc({}, headers('alice-nyu', null));
        assert.equal(res.status, 401);
        assert.equal((await json(res)).error, 'unauthorized');
    });

    it('rejects a wrong token', async () => {
        const res = await rpc({}, headers('alice-nyu', 'not-the-token'));
        assert.equal(res.status, 401);
    });

    it('rejects a token of a different length without leaking timing', async () => {
        const res = await rpc({}, headers('alice-nyu', 'x'));
        assert.equal(res.status, 401);
    });

    it('requires a student header', async () => {
        const res = await rpc({}, headers(undefined));
        assert.equal(res.status, 400);
        assert.equal((await json(res)).error, 'missing_student');
    });

    it('rejects a malformed username', async () => {
        const res = await rpc({}, headers('not a username!'));
        assert.equal(res.status, 400);
        assert.equal((await json(res)).error, 'invalid_student');
    });

    it('health check does not require a token', async () => {
        const res = await fetch(`${base}/healthz`);
        assert.equal(res.status, 200);
        assert.equal((await json(res)).ok, true);
    });
});

describe('check_connection', () => {
    it('reports loaded content and the identity the server sees', async () => {
        const { payload } = await callTool('check_connection', {}, 'Alice-NYU');
        assert.equal(payload.ok, true);
        assert.equal(payload.server_reachable, true);
        assert.equal(payload.database, 'ok');
        assert.equal(payload.tasks_loaded, 2);
        assert.deepEqual(payload.notebooks, ['r-lab']);
        // Normalization is what the student needs to see to spot a typo'd username.
        assert.equal(payload.student_seen_by_server, 'alice-nyu');
    });

    it('flags an empty database rather than reporting healthy', async () => {
        await getPool().query('truncate tasks');
        const { payload } = await callTool('check_connection', {});
        assert.equal(payload.ok, false);
        assert.match(payload.note, /no solutions are loaded/i);
    });

    it('is listed alongside get_task_context', async () => {
        const env = await parseSse(
            await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers('alice-nyu'))
        );
        const names = env.result.tools.map((t: { name: string }) => t.name).sort();
        assert.deepEqual(names, ['check_connection', 'get_task_context']);
    });
});

describe('get_task_context', () => {
    it('returns the reference solution', async () => {
        const { payload } = await callTool('get_task_context', { task_id: 'r-lab-1', question: 'help' });
        assert.equal(payload.task_id, 'r-lab-1');
        assert.match(payload.reference_solution, /sum_even/);
        assert.equal(payload.level, 1);
        assert.match(payload.stance, /FIRST ASK/);
    });

    it('trims whitespace around the task id', async () => {
        const { payload } = await callTool('get_task_context', { task_id: '  r-lab-1 ' });
        assert.equal(payload.task_id, 'r-lab-1');
    });

    it('reports an unknown task with the valid ids in that notebook', async () => {
        const { isError, payload } = await callTool('get_task_context', { task_id: 'r-lab-99' });
        assert.equal(isError, true);
        assert.equal(payload.error, 'unknown_task');
        assert.deepEqual(payload.known_tasks_in_notebook, ['r-lab-1', 'r-lab-2']);
    });
});

describe('escalation', () => {
    // Each call below is a separate stateless HTTP request, which is exactly what
    // "the student opened a fresh chat window" looks like to the server.
    it('increments across independent requests', async () => {
        for (const expected of [1, 2, 3, 4]) {
            const { payload } = await callTool('get_task_context', { task_id: 'r-lab-1' });
            assert.equal(payload.level, expected);
        }
    });

    it('changes stance as the level rises', async () => {
        const seen: string[] = [];
        for (let i = 0; i < 3; i++) {
            const { payload } = await callTool('get_task_context', { task_id: 'r-lab-1' });
            seen.push(payload.stance);
        }
        assert.match(seen[0], /FIRST ASK/);
        assert.match(seen[1], /SECOND ASK/);
        assert.match(seen[2], /ASK 3/);
    });

    it('is tracked per task', async () => {
        await callTool('get_task_context', { task_id: 'r-lab-1' });
        await callTool('get_task_context', { task_id: 'r-lab-1' });
        const { payload } = await callTool('get_task_context', { task_id: 'r-lab-2' });
        assert.equal(payload.level, 1);
    });

    it('is tracked per student', async () => {
        await callTool('get_task_context', { task_id: 'r-lab-1' }, 'alice-nyu');
        await callTool('get_task_context', { task_id: 'r-lab-1' }, 'alice-nyu');
        const { payload } = await callTool('get_task_context', { task_id: 'r-lab-1' }, 'bob-codes');
        assert.equal(payload.level, 1);
    });

    it('is not advanced by a failed lookup', async () => {
        await callTool('get_task_context', { task_id: 'r-lab-99' });
        const { payload } = await callTool('get_task_context', { task_id: 'r-lab-1' });
        assert.equal(payload.level, 1);
    });
});

describe('logging', () => {
    it('records the question verbatim against the normalized username', async () => {
        await callTool('get_task_context', { task_id: 'r-lab-1', question: 'why is it 21 not 12?' }, 'Alice-NYU');
        const { rows } = await getPool().query(
            'select student, task_id, level, question, found from events'
        );
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0], {
            student: 'alice-nyu',
            task_id: 'r-lab-1',
            level: 1,
            question: 'why is it 21 not 12?',
            found: true,
        });
    });

    it('records failed lookups so unknown task ids are visible to the instructor', async () => {
        await callTool('get_task_context', { task_id: 'typo-1' });
        const { rows } = await getPool().query('select task_id, found, level from events');
        assert.deepEqual(rows, [{ task_id: 'typo-1', found: false, level: 0 }]);
    });

    it('stores a null question when none was supplied', async () => {
        await callTool('get_task_context', { task_id: 'r-lab-1' });
        const { rows } = await getPool().query('select question from events');
        assert.equal(rows[0].question, null);
    });
});

describe('rate limiting', () => {
    it('refuses past the limit and keeps students independent', async () => {
        const limit = Number(process.env.RATE_LIMIT);

        for (let i = 0; i < limit; i++) {
            const { isError } = await callTool('get_task_context', { task_id: 'r-lab-1' }, 'carol-r');
            assert.equal(isError, false, `request ${i + 1} should have been allowed`);
        }

        const blocked = await callTool('get_task_context', { task_id: 'r-lab-1' }, 'carol-r');
        assert.equal(blocked.isError, true);
        assert.equal(blocked.payload.error, 'rate_limited');

        const other = await callTool('get_task_context', { task_id: 'r-lab-1' }, 'dave-x');
        assert.equal(other.isError, false);
    });
});
