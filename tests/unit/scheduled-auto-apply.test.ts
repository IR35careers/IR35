import { describe, expect, it } from "vitest";
import { orderScheduledAccounts } from "@/lib/automation/scheduled-runner";

describe("scheduled Auto Apply", () => {
  it("puts accounts that have never run first", () => {
    const accounts = [
      { userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
      { userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    ];
    const ordered = orderScheduledAccounts(
      accounts,
      new Map([[accounts[1].userId, "2026-08-24T07:15:00.000Z"]]),
    );
    expect(ordered.map((account) => account.userId)).toEqual([
      accounts[0].userId,
      accounts[1].userId,
    ]);
  });

  it("rotates accounts from the oldest completed run", () => {
    const accounts = [
      { userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      { userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
      { userId: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
    ];
    const ordered = orderScheduledAccounts(
      accounts,
      new Map([
        [accounts[0].userId, "2026-08-25T07:15:00.000Z"],
        [accounts[1].userId, "2026-08-23T07:15:00.000Z"],
        [accounts[2].userId, "2026-08-24T07:15:00.000Z"],
      ]),
    );
    expect(ordered.map((account) => account.userId)).toEqual([
      accounts[1].userId,
      accounts[2].userId,
      accounts[0].userId,
    ]);
  });
});
