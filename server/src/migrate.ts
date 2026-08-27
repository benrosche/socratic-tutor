/**
 * Applies the schema. Idempotent, so it is safe to re-run after a schema change.
 * Exists so you never need psql installed locally.
 *
 *   npm run migrate
 */
import { closePool, getPool } from './db.js';
import { SCHEMA_SQL } from './schema.js';

async function main(): Promise<void> {
    await getPool().query(SCHEMA_SQL);

    const { rows } = await getPool().query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' order by table_name`
    );

    console.log('Schema applied.');
    console.log(`Tables: ${rows.map((r) => r.table_name).join(', ') || '(none)'}`);
    await closePool();
}

main().catch(async (err) => {
    console.error(err);
    await closePool().catch(() => {});
    process.exit(1);
});
