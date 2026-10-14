import { describe, expect, it } from "vitest";
import {
  canResumeSavedApplicationStep,
  continuationDestinationCandidates,
  submissionReceiptDestination,
} from "@/lib/application-continuation-destination";

describe("application continuation destinations", () => {
  it("does not let an old employer homepage override the specific approved vacancy", () => {
    const approvedJobUrl = "https://employer.example/job.asp?VID=8785";
    expect(canResumeSavedApplicationStep("https://employer.example/", approvedJobUrl)).toBe(false);
    expect(canResumeSavedApplicationStep("https://employer.example/account/sign-in", approvedJobUrl)).toBe(true);
    expect(canResumeSavedApplicationStep("https://employer.example/?application=8785", approvedJobUrl)).toBe(true);
    expect(continuationDestinationCandidates({
      savedSessionUrl: "https://employer.example/",
      receipt: { destination: approvedJobUrl },
      approvedJobUrl,
    })).toEqual([approvedJobUrl]);
  });
  it("prefers the saved employer step over the durable receipt and listing", () => {
    expect(
      continuationDestinationCandidates({
        savedSessionUrl: "https://employer.example/apply/step-3",
        receipt: { destination: "https://employer.example/apply/step-2" },
        approvedJobUrl: "https://jobs.example/listing/123",
      }),
    ).toEqual([
      "https://employer.example/apply/step-3",
      "https://employer.example/apply/step-2",
      "https://jobs.example/listing/123",
    ]);
  });

  it("keeps the receipt destination when the encrypted session is absent", () => {
    expect(
      continuationDestinationCandidates({
        receipt: { destination: "https://ats.example/application/continue" },
        approvedJobUrl: "https://board.example/job/123",
      }),
    ).toEqual([
      "https://ats.example/application/continue",
      "https://board.example/job/123",
    ]);
  });

  it("ignores malformed receipts and removes duplicate candidates", () => {
    expect(submissionReceiptDestination({ destination: 42 })).toBeNull();
    expect(
      continuationDestinationCandidates({
        savedSessionUrl: "https://jobs.example/job/123",
        receipt: { destination: "https://jobs.example/job/123" },
        approvedJobUrl: "https://jobs.example/job/123",
      }),
    ).toEqual(["https://jobs.example/job/123"]);
  });
});
