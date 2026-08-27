import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, type RequestContext } from './tools.js';
import { courseForToken, getPool } from './db.js';

/**
 * Identity is self-reported: the student sets TUTOR_STUDENT in their environment
 * and Posit Assistant forwards it as a header. Normalizing here keeps
 * "Alice-NYU", "alice-nyu " and "@alice-nyu" from becoming three students in the
 * dashboard. It is not authentication — see the README.
 */
export function normalizeStudent(raw: string): string | null {
    const value = raw.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/.test(value)) return null;
    return value;
}

export function createApp(): Express {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '1mb' }));

    /**
     * Liveness, not readiness — this always answers 200 if the process is serving.
     *
     * Gating it on the database meant a database blip failed the platform health
     * check, which restarted the container, which did not fix the database. The
     * database state is still reported in the body, and `check_connection` is what
     * surfaces it to the tutor.
     */
    app.get('/healthz', async (_req, res) => {
        if (!process.env.DATABASE_URL) {
            res.status(200).json({ ok: false, database: 'unset', detail: 'DATABASE_URL is not set on this service.' });
            return;
        }
        try {
            await getPool().query('select 1');
            res.status(200).json({ ok: true, database: 'ok' });
        } catch (err) {
            res.status(200).json({
                ok: false,
                database: 'error',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    /**
     * The bearer token identifies the *course*, not just the caller. Everything
     * downstream is scoped to whatever this resolves to, so a token issued for one
     * class cannot reach another class's solutions.
     */
    async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
        const header = req.get('authorization') ?? '';
        const match = header.match(/^Bearer\s+(.+)$/i);

        if (!match) {
            res.status(401).json({
                error: 'unauthorized',
                message: 'Missing class token. Set TUTOR_TOKEN in your .Renviron to the value your instructor gave you, then restart Positron.',
            });
            return;
        }

        let course: string | null;
        try {
            course = await courseForToken(match[1]);
        } catch (err) {
            // Distinguished from a bad token on purpose: this is the instructor's
            // problem, not the student's, and saying "invalid token" would send
            // them chasing their own configuration.
            console.error('[auth] course lookup failed', err);
            res.status(503).json({
                error: 'server_unavailable',
                message: 'The tutor server cannot reach its database, so it cannot verify your class token. This is a server problem — tell your instructor.',
            });
            return;
        }

        if (!course) {
            res.status(401).json({
                error: 'unauthorized',
                message: 'That class token is not valid for any active course. Check TUTOR_TOKEN in your .Renviron, then restart Positron.',
            });
            return;
        }

        const rawStudent = req.get('x-tutor-student');
        if (!rawStudent) {
            res.status(400).json({
                error: 'missing_student',
                message: 'No student identifier. Set TUTOR_STUDENT in your .Renviron to your GitHub username, then restart Positron.',
            });
            return;
        }

        const student = normalizeStudent(rawStudent);
        if (!student) {
            res.status(400).json({
                error: 'invalid_student',
                message: `"${rawStudent}" is not a valid GitHub username. Set TUTOR_STUDENT in your .Renviron to your GitHub username (letters, digits and hyphens), then restart Positron.`,
            });
            return;
        }

        (req as Request & { ctx: RequestContext }).ctx = { course, student };
        next();
    }

    /**
     * Stateless transport: a fresh server and transport per request. All state that
     * matters — the escalation counter — lives in Postgres, so there is nothing to
     * keep in memory between calls and nothing to lose on redeploy.
     */
    app.post('/mcp', authenticate, async (req, res) => {
        const { ctx } = req as Request & { ctx: RequestContext };
        const server = buildServer(ctx);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        res.on('close', () => {
            void transport.close();
            void server.close();
        });

        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            console.error('[mcp] request failed', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'internal_error' });
            }
        }
    });

    // Stateless mode has no session to resume or terminate.
    app.get('/mcp', (_req, res) => res.status(405).json({ error: 'method_not_allowed' }));
    app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'method_not_allowed' }));

    return app;
}
