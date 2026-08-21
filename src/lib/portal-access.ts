const ADMINISTRATOR_EMAIL = "ir35careers@gmail.com";

export const ADMIN_PORTAL_ORIGIN = "https://admin.ir35careers.com";

export function isAdministratorEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === ADMINISTRATOR_EMAIL;
}

export function authenticatedDestination(
  email: string | null | undefined,
  contractorDestination = "/dashboard"
): string {
  return isAdministratorEmail(email) ? `${ADMIN_PORTAL_ORIGIN}/` : contractorDestination;
}
