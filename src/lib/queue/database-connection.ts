import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";

const hostSchema = z.string().min(1).max(253).refine(value =>
  isIP(value) !== 0 || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(value));
const answersSchema = z.array(z.strictObject({ address: z.string().refine(value => isIP(value) !== 0), family: z.union([z.literal(4), z.literal(6)]) })).min(1).max(32);
const tlsModes = new Set(["require", "verify-ca", "verify-full"]);

/** Exact operator-owned names only; never put rejected values in errors. */
function allowedHosts(value: unknown): Set<string> {
  if (value === undefined || value === "") return new Set();
  const parsed = z.string().max(16_384).safeParse(value);
  if (!parsed.success) throw new Error("QUEUE_DB_ALLOWED_HOSTS must contain comma-separated exact hostnames; wildcards, URLs and ports are forbidden.");
  const names = parsed.data.split(",").map(name => name.trim().toLowerCase());
  if (names.length > 100 || names.some(name => !hostSchema.safeParse(name).success))
    throw new Error("QUEUE_DB_ALLOWED_HOSTS must contain comma-separated exact hostnames; wildcards, URLs and ports are forbidden.");
  return new Set(names);
}

function isPrivateAddress(value: string): boolean {
  if (isIP(value) === 6) return value === "::1";
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  // Docker's IPv4 bridge networks are covered by these RFC1918 ranges.
  // Link-local/metadata, unspecified and IPv4-mapped IPv6 addresses are denied.
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function privateAddress(host: string): Promise<string> {
  if (isIP(host)) {
    if (isPrivateAddress(host)) return host;
    throw new Error(`Queue database host ${host}: public hosts require sslmode=require or stricter.`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), 5_000); timer.unref(); }),
    ]);
    const parsed = answersSchema.safeParse(result);
    if (!parsed.success || !parsed.data.every(answer => isPrivateAddress(answer.address)))
      throw new Error();
    return parsed.data[0].address;
  } catch {
    // Do not propagate resolver errors, which may contain untrusted text.
    throw new Error(`Queue database host ${host}: non-TLS requires every resolved address to be loopback or RFC1918 private; public hosts require sslmode=require or stricter.`);
  } finally { if (timer) clearTimeout(timer); }
}

export async function queueDatabaseConnection(databaseUrl: unknown, allowlist: unknown) {
  const hosts = allowedHosts(allowlist);
  const raw = z.string().min(1).max(16_384).safeParse(databaseUrl);
  let connection: URL;
  let host = "(invalid host)";
  try {
    connection = new URL(raw.success ? raw.data : "");
    const candidate = connection.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!hostSchema.safeParse(candidate).success) throw new Error();
    host = candidate;
    if (!/^postgres(?:ql)?:$/.test(connection.protocol) || connection.port !== "5432" ||
      connection.pathname !== "/postgres" || !connection.username || !connection.password || connection.hash)
      throw new Error();
  } catch {
    throw new Error(`Queue database host ${host}: PG_BOSS_DATABASE_URL requires a PostgreSQL session connection on port 5432, database postgres and credentials.`);
  }
  const supabase = host.endsWith(".pooler.supabase.com");
  if (!supabase && !hosts.has(host))
    throw new Error(`Queue database host ${host}: use the Supabase session pooler or an exact QUEUE_DB_ALLOWED_HOSTS entry (port 5432).`);

  const modes = connection.searchParams.getAll("sslmode");
  // Preserve the existing Supabase path: verified TLS regardless of URL SSL
  // parameters, including legacy sslmode=disable (it never disabled TLS).
  let tls = true;
  if (!supabase) {
    if (modes.length > 1 || (modes[0] !== undefined && !tlsModes.has(modes[0]) && modes[0] !== "disable"))
      throw new Error(`Queue database host ${host}: unsupported sslmode; use require, verify-ca or verify-full, or explicit private-network non-TLS.`);
    tls = modes.length === 1 && tlsModes.has(modes[0]);
    if (!tls) {
      // Connect to this exact validated address, not a second DNS lookup. This
      // prevents a rebinding/TOCTOU change from sending cleartext credentials out.
      const address = await privateAddress(host);
      connection.hostname = isIP(address) === 6 ? `[${address}]` : address;
    }
  }
  // pg-connection-string can replace ssl options and read local certificate
  // paths from query parameters. Never forward any arbitrary URL parameters.
  connection.search = "";
  const ca = process.env.PG_BOSS_SSL_CA?.replace(/\\n/g, "\n");
  return { connectionString: connection.toString(), ssl: tls ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false as const };
}
