#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const DEFAULT_BASE_URL = "https://www.ir35careers.com";
const REQUEST_TIMEOUT_MS = 12_000;

function resolveBaseUrl() {
  const candidate = process.env.IR35CAREERS_API_BASE || DEFAULT_BASE_URL;
  const url = new URL(candidate);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("IR35CAREERS_API_BASE must use HTTPS (HTTP is allowed only for localhost). ");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

const BASE_URL = resolveBaseUrl();

async function requestJson(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, BASE_URL), {
      ...init,
      headers: { Accept: "application/json", ...(init?.headers || {}) },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof body?.error === "string" ? body.error : `Request failed (${response.status})`;
      throw new Error(message);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function asToolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function asToolError(error) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: error instanceof Error ? error.message : "IR35Careers request failed",
    }],
  };
}

function createServer() {
  const server = new McpServer(
    { name: "ir35careers", version: "1.0.0" },
    {
      instructions:
        "Use these read-only tools to discover active UK contract roles. Preserve each role's advertised IR35 status and evidence. Treat unknown/TBC as unknown, never as Outside IR35. This server cannot save data, message recruiters or submit applications.",
    }
  );

  server.registerTool(
    "search_contracts",
    {
      title: "Search UK contracts",
      description: "Search active IR35Careers listings by role, location, advertised IR35 status, workplace and minimum day rate.",
      inputSchema: z.object({
        query: z.string().trim().max(100).optional().describe("Role, skill, company or description text"),
        location: z.string().trim().max(60).optional().describe("UK town, city or region"),
        ir35: z.enum(["outside", "inside", "tbc"]).optional().describe("Advertised IR35 status"),
        workplace: z.enum(["remote", "hybrid", "onsite"]).optional(),
        minimum_day_rate: z.number().int().min(0).max(10_000).optional(),
        skills: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
        posted_within_days: z.number().int().min(1).max(60).optional(),
        sort: z.enum(["recent", "rate_high", "rate_low"]).default("recent"),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const params = new URLSearchParams({ per_page: String(input.limit), sort: input.sort });
        if (input.query) params.set("q", input.query);
        if (input.location) params.set("location", input.location);
        if (input.ir35) params.set("ir35", input.ir35);
        if (input.workplace) params.set("remote", input.workplace);
        if (input.minimum_day_rate !== undefined) params.set("min_rate", String(input.minimum_day_rate));
        if (input.skills?.length) params.set("skills", input.skills.join(","));
        if (input.posted_within_days) params.set("within_days", String(input.posted_within_days));
        const data = await requestJson(`/api/jobs/search?${params}`);
        return asToolResult({
          total: data.total,
          data_source: data.data_source,
          generated_at: data.generated_at,
          contracts: (data.jobs || []).map((job) => ({
            ...job,
            listing_url: `${BASE_URL.origin}/jobs/${job.id}`,
          })),
        });
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    "get_contract",
    {
      title: "Get contract details",
      description: "Load the current public detail for one active IR35Careers contract identifier.",
      inputSchema: z.object({ id: z.uuid().describe("Contract UUID returned by search_contracts") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        const data = await requestJson(`/api/jobs/${encodeURIComponent(id)}`);
        return asToolResult({
          ...data,
          job: {
            ...data.job,
            description: String(data.job?.description || "").slice(0, 8_000),
          },
        });
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    "analyse_public_job_url",
    {
      title: "Analyse a public job URL",
      description: "Extract role facts from a user-supplied public HTTPS job page through IR35Careers' SSRF-protected preview service. It does not submit or save anything.",
      inputSchema: z.object({ url: z.url().max(2_048).describe("Public HTTPS job-listing URL") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      try {
        const data = await requestJson("/api/jobs/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        return asToolResult(data);
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    "explain_ir35_evidence",
    {
      title: "Explain IR35 evidence labels",
      description: "Explain how IR35Careers represents an advertised status and the limits of that evidence.",
      inputSchema: z.object({ status: z.enum(["outside", "inside", "tbc"]) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ status }) => asToolResult({
      status,
      advertised_label: status === "outside" ? "Outside IR35" : status === "inside" ? "Inside IR35" : "IR35 TBC",
      meaning:
        status === "tbc"
          ? "The source listing did not provide an explicit status that IR35Careers could verify."
          : `The source listing explicitly advertised the engagement as ${status === "outside" ? "Outside" : "Inside"} IR35.`,
      limitation: "An advert label is not a substitute for the client's status determination statement, contract review or actual working practices.",
      advice_boundary: "Educational information only; seek qualified professional advice for the engagement.",
    })
  );

  return server;
}

async function selfTest() {
  const data = await requestJson("/api/jobs/search?per_page=1");
  if (!Array.isArray(data.jobs) || typeof data.total !== "number") {
    throw new Error("Unexpected public search response");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, base_url: BASE_URL.origin, active_contracts: data.total })}\n`);
}

if (process.argv.includes("--self-test")) {
  selfTest().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
} else {
  void serveStdio(createServer);
  console.error("IR35Careers MCP server running on stdio (read-only)");
}
