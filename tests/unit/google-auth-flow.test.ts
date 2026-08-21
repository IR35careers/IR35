import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Google authentication flow", () => {
  it("uses the Supabase redirect flow instead of the JavaScript-origin Google Identity widget", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/GoogleIdentityButton.tsx"), "utf8");
    expect(source).toContain("signInWithGoogleAdmin");
    expect(source).toContain('signInWithGoogle("/dashboard")');
    expect(source).not.toContain("accounts.google.com/gsi/client");
    expect(source).not.toContain("NEXT_PUBLIC_GOOGLE_CLIENT_ID");
  });
});
