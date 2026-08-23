import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applicationWorkerAppOrigin,
  applicationWorkerConfig,
  signApplicationWorkerBody,
  verifyApplicationWorkerBody,
} from "@/lib/application-worker-auth";

const original = {
  enabled: process.env.APPLICATION_WORKER_ENABLED,
  url: process.env.APPLICATION_WORKER_URL,
  secret: process.env.APPLICATION_WORKER_SECRET,
};

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("application worker authentication", () => {
  beforeEach(() => {
    process.env.APPLICATION_WORKER_ENABLED = "true";
    process.env.APPLICATION_WORKER_URL = "https://worker.ir35careers.com/";
    process.env.APPLICATION_WORKER_SECRET = "worker-test-secret-that-is-long-enough-123";
  });

  afterEach(() => {
    restoreEnvironment("APPLICATION_WORKER_ENABLED", original.enabled);
    restoreEnvironment("APPLICATION_WORKER_URL", original.url);
    restoreEnvironment("APPLICATION_WORKER_SECRET", original.secret);
  });

  it("accepts a current signed callback and rejects modified content", () => {
    const body = JSON.stringify({ taskId: "task-1", state: "submitted" });
    const signed = signApplicationWorkerBody(body, "1720000000000");
    expect(
      verifyApplicationWorkerBody({
        body,
        ...signed,
        now: 1720000000000,
      }),
    ).toBe(true);
    expect(
      verifyApplicationWorkerBody({
        body: `${body} `,
        ...signed,
        now: 1720000000000,
      }),
    ).toBe(false);
  });

  it("rejects expired callbacks", () => {
    const body = "{}";
    const signed = signApplicationWorkerBody(body, "1720000000000");
    expect(
      verifyApplicationWorkerBody({
        body,
        ...signed,
        now: 1720000400001,
      }),
    ).toBe(false);
  });

  it("enables only a secure configured worker", () => {
    expect(applicationWorkerConfig()).toEqual({
      enabled: true,
      url: "https://worker.ir35careers.com",
    });
    process.env.APPLICATION_WORKER_URL = "http://worker.internal";
    expect(applicationWorkerConfig()).toEqual({ enabled: false });
    delete process.env.APPLICATION_WORKER_URL;
    expect(applicationWorkerConfig()).toEqual({ enabled: true });
  });

  it("pins cloud worker calls to a secure origin", () => {
    expect(applicationWorkerAppOrigin()).toBe("https://www.ir35careers.com");
    expect(applicationWorkerAppOrigin("https://www.ir35careers.com/path"))
      .toBe("https://www.ir35careers.com");
    expect(() => applicationWorkerAppOrigin("http://localhost:3000"))
      .toThrow("must use HTTPS");
  });
});
