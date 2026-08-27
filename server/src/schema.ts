/**
 * The database schema, as a string rather than a .sql file on disk.
 *
 * This was `db/schema.sql` until Railway's build context repeatedly failed to
 * include it — at two different paths, while copying sibling directories fine.
 * Embedding it removes the file-copy dependency entirely, and has the side
 * benefit that `npm run migrate` and the integration tests provably apply the
 * same SQL rather than merely reading the same path.
 *
 * Idempotent: safe to re-run after a change.
 */
export const SCHEMA_SQL = `
-- Reference solutions, loaded from the private solutions repo by \`npm run load\`.
-- This is the only place course content lives on the server; the public repo
-- never contains it.
create table if not exists tasks (
    task_id    text        primary key,   -- e.g. 'r-lab-1'
    notebook   text        not null,      -- e.g. 'r-lab' (prefix before the last '-')
    title      text,                      -- heading text, for the dashboard
    solution   text        not null,      -- raw Solution callout body
    updated_at timestamptz not null default now()
);

-- One row per tutor request. Doubles as the escalation counter: a student's
-- level on a task is 1 + the number of prior rows for that (student, task_id).
-- Question text is logged verbatim; this is disclosed in the README and syllabus.
create table if not exists events (
    id       bigserial   primary key,
    student  text        not null,   -- normalized, self-reported GitHub username
    task_id  text        not null,
    level    smallint    not null,   -- nth ask by this student on this task
    question text,                   -- what the student actually typed
    found    boolean     not null,   -- whether task_id resolved to a solution
    ts       timestamptz not null default now()
);

create index if not exists events_task_ts_idx      on events (task_id, ts);
create index if not exists events_student_task_idx on events (student, task_id);
create index if not exists events_ts_idx           on events (ts);
`;
