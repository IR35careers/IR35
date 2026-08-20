import { createClient } from "@supabase/supabase-js";

function validEmail(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function maskEmail(value: string): string {
  const [local, domain = ""] = value.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Production Supabase credentials are required.");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from("waitlist").select("id,email,created_at").order("created_at", { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  const normalised = rows.map((row) => String(row.email ?? "").trim().toLowerCase());
  const unique = new Set(normalised.filter(Boolean));
  const invalid = [...unique].filter((email) => !validEmail(email));
  const eligible = [...unique].filter(validEmail);

  let registered = 0;
  let page = 1;
  const accountEmails = new Set<string>();
  while (true) {
    const users = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (users.error) throw users.error;
    for (const user of users.data.users) if (user.email) accountEmails.add(user.email.toLowerCase());
    if (users.data.users.length < 1000) break;
    page += 1;
  }
  registered = eligible.filter((email) => accountEmails.has(email)).length;

  process.stdout.write(JSON.stringify({
    storedRows: rows.length,
    eligibleRecipients: eligible.length,
    duplicateRows: Math.max(0, normalised.length - unique.size),
    invalidAddresses: invalid.length,
    alreadyRegistered: registered,
    notYetRegistered: Math.max(0, eligible.length - registered),
    maskedSample: eligible.slice(0, 5).map(maskEmail),
  }, null, 2));
}

void main();
