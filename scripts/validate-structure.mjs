import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schema = fs.readFileSync(
  path.join(root, "src/infrastructure/db/schema.ts"),
  "utf8",
);

const migrationsDir = path.join(root, "db/migrations");
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrations = migrationFiles
  .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
  .join("\n");

const schemaTables = new Set(
  [...schema.matchAll(/pgTable\("([^"]+)"/g)].map((match) => match[1]),
);
const migrationTables = new Set(
  [
    ...migrations.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+"?([a-zA-Z0-9_]+)"?/gi,
    ),
  ].map((match) => match[1]),
);

const missingInMigration = [...schemaTables].filter(
  (table) => !migrationTables.has(table),
);
const extraInMigration = [...migrationTables].filter(
  (table) => !schemaTables.has(table) && table !== "schema_migrations",
);

if (missingInMigration.length || extraInMigration.length) {
  console.error({
    migrationFiles,
    missingInMigration,
    extraInMigration,
  });
  process.exit(1);
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
if (packageJson.name !== "cafe-epico-ops") {
  throw new Error("Unexpected package name");
}

console.log(
  `structure validation: PASS (${schemaTables.size} tables across ${migrationFiles.length} migrations)`,
);
