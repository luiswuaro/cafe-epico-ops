import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, 'src/infrastructure/db/schema.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db/migrations/0000_v0_1_core.sql'), 'utf8');

const schemaTables = new Set([...schema.matchAll(/pgTable\("([^"]+)"/g)].map((m) => m[1]));
const migrationTables = new Set([...migration.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"?([a-zA-Z0-9_]+)"?/gi)].map((m) => m[1]));

const missingInMigration = [...schemaTables].filter((t) => !migrationTables.has(t));
const extraInMigration = [...migrationTables].filter((t) => !schemaTables.has(t) && t !== 'schema_migrations');

if (missingInMigration.length || extraInMigration.length) {
  console.error({ missingInMigration, extraInMigration });
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'cafe-epico-ops') throw new Error('Unexpected package name');

console.log(`structure validation: PASS (${schemaTables.size} tables)`);
