export const APPLICATION_EMAIL_ACTIONS = [
  "verification_code",
  "verification_link",
  "account_recovery_email",
] as const;

export type ApplicationEmailAction = (typeof APPLICATION_EMAIL_ACTIONS)[number];

export function isApplicationEmailAction(
  action: string | null | undefined,
): action is ApplicationEmailAction {
  return APPLICATION_EMAIL_ACTIONS.includes(action as ApplicationEmailAction);
}

export function isApplicationEmailLinkAction(
  action: string | null | undefined,
): action is Exclude<ApplicationEmailAction, "verification_code"> {
  return action === "verification_link" || action === "account_recovery_email";
}

