import { describe, expect, it } from "vitest";
import {
  continuationDestinationCandidates,
  submissionReceiptDestination,
} from "@/lib/application-continuation-destination";

describe("application continuation destinations", () => {
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
