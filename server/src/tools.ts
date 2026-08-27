import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    countPriorAsks,
    countRecentRequests,
    getTask,
    logEvent,
    suggestTasks,
    taskStats,
} from './db.js';

export const SERVER_VERSION = '0.2.0';

/**
 * Requests one student may make per window before being refused. Read at call
 * time rather than module load so the limits can be changed without a rebuild
 * and exercised directly in tests.
 */
const rateLimit = (): number => Number(process.env.RATE_LIMIT ?? 30);
const rateWindowMinutes = (): number => Number(process.env.RATE_WINDOW_MINUTES ?? 10);

export interface RequestContext {
    /** Normalized, self-reported GitHub username from the X-Tutor-Student header. */
    student: string;
}

/**
 * How strong a hint is appropriate on this ask. The level is persistent, so a
 * student who opens a fresh chat to reset the ladder does not reset it.
 *
 * Note this is advisory: the payload contains the full reference solution, so
 * the model already holds the answer on ask 1. The stance governs how much of
 * it the tutor is willing to surface, not what it knows.
 */
function stanceFor(level: number): string {
    if (level <= 1) {
        return 'FIRST ASK. Diagnose what is missing, ask one guiding question, and give at most one small hint. Do not show code.';
    }
    if (level === 2) {
        return 'SECOND ASK on this task. The earlier hint did not land. Give a stronger hint plus a structural scaffold — a breakdown into steps, or a skeleton with `...` placeholders. Still no working code.';
    }
    return `ASK ${level} on this task. The student has been stuck a while. A one-to-three line illustrative snippet is now appropriate. Never give the complete working solution for the task.`;
}

function textResult(payload: unknown, isError = false) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        isError,
    };
}

export function buildServer(ctx: RequestContext): McpServer {
    const server = new McpServer(
        { name: 'socratic-tutor', version: SERVER_VERSION },
        {
            instructions:
                'Provides reference context for a course exercise so the tutor can diagnose a stuck student. The reference is for the tutor\'s eyes only: never quote it, never restate code from it, and never hand over the complete solution.',
        }
    );

    server.registerTool(
        'check_connection',
        {
            title: 'Check the tutor server connection',
            description:
                'Diagnostic. Confirms the tutor can reach the course server, reports which student identity the server sees, and how many task solutions are loaded. Call this whenever the student asks whether the tutor is connected or working, or when troubleshooting.',
            inputSchema: {},
        },
        async () => {
            // The server being able to answer at all already proves reachability
            // and that the token and student header were accepted. What remains
            // uncertain is the database, so report that separately: "server up,
            // content missing" is a different problem from "cannot reach server".
            const base = {
                server_reachable: true,
                server_version: SERVER_VERSION,
                student_seen_by_server: ctx.student,
                rate_limit: `${rateLimit()} requests per ${rateWindowMinutes()} minutes`,
            };

            try {
                const stats = await taskStats();
                const recent = await countRecentRequests(ctx.student, rateWindowMinutes());

                return textResult({
                    ok: stats.count > 0,
                    ...base,
                    database: 'ok',
                    tasks_loaded: stats.count,
                    notebooks: stats.notebooks,
                    content_updated: stats.updatedAt,
                    your_requests_in_window: recent,
                    note:
                        stats.count === 0
                            ? 'The server is reachable but no solutions are loaded. The instructor needs to run `npm run load`.'
                            : 'Fully operational.',
                });
            } catch {
                return textResult(
                    {
                        ok: false,
                        ...base,
                        database: 'unreachable',
                        note: 'The tutor server is reachable but cannot reach its database, so no reference solutions are available. Report this to the instructor. Hints will be based only on the student\'s own code.',
                    },
                    true
                );
            }
        }
    );

    server.registerTool(
        'get_task_context',
        {
            title: 'Get reference context for a task',
            description:
                'Look up the instructor reference solution for a course task, together with a persistent escalation level for this student. Call this before giving a hint. The returned solution is private context for reasoning — it must never be quoted or reproduced to the student.',
            inputSchema: {
                task_id: z
                    .string()
                    .min(1)
                    .describe('Task ID from the `#| task:` marker in the student\'s notebook, e.g. "r-lab-1".'),
                question: z
                    .string()
                    .optional()
                    .describe('What the student asked, verbatim. Recorded so the instructor can see where the class is struggling.'),
            },
        },
        async ({ task_id, question }) => {
            const taskId = task_id.trim();
            const q = question?.trim() ? question.trim().slice(0, 4000) : null;

            const recent = await countRecentRequests(ctx.student, rateWindowMinutes());
            if (recent >= rateLimit()) {
                return textResult(
                    {
                        error: 'rate_limited',
                        message: `Too many tutor requests in the last ${rateWindowMinutes()} minutes. Keep working on the problem and try again shortly.`,
                    },
                    true
                );
            }

            const task = await getTask(taskId);

            if (!task) {
                await logEvent({ student: ctx.student, taskId, level: 0, question: q, found: false });
                const nearby = await suggestTasks(taskId);
                return textResult(
                    {
                        error: 'unknown_task',
                        task_id: taskId,
                        message:
                            'No reference solution is loaded for that task ID. Ask the student to check the `#| task:` marker in their notebook.',
                        known_tasks_in_notebook: nearby,
                    },
                    true
                );
            }

            const level = (await countPriorAsks(ctx.student, taskId)) + 1;
            await logEvent({ student: ctx.student, taskId, level, question: q, found: true });

            return textResult({
                task_id: task.task_id,
                title: task.title,
                level,
                stance: stanceFor(level),
                reference_solution: task.solution,
                reminder:
                    'PRIVATE. Use this only to work out what the student is missing and how strong a hint to give. Do not quote it, paraphrase it wholesale, or reproduce its code.',
            });
        }
    );

    return server;
}
