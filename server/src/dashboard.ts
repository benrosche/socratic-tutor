/**
 * A read-only web view of the request log, served by the same service that
 * answers the tutor.
 *
 * Queried live on every request, so there is nothing to render and nothing to go
 * stale. This replaced a Quarto report that computed the same six panels from the
 * same two tables; keeping both meant maintaining two implementations of one
 * analysis, and the served one was strictly more current. For anything this does
 * not cover, query `events` and `tasks` directly rather than adding panels here
 * until it becomes that report again.
 *
 * Everything here is rendered server-side into one self-contained page. No
 * client-side JS, no external assets: the page carries student questions, so the
 * fewer places it can leak from, the better.
 */
import type { Request, Response } from 'express';
import { getPool, listCourses } from './db.js';

// --- html -------------------------------------------------------------------

/**
 * Question text is typed by students and rendered back into a page. Escaping it
 * is the whole defence — there is no client-side sanitizer to fall back on.
 */
function esc(s: unknown): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** A horizontal bar. CSS widths rather than SVG — less to get wrong, scales anywhere. */
function bar(label: string, value: number, max: number, note = ''): string {
    const pct = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
    return `<div class="row">
      <div class="lbl" title="${esc(label)}">${esc(label)}</div>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      <div class="val">${esc(value)}${note ? ` <span class="note">${esc(note)}</span>` : ''}</div>
    </div>`;
}

function panel(title: string, blurb: string, body: string): string {
    return `<section><h2>${esc(title)}</h2><p class="blurb">${esc(blurb)}</p>${body || '<p class="empty">Nothing yet.</p>'}</section>`;
}

const STYLE = `
:root { --bg:#fff; --fg:#1a1a1a; --muted:#666; --line:#e5e5e5; --fill:#31688e; --card:#fafafa; --warn:#b34700; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#15171a; --fg:#e8e8e8; --muted:#9aa0a6; --line:#2c3036; --fill:#5b9bd5; --card:#1c1f23; --warn:#ff9b52; }
}
* { box-sizing: border-box; }
body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
       font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
.wrap { max-width: 900px; margin: 0 auto; }
h1 { font-size:1.4rem; margin:0 0 .25rem; }
h2 { font-size:1.05rem; margin:0 0 .2rem; }
.sub { color:var(--muted); margin:0 0 1.5rem; font-size:.9rem; }
.blurb { color:var(--muted); font-size:.85rem; margin:0 0 .75rem; }
section { margin: 0 0 2.25rem; }
.stats { display:flex; flex-wrap:wrap; gap:.5rem; margin:0 0 2rem; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.6rem .9rem; }
.stat b { display:block; font-size:1.35rem; line-height:1.2; }
.stat span { color:var(--muted); font-size:.78rem; }
.row { display:flex; align-items:center; gap:.6rem; margin:.28rem 0; }
.lbl { flex:0 0 42%; font-size:.83rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.track { flex:1; background:var(--card); border-radius:3px; height:16px; overflow:hidden; }
.fill { background:var(--fill); height:100%; }
.val { flex:0 0 5.5rem; font-size:.83rem; text-align:right; font-variant-numeric:tabular-nums; }
.note { color:var(--muted); }
table { border-collapse:collapse; width:100%; font-size:.85rem; }
th,td { text-align:left; padding:.4rem .5rem; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; font-size:.78rem; }
td.q { white-space:pre-wrap; word-break:break-word; }
.scroll { overflow-x:auto; }
.empty { color:var(--muted); font-style:italic; }
.pill { display:inline-block; padding:.1rem .45rem; border:1px solid var(--line); border-radius:99px;
        font-size:.78rem; color:var(--muted); text-decoration:none; margin-right:.3rem; }
.pill.on { background:var(--fill); border-color:var(--fill); color:#fff; }
footer { color:var(--muted); font-size:.78rem; border-top:1px solid var(--line); padding-top:1rem; margin-top:2rem; }
.warn { color:var(--warn); }
`;

// --- the page ---------------------------------------------------------------

interface EventRow {
    course: string;
    student: string;
    task_id: string;
    level: number;
    question: string | null;
    found: boolean;
    ts: Date;
    title: string | null;
}

export async function renderDashboard(req: Request, res: Response): Promise<void> {
    const courses = await listCourses();
    const wanted = typeof req.query.course === 'string' ? req.query.course : '';
    const course = courses.some((c) => c.course === wanted) ? wanted : '';

    const params: unknown[] = [];
    let where = '';
    if (course) {
        params.push(course);
        where = 'where e.course = $1';
    }

    const { rows: events } = await getPool().query<EventRow>(
        `select e.course, e.student, e.task_id, e.level, e.question, e.found, e.ts, t.title
         from events e
         left join tasks t on t.course = e.course and t.task_id = e.task_id
         ${where}
         order by e.ts desc`,
        params
    );

    const label = course || 'all courses';
    const nav = [
        `<a class="pill ${course ? '' : 'on'}" href="/dashboard">all courses</a>`,
        ...courses.map(
            (c) => `<a class="pill ${course === c.course ? 'on' : ''}" href="/dashboard?course=${encodeURIComponent(c.course)}">${esc(c.course)}</a>`
        ),
    ].join('');

    if (events.length === 0) {
        res.status(200).type('html').send(page(label, nav, `
          <p class="empty">No tutor requests recorded yet for ${esc(label)}.
          Once students start asking, this fills in.</p>`,
            courses.reduce((n, c) => n + c.tasks, 0)));
        return;
    }

    const students = new Set(events.map((e) => e.student));
    const found = events.filter((e) => e.found);

    // --- most-asked -----------------------------------------------------
    const perTask = new Map<string, { n: number; title: string | null }>();
    for (const e of found) {
        const cur = perTask.get(e.task_id) ?? { n: 0, title: e.title };
        cur.n++;
        perTask.set(e.task_id, cur);
    }
    const topTasks = [...perTask.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
    const maxTask = topTasks[0]?.[1].n ?? 0;

    // --- genuinely stuck ------------------------------------------------
    // The share of a task's askers who got as far as level 3. Many level-1 asks
    // is a wording problem; a handful of level-3s is a task people cannot do.
    const reach = new Map<string, { deep: Set<string>; all: Set<string> }>();
    for (const e of found) {
        const cur = reach.get(e.task_id) ?? { deep: new Set<string>(), all: new Set<string>() };
        cur.all.add(e.student);
        if (e.level >= 3) cur.deep.add(e.student);
        reach.set(e.task_id, cur);
    }
    const stuck = [...reach.entries()]
        .map(([id, v]) => ({ id, deep: v.deep.size, all: v.all.size, pct: Math.round((v.deep.size / v.all.size) * 100) }))
        .filter((s) => s.deep > 0)
        .sort((a, b) => b.pct - a.pct || b.deep - a.deep)
        .slice(0, 15);

    // --- who is asking ---------------------------------------------------
    const perStudent = new Map<string, number>();
    for (const e of events) perStudent.set(e.student, (perStudent.get(e.student) ?? 0) + 1);
    const topStudents = [...perStudent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const maxStudent = topStudents[0]?.[1] ?? 0;

    // --- by day ----------------------------------------------------------
    const perDay = new Map<string, number>();
    for (const e of events) {
        const d = e.ts.toISOString().slice(0, 10);
        perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const days = [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-21);
    const maxDay = Math.max(...days.map((d) => d[1]), 0);

    // --- unresolved lookups ----------------------------------------------
    // found=false means a student asked about a task with no solution loaded.
    // That is an instructor bug, not a student one, so it is worth its own panel.
    const missing = new Map<string, number>();
    for (const e of events.filter((x) => !x.found)) missing.set(e.task_id, (missing.get(e.task_id) ?? 0) + 1);
    const missingRows = [...missing.entries()].sort((a, b) => b[1] - a[1]);

    // --- silent exercises -------------------------------------------------
    // Loaded, but nobody has ever asked. Ambiguous by design — either everyone
    // got it or nobody attempted it — so it is listed, not charted.
    const { rows: allTasks } = await getPool().query<{ course: string; task_id: string; title: string | null }>(
        `select course, task_id, title from tasks ${course ? 'where course = $1' : ''} order by course, task_id`,
        params
    );
    const silent = allTasks.filter((t) => !perTask.has(t.task_id));

    const fmt = (d: Date) =>
        d.toISOString().slice(0, 16).replace('T', ' ');

    const body = `
      <div class="stats">
        <div class="stat"><b>${events.length}</b><span>requests</span></div>
        <div class="stat"><b>${students.size}</b><span>students</span></div>
        <div class="stat"><b>${perTask.size}</b><span>exercises asked about</span></div>
        <div class="stat"><b>${stuck.length}</b><span>exercises reaching level 3+</span></div>
        ${missingRows.length ? `<div class="stat"><b class="warn">${events.length - found.length}</b><span>lookups with no solution</span></div>` : ''}
      </div>

      ${panel('Which exercises generate the most requests', 'The blunt measure of difficulty. Long bars are exercises students cannot get through alone.',
        topTasks.map(([id, v]) => bar(v.title ? `${id} — ${v.title}` : id, v.n, maxTask)).join(''))}

      ${panel('Which exercises leave students genuinely stuck', 'Share of that exercise’s askers who reached level 3 or higher. Many level-1 asks usually means the wording is unclear; level 3 means the exercise itself is hard.',
        stuck.map((s) => bar(s.id, s.pct, 100, `% (${s.deep}/${s.all})`)).join(''))}

      ${panel('Who is asking', 'Whether requests are spread across the class or concentrated in a few students. Concentration is worth a quiet check-in, not a grade.',
        topStudents.map(([s, n]) => bar(s, n, maxStudent)).join(''))}

      ${panel('When the work happens', 'Requests per day, most recent 21 days with activity.',
        days.map(([d, n]) => bar(d, n, maxDay)).join(''))}

      ${missingRows.length
        ? panel('Asked about, but no solution loaded', 'Students hit "not found" here. This is yours to fix: annotate the solution notebook and re-run npm run load. Check npm run verify for the full list, including exercises nobody has asked about yet.',
            `<div class="scroll"><table><tr><th>exercise</th><th>times asked</th></tr>${missingRows
                .map(([id, n]) => `<tr><td>${esc(id)}</td><td>${esc(n)}</td></tr>`).join('')}</table></div>`)
        : ''}

      ${panel('What students actually asked', 'Verbatim, most recent first. Counts tell you where; the wording tells you why.',
        `<div class="scroll"><table>
           <tr><th>when</th><th>student</th><th>exercise</th><th>lvl</th><th>question</th></tr>
           ${events.slice(0, 100).map((e) => `<tr>
             <td>${esc(fmt(e.ts))}</td>
             <td>${esc(e.student)}</td>
             <td>${esc(e.task_id)}${e.found ? '' : ' <span class="warn">(not found)</span>'}</td>
             <td>${esc(e.level)}</td>
             <td class="q">${esc(e.question ?? '')}</td>
           </tr>`).join('')}
         </table></div>
         ${events.length > 100 ? `<p class="blurb">Showing the 100 most recent of ${events.length}.</p>` : ''}`)}

      ${panel('Exercises nobody asks about', 'Loaded, but never asked about. Ambiguous by design: either everyone got it, or nobody attempted it. Worth pairing with submission data before drawing a conclusion.',
        silent.length
            ? `<div class="scroll"><table><tr><th>exercise</th><th>title</th></tr>${silent
                .map((t) => `<tr><td>${esc(t.task_id)}</td><td>${esc(t.title ?? '')}</td></tr>`).join('')}</table></div>
               <p class="blurb">${silent.length} of ${allTasks.length} loaded exercises.</p>`
            : '<p class="empty">Every loaded exercise has been asked about at least once.</p>')}
    `;

    res.status(200).type('html').send(page(label, nav, body, courses.reduce((n, c) => n + c.tasks, 0)));
}

function page(label: string, nav: string, body: string, tasksLoaded: number): string {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Socratic Tutor — ${esc(label)}</title>
<style>${STYLE}</style>
</head><body><div class="wrap">
<h1>Socratic Tutor — where the class is struggling</h1>
<p class="sub">${esc(label)} · ${esc(tasksLoaded)} exercises loaded · queried ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC</p>
<p>${nav}</p>
${body}
<footer>
  This page contains student usernames and the text of their questions. It measures
  <em>asking</em>, not struggling: an exercise with no requests may mean everyone
  understood it or that nobody attempted it. With a small class most cells are thin —
  read the top few as signal and the rest as noise.
  <br><br>Live from the database on every load. For anything deeper, query the
  <code>events</code> and <code>tasks</code> tables directly — see the README.
</footer>
</div></body></html>`;
}
