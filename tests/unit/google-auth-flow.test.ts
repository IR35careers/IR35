import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Google authentication flow", () => {
  it("uses GIS with a hashed, single-use nonce and an explicit flagged redirect fallback", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/GoogleIdentityButton.tsx"), "utf8");
    expect(source).toContain("signInWithGoogleAdmin");
    expect(source).toContain("signInWithGoogle(destination, selectAccount)");
    expect(source).toContain("https://accounts.google.com/gsi/client");
    expect(source).toContain("nonce: value.hashedNonce");
    expect(source).toContain("value.exchange(response, signInWithGoogleIdToken)");
    expect(source).toContain("fallbackEnabled &&");
    expect(source).toContain("use_fedcm_for_button: true");
    expect(source).not.toContain(".prompt(");
  });
});
