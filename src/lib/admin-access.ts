import "server-only";

import { adminAllowlist } from "@/lib/admin-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const BOOTSTRAP_ADMIN_EMAIL = "ir35careers@gmail.com";

export type AdminRole = "owner" | "admin";
export type AdminStatus = "active" | "disabled";

type AdminMemberRow = {
  id: string;
  email: string;
  user_id: string | null;
  role: AdminRole;
  status: AdminStatus;
  invited_by_email: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminMembership = {
  id: string | null;
  email: string;
  userId: string | null;
  role: AdminRole;
  status: AdminStatus;
  invitedByEmail: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  managed: boolean;
  source: "registry" | "bootstrap";
};

const SELECT_COLUMNS = "id, email, user_id, role, status, invited_by_email, last_login_at, created_at, updated_at";

export function normalizeAdminEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validAdminEmail(value: unknown): boolean {
  const email = normalizeAdminEmail(value);
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && email.length <= 254;
}

function fallbackAdministrators(): Set<string> {
  return new Set([BOOTSTRAP_ADMIN_EMAIL, ...adminAllowlist()].map(normalizeAdminEmail).filter(Boolean));
}

function present(row: AdminMemberRow): AdminMembership {
  return {
    id: row.id,
    email: row.email,
    userId: row.user_id,
    role: row.email === BOOTSTRAP_ADMIN_EMAIL ? "owner" : row.role,
    status: row.email === BOOTSTRAP_ADMIN_EMAIL ? "active" : row.status,
    invitedByEmail: row.invited_by_email,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    managed: row.email !== BOOTSTRAP_ADMIN_EMAIL,
    source: "registry",
  };
}

function fallbackMembership(email: string): AdminMembership {
  return {
    id: null,
    email,
    userId: null,
    role: email === BOOTSTRAP_ADMIN_EMAIL ? "owner" : "admin",
    status: "active",
    invitedByEmail: null,
    lastLoginAt: null,
    createdAt: null,
    updatedAt: null,
    managed: false,
    source: "bootstrap",
  };
}

export async function authorizeAdministrator(value: unknown): Promise<AdminMembership | null> {
  const email = normalizeAdminEmail(value);
  if (!validAdminEmail(email)) return null;

  const result = await getSupabaseAdmin()
    .from("admin_members")
    .select(SELECT_COLUMNS)
    .eq("email", email)
    .maybeSingle();

  if (!result.error && result.data) {
    const membership = present(result.data as AdminMemberRow);
    return membership.status === "active" ? membership : null;
  }

  if (fallbackAdministrators().has(email)) return fallbackMembership(email);
  return null;
}

export async function listAdministratorMemberships(): Promise<AdminMembership[]> {
  const result = await getSupabaseAdmin()
    .from("admin_members")
    .select(SELECT_COLUMNS)
    .order("role", { ascending: false })
    .order("created_at", { ascending: true });

  const memberships = result.error
    ? []
    : (result.data ?? []).map((row) => present(row as AdminMemberRow));
  const presentEmails = new Set(memberships.map((membership) => membership.email));

  for (const email of fallbackAdministrators()) {
    if (!presentEmails.has(email)) memberships.push(fallbackMembership(email));
  }

  return memberships.sort((left, right) => {
    if (left.role !== right.role) return left.role === "owner" ? -1 : 1;
    if (left.status !== right.status) return left.status === "active" ? -1 : 1;
    return left.email.localeCompare(right.email);
  });
}

export async function touchAdministratorLogin(emailValue: unknown, userId: string): Promise<void> {
  const email = normalizeAdminEmail(emailValue);
  if (!validAdminEmail(email)) return;
  const now = new Date().toISOString();
  const client = getSupabaseAdmin();
  const updated = await client
    .from("admin_members")
    .update({ user_id: userId, last_login_at: now, updated_at: now })
    .eq("email", email);

  if (!updated.error && email === BOOTSTRAP_ADMIN_EMAIL) {
    await client.from("admin_members").upsert({
      email,
      user_id: userId,
      role: "owner",
      status: "active",
      invited_by_email: "system",
      last_login_at: now,
      updated_at: now,
    }, { onConflict: "email" });
  }
}

export async function addAdministrator(input: {
  email: string;
  role: AdminRole;
  invitedByEmail: string;
}): Promise<AdminMembership> {
  const email = normalizeAdminEmail(input.email);
  if (!validAdminEmail(email)) throw new Error("Enter a valid administrator email address.");
  const now = new Date().toISOString();
  const result = await getSupabaseAdmin()
    .from("admin_members")
    .upsert({
      email,
      role: email === BOOTSTRAP_ADMIN_EMAIL ? "owner" : input.role,
      status: "active",
      invited_by_email: normalizeAdminEmail(input.invitedByEmail),
      updated_at: now,
    }, { onConflict: "email" })
    .select(SELECT_COLUMNS)
    .single();
  if (result.error) throw result.error;
  return present(result.data as AdminMemberRow);
}

export async function updateAdministrator(input: {
  email: string;
  role: AdminRole;
  status: AdminStatus;
}): Promise<AdminMembership> {
  const email = normalizeAdminEmail(input.email);
  if (!validAdminEmail(email)) throw new Error("Choose a valid administrator.");
  if (email === BOOTSTRAP_ADMIN_EMAIL && (input.role !== "owner" || input.status !== "active")) {
    throw new Error("The primary owner account cannot be disabled or demoted.");
  }
  const result = await getSupabaseAdmin()
    .from("admin_members")
    .update({ role: input.role, status: input.status, updated_at: new Date().toISOString() })
    .eq("email", email)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("Administrator was not found.");
  return present(result.data as AdminMemberRow);
}

export async function removeAdministrator(emailValue: unknown): Promise<void> {
  const email = normalizeAdminEmail(emailValue);
  if (!validAdminEmail(email)) throw new Error("Choose a valid administrator.");
  if (email === BOOTSTRAP_ADMIN_EMAIL) throw new Error("The primary owner account cannot be removed.");
  const result = await getSupabaseAdmin().from("admin_members").delete().eq("email", email);
  if (result.error) throw result.error;
}
