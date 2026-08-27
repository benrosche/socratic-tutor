/**
 * The database schema, as a string rather than a .sql file on disk, so the
 * deployable image needs no files outside src/ and `npm run migrate` and the
 * tests provably apply the same SQL.
 *
 * Idempotent, including the upgrade from the single-course 0.2.0 shape.
 */
export const SCHEMA_SQL = `
-- One row per course. The token IS the course identity: a request's bearer token
-- decides which course's content it can see, so a stats token cannot reach an SNA
-- solution even by guessing task ids. Tokens are stored hashed.
create table if not exists courses (
    course     text        primary key,   -- e.g. 'sna-2026-fall'
    token_hash text        not null unique,
    active     boolean     not null default true,
    created_at timestamptz not null default now()
);

-- Reference solutions, loaded from the private solutions repo by \`npm run load\`.
-- Task ids are only unique within a course: two courses can both have a notebook
-- called 01_intro_to_r, hence the composite key.
create table if not exists tasks (
    course     text        not null,
    task_id    text        not null,      -- e.g. 'r-lab-1'
    notebook   text        not null,      -- e.g. 'r-lab' (prefix before the last '-')
    title      text,                      -- heading text, for the dashboard
    solution   text        not null,      -- raw Solution callout body
    updated_at timestamptz not null default now(),
    primary key (course, task_id)
);

-- One row per tutor request. Doubles as the escalation counter: a student's level
-- on a task is 1 + the number of prior rows for that (course, student, task_id).
-- Question text is logged verbatim; this is disclosed in the README and syllabus.
create table if not exists events (
    id       bigserial   primary key,
    course   text        not null,
    student  text        not null,   -- normalized, self-reported GitHub username
    task_id  text        not null,
    level    smallint    not null,   -- nth ask by this student on this task
    question text,                   -- what the student actually typed
    found    boolean     not null,   -- whether task_id resolved to a solution
    ts       timestamptz not null default now()
);

create index if not exists events_course_task_ts_idx on events (course, task_id, ts);
create index if not exists events_course_student_idx on events (course, student, task_id);
create index if not exists events_ts_idx             on events (ts);

-- Upgrade path from the single-course 0.2.0 schema. No-ops on a fresh database.
-- Solutions are reloadable, so backfilling them to a placeholder course is safe;
-- re-run \`npm run load\` with the real --course afterwards.
do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_name = 'tasks' and column_name = 'course') then
        alter table tasks add column course text not null default 'default';
        alter table tasks drop constraint if exists tasks_pkey;
        alter table tasks add primary key (course, task_id);
        alter table tasks alter column course drop default;
    end if;

    if not exists (select 1 from information_schema.columns
                   where table_name = 'events' and column_name = 'course') then
        alter table events add column course text not null default 'default';
        alter table events alter column course drop default;
    end if;
end $$;
`;
