import crypto from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, type RequestContext } from './tools.js';
import { getPool } from './db.js';

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
    const classToken = process.env.CLASS_TOKEN;
    if (!classToken) {
        throw new Error('CLASS_TOKEN is not set. Generate one (e.g. `openssl rand -hex 24`), set it in the Railway service variables, and hand the same value to students as TUTOR_TOKEN.');
    }

    /** Length-independent comparison, so a wrong token leaks nothing through timing. */
    const tokenMatches = (presented: string): boolean => {
        const a = crypto.createHash('sha256').update(presented).digest();
        const b = crypto.createHash('sha256').update(classToken).digest();
        return crypto.timingSafeEqual(a, b);
    };

    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '1mb' }));

    app.get('/healthz', async (_req, res) => {
        try {
            await getPool().query('select 1');
            res.status(200).json({ ok: true });
        } catch {
            res.status(503).json({ ok: false, error: 'database unreachable' });
        }
    });

    function authenticate(req: Request, res: Response, next: NextFunction): void {
        const header = req.get('authorization') ?? '';
        const match = header.match(/^Bearer\s+(.+)$/i);

        if (!match || !tokenMatches(match[1].trim())) {
            res.status(401).json({
                error: 'unauthorized',
                message: 'Missing or invalid class token. Set TUTOR_TOKEN in your .Renviron to the value your instructor gave you, then restart Positron.',
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

        (req as Request & { ctx: RequestContext }).ctx = { student };
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
