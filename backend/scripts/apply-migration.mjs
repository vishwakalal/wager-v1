/**
 * Applies a named Prisma migration via Neon's HTTP API (no raw TCP needed).
 * Used when outbound port 5432 is blocked on the current machine.
 *
 * Usage: DATABASE_URL=... node scripts/apply-migration.mjs <migration_name>
 * Example: DATABASE_URL=... node scripts/apply-migration.mjs 20260622120000_circles
 */
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const MIGRATION_NAME = process.argv[2];
if (!MIGRATION_NAME) {
  console.error("Usage: node scripts/apply-migration.mjs <migration_name>");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const migrationPath = join(
  __dirname,
  "../prisma/migrations",
  MIGRATION_NAME,
  "migration.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");
const checksum = createHash("sha256").update(migrationSql).digest("hex");

// Check if _prisma_migrations table exists.
const tables = await sql.query(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations'`,
);
if (tables.length === 0) {
  console.error("_prisma_migrations table not found");
  process.exit(1);
}

// Check if already applied.
const existing = await sql.query(
  `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
  [MIGRATION_NAME],
);
if (existing.length > 0) {
  console.log(`Migration ${MIGRATION_NAME} is already applied.`);
  process.exit(0);
}

console.log(`Applying migration: ${MIGRATION_NAME}`);

// Strip comment lines then split on ; to get individual statements.
const stripped = migrationSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const statements = stripped
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const stmt of statements) {
  console.log(`  → ${stmt.slice(0, 70).replace(/\s+/g, " ")}…`);
  await sql.query(stmt);
}

// Record in Prisma's migration history.
await sql.query(
  `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
   VALUES (gen_random_uuid()::text, $1, NOW(), $2, NULL, NULL, NOW(), 1)`,
  [checksum, MIGRATION_NAME],
);

console.log(`✓ Migration ${MIGRATION_NAME} applied and recorded.`);
