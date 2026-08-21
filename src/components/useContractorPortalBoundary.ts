"use client";

import { useEffect } from "react";
import { ADMIN_PORTAL_ORIGIN, isAdministratorEmail } from "@/lib/portal-access";

/** Keep the administrator identity out of contractor-only workspace routes. */
export function useContractorPortalBoundary(email: string | null | undefined, loading: boolean): boolean {
  const redirecting = !loading && isAdministratorEmail(email);

  useEffect(() => {
    if (redirecting) window.location.replace(`${ADMIN_PORTAL_ORIGIN}/`);
  }, [redirecting]);

  return redirecting;
}
