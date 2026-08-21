import { FACT_KEYS, type FactKey, type FieldMapping, type RunnerField } from "@/lib/application-runner/types";
import { openRouterTailoringConfig } from "@/lib/ai/openrouter-tailoring";

interface MappingResponse {
  mappings?: Array<{ field_id?: unknown; fact_key?: unknown }>;
  error?: { message?: string };
  choices?: Array<{ message?: { content?: string } }>;
}

function extractJson(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return (fenced ?? value).trim();
}

/**
 * OpenRouter sees only field labels and the names of allowed saved facts. It
 * never receives the applicant's values, CV or direct identifiers here.
 */
export async function mapUnknownFields(fields: RunnerField[]): Promise<FieldMapping[]> {
  const config = openRouterTailoringConfig();
  if (!config || fields.length === 0) return [];
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      "http-referer": "https://www.ir35careers.com",
      "x-title": "IR35Careers Application Runner",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 1_200,
      provider: { zdr: true, data_collection: "deny" },
      messages: [
        {
          role: "system",
          content: `Map employer form fields to one saved fact key. Return JSON only: {"mappings":[{"field_id":"...","fact_key":"..."}]}. Allowed fact keys: ${FACT_KEYS.join(", ")}, needs_user, skip. Use needs_user for legal, demographic, identity, salary, consent, ambiguous or employer-specific questions. Use skip only for optional fields with no safe mapping. Never invent an answer.`,
        },
        {
          role: "user",
          content: JSON.stringify(fields.map((field) => ({ field_id: field.id, label: field.label, name: field.name, type: field.type, required: field.required, options: field.options.slice(0, 30) }))),
        },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json().catch(() => null)) as MappingResponse | null;
  if (!response.ok || !payload) return [];
  const content = payload.choices?.[0]?.message?.content ?? "";
  let parsed: { mappings?: Array<{ field_id?: unknown; fact_key?: unknown }> };
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    return [];
  }
  const allowed = new Set<string>([...FACT_KEYS, "needs_user", "skip"]);
  const fieldIds = new Set(fields.map((field) => field.id));
  return (parsed.mappings ?? []).flatMap((item) => {
    const fieldId = String(item.field_id ?? "");
    const factKey = String(item.fact_key ?? "");
    return fieldIds.has(fieldId) && allowed.has(factKey)
      ? [{ fieldId, factKey: factKey as FactKey | "needs_user" | "skip" }]
      : [];
  });
}
