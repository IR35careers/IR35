import { CONTACT_EMAIL } from "@/lib/contact";

// Routing only: the server still checks verified identity and admin membership.
const ADMINISTRATOR_EMAILS = new Set(["ir35careers@gmail.com", CONTACT_EMAIL]);

export const ADMIN_PORTAL_ORIGIN = "https://admin.ir35careers.com";

export function isAdministratorEmail(email: string | null | undefined): boolean {
  return ADMINISTRATOR_EMAILS.has(email?.trim().toLowerCase() ?? "");
}

export function authenticatedDestination(
  email: string | null | undefined,
  contractorDestination = "/dashboard"
): string {
  return isAdministratorEmail(email) ? `${ADMIN_PORTAL_ORIGIN}/` : contractorDestination;
}
