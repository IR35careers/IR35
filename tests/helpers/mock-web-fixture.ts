import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";
import { STAGING_TEST_ACCOUNT } from "@/lib/queue/mock-config";

export const mockWebIds = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
export const mockWebTestEnv = () => ({ IR35_MOCK_WEB_ENABLED: "true", IR35_STAGING: "true", APPLY_RUNNER: "mock",
  APPLICATION_WORKER_ACCEPT_JOBS: "false", IR35_READ_ONLY: "false", APPLICATION_WORKER_CONCURRENCY: "1",
  IR35_SCHEDULER_ENABLED: "false", APPLICATION_WORKER_SECRET: "fixture-only-never-a-real-key-0000000000",
  IR35CAREERS_APP_URL: "https://staging.ir35careers.com", IR35_MOCK_WEB_JOB_IDS: mockWebIds.join(",") });
export const mockWebTestUser = "11111111-1111-4111-8111-111111111111";

/** SDK -> narrow in-memory PostgREST fixture -> REAL PostgreSQL migration RPCs.
 * No network, operator files, uploaded keys, cloud, candidate data or private DB.
 * Deliberately supports ONLY the exact tables/operations the new boundary uses.
 */
export function lifecycleSdkFixture(db: PGlite, options: { email?: string; calls?: string[]; users?: Record<string, string> } = {}): SupabaseClient {
  const ident = (value: string) => {
    if (!/^[a-z_]+$/.test(value)) throw new Error("Fixture identifier rejected.");
    return `"${value}"`;
  };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== "https://sdk-fixture.invalid") throw new Error("Fixture refused network/private state.");
    options.calls?.push(`${request.method} ${url.pathname}`);
    const authId = /^\/auth\/v1\/admin\/users\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
    if (authId && (authId === mockWebTestUser || options.users?.[authId]))
      return reply({ id: authId, email: options.users?.[authId] ?? options.email ?? STAGING_TEST_ACCOUNT, email_confirmed_at: "2026-01-01T00:00:00Z" });
    if (url.pathname === "/auth/v1/user") return reply({ id: mockWebTestUser,
      email: options.email ?? STAGING_TEST_ACCOUNT, email_confirmed_at: "2026-01-01T00:00:00Z" });
    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    try {
      if (rpc) {
        const body: Record<string, unknown> = await request.json();
        const names: Record<string, string[]> = {
          transition_application_delivery: ["p_id", "p_user_id", "p_to", "p_reason", "p_detail", "p_retry"],
          claim_application_delivery_task: ["p_worker_id", "p_application_id"],
          commit_application_delivery_result: ["p_id", "p_user_id", "p_to", "p_receipt", "p_questions", "p_keep_approval", "p_reason", "p_detail", "p_task_id", "p_attempt"],
        };
        const keys = names[rpc[1]];
        if (!keys || request.method !== "POST" || Object.keys(body).some(key => !keys.includes(key))) throw new Error("Fixture RPC refused.");
        const result = await db.query(`SELECT * FROM public.${ident(rpc[1])}(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
          keys.map(key => typeof body[key] === "object" && body[key] !== null ? JSON.stringify(body[key]) : body[key] ?? null));
        return reply(rpc[1] === "claim_application_delivery_task" ? result.rows : (result.rows[0] as Record<string, unknown>)[rpc[1]]);
      }
      const table = url.pathname.replace("/rest/v1/", "");
      if (!["jobs", "profiles", "application_packets", "application_submissions", "application_worker_tasks", "application_worker_heartbeats"].includes(table)) throw new Error("Fixture table refused.");
      const parameters: unknown[] = [], where: string[] = [];
      for (const [key, value] of url.searchParams) {
        if (["select", "on_conflict", "limit"].includes(key)) continue;
        if (value.startsWith("in.(") && value.endsWith(")")) {
          const list = value.slice(4, -1).split(",");
          where.push(`${ident(key)} IN (${list.map(item => { parameters.push(item); return `$${parameters.length}`; }).join(",")})`);
        } else {
          const operator = value.startsWith("eq.") ? "=" : value.startsWith("lt.") ? "<" : null;
          if (!operator) throw new Error("Fixture filter refused.");
          parameters.push(value.slice(3)); where.push(`${ident(key)}${operator}$${parameters.length}`);
        }
      }
      if (request.method === "GET") {
        const selected = url.searchParams.get("select") ?? "";
        const columns = selected === "*" ? "*" : selected.split(",").map(ident).join(",");
        const limit = url.searchParams.get("limit");
        if (limit && !/^\d+$/.test(limit)) throw new Error("Fixture limit refused.");
        const result = await db.query(`SELECT ${columns} FROM ${ident(table)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${limit ? ` LIMIT ${Number(limit)}` : ""}`, parameters);
        return reply(result.rows);
      }
      const body: Record<string, unknown> = await request.json();
      const columns = Object.keys(body), values = columns.map(key => typeof body[key] === "object" && body[key] !== null ? JSON.stringify(body[key]) : body[key]);
      if (request.method === "POST" && request.headers.get("prefer")?.includes("resolution=")) {
        const conflict = (url.searchParams.get("on_conflict") ?? (table === "application_worker_heartbeats" ? "worker_id" : "")).split(",").map(ident).join(",");
        const update = request.headers.get("prefer")?.includes("resolution=ignore-duplicates") ? "NOTHING"
          : `UPDATE SET ${columns.map(key => `${ident(key)}=EXCLUDED.${ident(key)}`).join(",")}`;
        await db.query(`INSERT INTO ${ident(table)}(${columns.map(ident).join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT(${conflict}) DO ${update}`, values);
      } else if (request.method === "PATCH" && where.length) {
        await db.query(`UPDATE ${ident(table)} SET ${columns.map((key, i) => `${ident(key)}=$${parameters.length + i + 1}`).join(",")} WHERE ${where.join(" AND ")}`, [...parameters, ...values]);
      } else throw new Error("Fixture write refused.");
      return reply(null);
    } catch {
      return reply({ code: "FIXTURE_REJECTED", message: "In-memory fixture operation rejected." }, 400);
    }
  };
  return createClient("https://sdk-fixture.invalid", "public-non-secret-sdk-test-fixture", {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  });
}
