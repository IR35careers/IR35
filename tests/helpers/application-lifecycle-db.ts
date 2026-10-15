import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/** Isolated PostgreSQL fixture. No credentials, network or real candidate data. */
export async function createTestLifecycleDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY); CREATE TABLE jobs(id uuid PRIMARY KEY);
    CREATE TABLE resume_versions(id uuid PRIMARY KEY);`);
  for (const migration of ["010_application_workspace", "013_application_submission_queue", "020_application_worker_tasks",
    "024_railway_worker_watchdog", "025_application_delivery_lifecycle"]) {
    await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
  }
  return db;
}
