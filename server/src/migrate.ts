/**
 * Applies db/schema.sql. Idempotent, so it is safe to re-run after a schema
 * change. Exists so you never need psql installed locally.
 *
 *   npm run migrate
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, '..', '..', 'db', 'schema.sql');

async function main(): Promise<void> {
    const sql = await fs.readFile(schemaPath, 'utf8');
    await getPool().query(sql);

    const { rows } = await getPool().query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' order by table_name`
    );

    console.log(`Applied ${path.relative(process.cwd(), schemaPath)}.`);
    console.log(`Tables: ${rows.map((r) => r.table_name).join(', ') || '(none)'}`);
    await closePool();
}

main().catch(async (err) => {
    console.error(err);
    await closePool().catch(() => {});
    process.exit(1);
});
