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
});
