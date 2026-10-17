import { describe, expect, it } from "vitest";
import { fetchAdzuna } from "@/lib/aggregators/adzuna-fetcher";
import { fetchReed } from "@/lib/aggregators/reed-fetcher";
import { HttpClient } from "@/lib/ats/http-client";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("IR35 source partitions", () => {
  it("combines Reed general, Inside IR35 and Outside IR35 searches without duplicates", async () => {
    const urls: string[] = [];
    const client = new HttpClient({
      minDelayMs: 0,
      maxRetries: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        const keywords = new URL(url).searchParams.get("keywords");
        const jobId = keywords === "inside IR35" ? 2 : keywords === "outside IR35" ? 3 : 1;
        return response({ results: [{ jobId, jobTitle: "Contract Engineer", jobUrl: `https://reed.example/${jobId}` }] });
      },
    });

    const jobs = await fetchReed(client, {
      apiKey: "test-key",
      pages: 1,
      keywordQueries: ["inside IR35", "outside IR35"],
    });

    expect(jobs.map((job) => job.sourceIdentifier)).toEqual(["1", "2", "3"]);
    expect(urls.map((url) => new URL(url).searchParams.get("keywords"))).toEqual([
      null,
      "inside IR35",
      "outside IR35",
    ]);
    expect(urls.every((url) => new URL(url).searchParams.get("contract") === "true")).toBe(true);
  });

  it("combines Adzuna newest-first general and explicit IR35 searches", async () => {
    const urls: string[] = [];
    const client = new HttpClient({
      minDelayMs: 0,
      maxRetries: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        const keywords = new URL(url).searchParams.get("what");
        const id = keywords === "inside IR35" ? 2 : keywords === "outside IR35" ? 3 : 1;
        return response({ results: [{ id, title: "Contract Engineer", redirect_url: `https://adzuna.example/${id}` }] });
      },
    });

    const jobs = await fetchAdzuna(client, {
      appId: "test-id",
      appKey: "test-key",
      pages: 1,
      keywordQueries: ["inside IR35", "outside IR35"],
    });

    expect(jobs.map((job) => job.sourceIdentifier)).toEqual(["1", "2", "3"]);
    expect(urls.map((url) => new URL(url).searchParams.get("what"))).toEqual([
      null,
      "inside IR35",
      "outside IR35",
    ]);
    expect(urls.every((url) => new URL(url).searchParams.get("contract") === "1")).toBe(true);
    expect(urls.every((url) => new URL(url).searchParams.get("sort_by") === "date")).toBe(true);
  });

  it("reaches later profession pages and retains successful Reed partitions after a search failure", async () => {
    const errors: string[] = [];
    const client = new HttpClient({ minDelayMs: 0, maxRetries: 0, fetchImpl: async (input) => {
      const params = new URL(String(input)).searchParams;
      const query = params.get("keywords");
      const skip = Number(params.get("resultsToSkip"));
      if (query === "finance") return new Response("unavailable", { status: 503 });
      const count = query === "DevOps" && skip === 0 ? 100 : 1;
      return response({ results: Array.from({ length: count }, (_, index) => ({
        jobId: query ? 1000 + skip + index : 1,
        jobTitle: "Contract DevOps Engineer",
        jobUrl: `https://www.reed.co.uk/jobs/${query ? 1000 + skip + index : 1}`,
      })) });
    } });
    const jobs = await fetchReed(client, { apiKey: "test", pages: 1, keywordPages: 2,
      keywordQueries: ["DevOps", "finance"], onPageError: (query, page, message) => errors.push(`${query}:${page}:${message}`) });
    expect(jobs).toHaveLength(102);
    expect(jobs.some((job) => job.sourceIdentifier === "1100")).toBe(true);
    expect(errors).toEqual(["finance:1:HTTP 503"]);
  });

  it("keeps Adzuna successes after a failed partition without exposing its credentials", async () => {
    const errors: string[] = [];
    const urls: URL[] = [];
    const client = new HttpClient({ minDelayMs: 0, maxRetries: 0, fetchImpl: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.searchParams.get("what") === "finance") return new Response("unavailable", { status: 503 });
      return response({ results: [{ id: url.searchParams.get("what") || "general", title: "Contract Engineer", redirect_url: "https://example.org/apply" }] });
    } });
    const jobs = await fetchAdzuna(client, { appId: "id", appKey: "super-secret", pages: 1,
      maxDaysOld: 30, keywordQueries: ["finance", "engineering"], onPageError: (query, page, message) => errors.push(`${query}:${page}:${message}`) });
    expect(jobs.map((job) => job.sourceIdentifier)).toEqual(["general", "engineering"]);
    expect(errors).toEqual(["finance:1:HTTP 503"]);
    expect(errors.join(" ")).not.toContain("super-secret");
    expect(urls.every((url) => url.searchParams.get("max_days_old") === "30")).toBe(true);
  });

  it("does not start either provider when the source deadline has already passed", async () => {
    let requests = 0;
    const client = new HttpClient({ minDelayMs: 0, maxRetries: 0, fetchImpl: async () => { requests++; return response({ results: [] }); } });
    expect(await fetchReed(client, { apiKey: "test", deadlineMs: Date.now() - 1 })).toEqual([]);
    expect(await fetchAdzuna(client, { appId: "id", appKey: "test", deadlineMs: Date.now() - 1 })).toEqual([]);
    expect(requests).toBe(0);
  });
});
