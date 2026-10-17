export interface LaunchAudienceRow {
  id: string;
  email: string;
  created_at: string;
  launch_notified_at?: string | null;
  launch_email_id?: string | null;
  launch_email_attempts?: number | null;
  launch_last_error?: string | null;
}

export interface LaunchAudiencePlan {
  recipients: LaunchAudienceRow[];
  duplicateRows: LaunchAudienceRow[];
  invalidRows: LaunchAudienceRow[];
  alreadyNotifiedRows: LaunchAudienceRow[];
  corrections: Array<{ id: string; from: string; to: string }>;
}

const ADDRESS_CORRECTIONS = new Map([
  ["chris@brittan.co", "chris@brittan.com"],
]);

export function normaliseLaunchEmail(value: string): string {
  const email = String(value ?? "").trim().toLowerCase();
  return ADDRESS_CORRECTIONS.get(email) ?? email;
}

function validLaunchEmail(value: string): boolean {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) return false;
  return !value.endsWith("@example.com");
}

export function planLaunchAudience(
  rows: LaunchAudienceRow[],
  registeredEmails: Iterable<string>
): LaunchAudiencePlan {
  const registered = new Set(Array.from(registeredEmails, normaliseLaunchEmail));
  const seen = new Set<string>();
  const plan: LaunchAudiencePlan = {
    recipients: [],
    duplicateRows: [],
    invalidRows: [],
    alreadyNotifiedRows: [],
    corrections: [],
  };

  for (const original of rows) {
    const sourceEmail = String(original.email ?? "").trim().toLowerCase();
    const email = normaliseLaunchEmail(sourceEmail);
    const row = { ...original, email };
    if (sourceEmail !== email) plan.corrections.push({ id: row.id, from: sourceEmail, to: email });

    if (!validLaunchEmail(email)) {
      plan.invalidRows.push(row);
    } else if (registered.has(email) || seen.has(email)) {
      plan.duplicateRows.push(row);
    } else if (row.launch_notified_at) {
      plan.alreadyNotifiedRows.push(row);
      seen.add(email);
    } else {
      plan.recipients.push(row);
      seen.add(email);
    }
  }

  return plan;
}
