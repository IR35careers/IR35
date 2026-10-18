import { z } from "zod";
import { ocidSchema } from "./provision-plan";

export const CAPACITY_INTERVAL_MS = 10 * 60 * 1000;
export const CAPACITY_WINDOW_MS = 2 * 60 * 60 * 1000;

const attemptSchema = z.strictObject({ number: z.number().int().min(1).max(12), ad: z.string().min(1).max(100), at: z.number().int().nonnegative() });
const journalSchema = z.strictObject({
  version: z.literal(1), planHash: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: z.number().int().nonnegative(), deadlineAt: z.number().int().nonnegative(),
  domains: z.array(z.string().regex(/^[A-Za-z0-9]{1,20}:UK-LONDON-1-AD-[1-3]$/)).min(1).max(3)
    .refine(value => new Set(value).size === value.length),
  attempts: z.array(attemptSchema).max(12),
  pending: attemptSchema.nullable(),
  nextAttemptAt: z.number().int().nonnegative(),
  outcome: z.enum(["ready", "pending", "capacity", "created", "halted"]),
  instanceId: ocidSchema("instance").refine(value => value.startsWith("ocid1.instance.oc1.uk-london-1.")).nullable(),
}).superRefine((value, ctx) => {
  if (value.deadlineAt !== value.startedAt + CAPACITY_WINDOW_MS || value.nextAttemptAt < value.startedAt
    || value.attempts.some((attempt, index) => attempt.number !== index + 1 || attempt.ad !== value.domains[index % value.domains.length]
      || attempt.at < value.startedAt || attempt.at >= value.deadlineAt
      || (index > 0 && attempt.at < value.attempts[index - 1].at + CAPACITY_INTERVAL_MS))
    || (value.pending !== null && JSON.stringify(value.pending) !== JSON.stringify(value.attempts.at(-1)))
    || ((value.outcome === "pending") !== (value.pending !== null))
    || ((value.outcome === "created") !== (value.instanceId !== null))
    || (value.outcome === "ready" && value.attempts.length !== 0)
    || (value.outcome !== "ready" && value.attempts.length === 0)
    || (value.outcome === "ready" && value.nextAttemptAt !== value.startedAt)
    || (value.attempts.length > 0 && value.nextAttemptAt !== value.attempts.at(-1)!.at + CAPACITY_INTERVAL_MS)) {
    ctx.addIssue({ code: "custom", message: "Inconsistent capacity journal" });
  }
});

export type CapacityJournal = z.infer<typeof journalSchema>;
export type CapacityDecision =
  | { action: "launch"; ad: string }
  | { action: "wait"; until: number }
  | { action: "reconcile"; attempt: CapacityJournal["attempts"][number] }
  | { action: "created"; instanceId: string }
  | { action: "stop"; reason: "capacity_window_exhausted" | "previous_error" };

function readJournal(input: unknown): CapacityJournal {
  const result = journalSchema.safeParse(input);
  if (!result.success) throw new Error("Invalid capacity journal; stop, inspect resources and do not reset the retry window.");
  return result.data;
}

export function newCapacityJournal(planHash: string, domains: string[], startedAt: number): CapacityJournal {
  return readJournal({ version: 1, planHash, domains, startedAt, deadlineAt: startedAt + CAPACITY_WINDOW_MS,
    nextAttemptAt: startedAt, attempts: [], pending: null, instanceId: null, outcome: "ready" });
}

export function capacityDecision(input: unknown, planHash: string, now: number): CapacityDecision {
  const journal = readJournal(input);
  if (planHash !== journal.planHash || !Number.isSafeInteger(now) || now < journal.startedAt
    || (journal.attempts.length > 0 && now < journal.attempts.at(-1)!.at)) throw new Error("Plan/clock changed; stop rather than retry.");
  if (journal.instanceId) return { action: "created", instanceId: journal.instanceId };
  // A network/CLI timeout or process crash is not a failed create. Never retry it blindly,
  // even after the two-hour deadline or an empty eventually-consistent list response.
  if (journal.pending) return { action: "reconcile", attempt: journal.pending };
  if (journal.outcome === "halted") return { action: "stop", reason: "previous_error" };
  if (now >= journal.deadlineAt || journal.attempts.length >= 12) return { action: "stop", reason: "capacity_window_exhausted" };
  if (now < journal.nextAttemptAt) return { action: "wait", until: journal.nextAttemptAt };
  return { action: "launch", ad: journal.domains[journal.attempts.length % journal.domains.length] };
}

export function beginCapacityAttempt(input: unknown, planHash: string, now: number): CapacityJournal {
  const journal = readJournal(input);
  const decision = capacityDecision(journal, planHash, now);
  if (decision.action !== "launch") throw new Error("Launch is not permitted by the capacity journal.");
  const attempt = { number: journal.attempts.length + 1, ad: decision.ad, at: now };
  return readJournal({ ...journal, attempts: [...journal.attempts, attempt], pending: attempt,
    outcome: "pending", nextAttemptAt: now + CAPACITY_INTERVAL_MS });
}

/** Only Oracle Compute's explicit capacity rejection permits another attempt. */
export function isOracleCapacityError(input: unknown): boolean {
  const parsed = z.object({ code: z.literal("InternalError"), status: z.literal(500), message: z.string().max(4096) }).safeParse(input);
  return parsed.success && /^Out of host capacity\.?$/i.test(parsed.data.message.trim());
}

export function recordCapacityResult(input: unknown, result: unknown): CapacityJournal {
  const journal = readJournal(input);
  if (!journal.pending) throw new Error("No pending launch to resolve.");
  const parsed = z.union([
    z.strictObject({ instanceId: ocidSchema("instance").refine(value => value.startsWith("ocid1.instance.oc1.uk-london-1.")) }),
    z.strictObject({ serviceError: z.unknown() }), z.strictObject({ unknown: z.literal(true) }),
  ]).safeParse(result);
  if (!parsed.success) throw new Error("Invalid launch result; retain the pending journal and reconcile before another launch.");
  if ("instanceId" in parsed.data) {
    return readJournal({ ...journal, pending: null, outcome: "created", instanceId: parsed.data.instanceId });
  }
  if ("unknown" in parsed.data) return journal;
  return readJournal({ ...journal, pending: null, outcome: isOracleCapacityError(parsed.data.serviceError) ? "capacity" : "halted" });
}

/**
 * Executes at most one port call. The future OCI adapter must hold an exclusive lock,
 * persist atomically outside Git, inspect resources/free eligibility before launch,
 * and schedule waits in <=30s cancellable observation slices. No OCI is called here.
 */
export async function runCapacityAttempt(input: unknown, planHash: string, now: number, ports: {
  persist: (journal: CapacityJournal) => Promise<void>;
  launch: (ad: string) => Promise<{ instanceId: string } | { serviceError: unknown } | { unknown: true }>;
}) {
  const decision = capacityDecision(input, planHash, now);
  if (decision.action !== "launch") return { decision, journal: readJournal(input) };
  const pending = beginCapacityAttempt(input, planHash, now);
  // Persist intent BEFORE the API call; a failed write must mean no launch at all.
  await ports.persist(pending);
  let result: Awaited<ReturnType<typeof ports.launch>>;
  try { result = await ports.launch(decision.ad); } catch { result = { unknown: true }; }
  const journal = recordCapacityResult(pending, result);
  await ports.persist(journal);
  return { decision, journal };
}
