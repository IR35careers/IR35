import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createOracleProvisionPlan, findOwnedOracleResource, oracleCreateCommand, ORACLE_TARGET,
  type ResourceIds, type ResourceName,
} from "../../infra/oracle/provision-plan";
import {
  beginCapacityAttempt, capacityDecision, CAPACITY_INTERVAL_MS, CAPACITY_WINDOW_MS, isOracleCapacityError,
  newCapacityJournal, recordCapacityResult, runCapacityAttempt,
} from "../../infra/oracle/capacity-retry";
import { main } from "../../infra/oracle/plan";

const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32);
const deployPublicKey = `ssh-ed25519 ${Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25519"), Buffer.from([0, 0, 0, 32]), key]).toString("base64")} mock-plan`;
const id = (kind: string) => `ocid1.${kind}.oc1.uk-london-1.controlledfixture01`;
const input = {
  version: 1 as const, deploymentId: "11111111-1111-4111-8111-111111111111", tenancyId: "ocid1.tenancy.oc1..controlledfixture01",
  compartmentId: "ocid1.compartment.oc1..controlledfixture01", region: "uk-london-1" as const,
  imageId: id("image"), availabilityDomains: ["TEST:UK-LONDON-1-AD-1", "TEST:UK-LONDON-1-AD-2", "TEST:UK-LONDON-1-AD-3"],
  deployPublicKey, sshCidr: "8.8.8.8/32",
};
const plan = createOracleProvisionPlan(input);
const ids: ResourceIds = { vcn: id("vcn"), gateway: id("internetgateway"), routes: id("routetable"), security: id("securitylist"), subnet: id("subnet") };
const option = (args: string[], key: string) => args[args.indexOf(key) + 1];
const startedAt = 1_000_000;
const journal = () => newCapacityJournal(plan.hash, input.availabilityDomains, startedAt);
const capacityError = { code: "InternalError", status: 500, message: "Out of host capacity." };

describe("Oracle fixed offline provisioning plan", () => {
  it("is deterministic, carries explicit live gates and never claims eligibility or execution", () => {
    expect(createOracleProvisionPlan(input)).toEqual(plan);
    expect(plan.mode).toBe("offline-plan-only");
    expect(plan.target).toEqual(ORACLE_TARGET);
    expect(plan.target).toMatchObject({ shape: "VM.Standard.A1.Flex", ocpus: 2, memoryInGBs: 12, bootVolumeSizeInGBs: 50 });
    expect(plan.prerequisites.join(" ")).toContain("trial credit is not evidence");
    expect(plan.prerequisites.join(" ")).toContain("all compartments/ADs");
    expect(plan.prerequisites.join(" ")).toContain("official Canonical Ubuntu 24.04 ARM/A1-compatible");
    expect(plan.cloudInit).not.toContain("PG_BOSS_DATABASE_URL");
    expect(plan.cloudInit).not.toContain("APPLICATION_WORKER_ACCEPT_JOBS=true");
  });
  it.each([
    { region: "eu-frankfurt-1" }, { shape: "VM.Standard.E5.Flex" }, { ocpus: 4 }, { memoryInGBs: 24 },
    { bootVolumeSizeInGBs: 200 }, { applicationWorkerAcceptJobs: true }, { apiPrivateKey: "not-allowed" },
    { availabilityDomains: [] }, { availabilityDomains: ["TEST:UK-LONDON-1-AD-1", "TEST:UK-LONDON-1-AD-1"] },
    { availabilityDomains: ["TEST:EU-FRANKFURT-1-AD-1"] }, { tenancyId: "--debug" },
  ])("rejects scope/shape/input override %j", change => {
    expect(() => createOracleProvisionPlan({ ...input, ...change })).toThrow("Invalid Oracle plan input");
  });
  it("rejects non-London image, broad ingress, private/injected key and bootstrap drift", () => {
    expect(() => createOracleProvisionPlan({ ...input, imageId: "ocid1.image.oc1.eu-frankfurt-1.controlledfixture01" })).toThrow("London");
    expect(() => createOracleProvisionPlan({ ...input, sshCidr: "0.0.0.0/0" })).toThrow("public IPv4 /32");
    expect(() => createOracleProvisionPlan({ ...input, deployPublicKey: "not a public key" })).toThrow("Ed25519");
    expect(() => oracleCreateCommand({ ...plan, config: { ...plan.config, sshCidr: "1.1.1.1/32" } }, "vcn")).toThrow("Plan changed");
    expect(createOracleProvisionPlan({ ...input, sshCidr: "1.1.1.1/32" }).hash).not.toBe(plan.hash);
  });
  it("builds ordered OCI create arguments with no shell, paid fallback, SDK retry, or flag changes", () => {
    for (const resource of ["vcn", "gateway", "routes", "security", "subnet", "instance"] satisfies ResourceName[]) {
      const command = oracleCreateCommand(plan, resource, ids, input.availabilityDomains[0]);
      expect(option(command.args, "--region")).toBe("uk-london-1");
      expect(option(command.args, "--compartment-id")).toBe(input.compartmentId);
      expect(command.args).toContain("--no-retry");
      expect(command.args).not.toContain("--debug"); expect(command.args).not.toContain("--wait-for-state");
      expect(command.args.join(" ")).not.toContain("APPLY_RUNNER");
      expect(JSON.parse(option(command.args, "--freeform-tags"))).toEqual({ managedBy: "ir35careers", ir35Deployment: input.deploymentId, ir35Plan: plan.hash });
    }
    const vcn = oracleCreateCommand(plan, "vcn").args;
    expect(option(vcn, "--is-ipv6-enabled")).toBe("false");
    expect(JSON.parse(option(vcn, "--cidr-blocks"))).toEqual(["10.35.0.0/16"]);
    expect(option(vcn, "--dns-label")).toBe("ir35worker");
    const subnet = oracleCreateCommand(plan, "subnet", ids).args;
    expect(JSON.parse(option(subnet, "--security-list-ids"))).toEqual([ids.security]);
    expect(option(subnet, "--route-table-id")).toBe(ids.routes);
    expect(option(subnet, "--dns-label")).toBe("worker");
    expect(subnet).not.toContain("--availability-domain"); // Regional subnet works across all returned ADs.
    const routes = JSON.parse(option(oracleCreateCommand(plan, "routes", ids).args, "--route-rules"));
    expect(routes).toEqual([{ destination: "0.0.0.0/0", destinationType: "CIDR_BLOCK", networkEntityId: ids.gateway }]);
  });
  it("permits only TCP22 from the one owner IPv4 /32, with no broad/default/IPv6 ingress", () => {
    const security = oracleCreateCommand(plan, "security", ids).args;
    expect(JSON.parse(option(security, "--ingress-security-rules"))).toEqual([{
      source: input.sshCidr, sourceType: "CIDR_BLOCK", protocol: "6", isStateless: false,
      tcpOptions: { destinationPortRange: { min: 22, max: 22 } },
    }]);
    expect(JSON.parse(option(security, "--egress-security-rules"))).toEqual([
      { destination: "0.0.0.0/0", destinationType: "CIDR_BLOCK", protocol: "all", isStateless: false },
    ]);
  });
  it("requires real dependency IDs and an inspected AD before constructing the locked ARM launch", () => {
    expect(() => oracleCreateCommand(plan, "subnet")).toThrow("verified vcn resource ID");
    expect(() => oracleCreateCommand(plan, "instance", ids, "elsewhere")).toThrow("inspected London");
    expect(() => oracleCreateCommand(plan, "instance", { ...ids, subnet: "--help" }, input.availabilityDomains[0])).toThrow("verified subnet");
    const args = oracleCreateCommand(plan, "instance", ids, input.availabilityDomains[0]).args;
    expect(option(args, "--shape")).toBe("VM.Standard.A1.Flex");
    expect(JSON.parse(option(args, "--shape-config"))).toEqual({ ocpus: 2, memoryInGBs: 12 });
    expect(option(args, "--boot-volume-size-in-gbs")).toBe("50");
    expect(option(args, "--assign-ipv6-ip")).toBe("false");
    expect(args).not.toContain("--source-details"); expect(args).not.toContain("--fault-domain");
    expect(JSON.parse(option(args, "--instance-options"))).toEqual({ areLegacyImdsEndpointsDisabled: true });
    const metadata = JSON.parse(option(args, "--metadata"));
    expect(Buffer.byteLength(JSON.stringify(metadata))).toBeLessThan(32_000);
    expect(metadata.ssh_authorized_keys).toBe(deployPublicKey);
    expect(Buffer.from(metadata.user_data, "base64").toString()).toBe(plan.cloudInit);
  });
  it("reuses only one exact owned resource; name, compartment, tag drift and duplicates stop", () => {
    const observed = { id: ids.vcn, "display-name": "ir35-worker-vcn", "compartment-id": input.compartmentId,
      "lifecycle-state": "AVAILABLE", "freeform-tags": { managedBy: "ir35careers", ir35Deployment: input.deploymentId, ir35Plan: plan.hash } };
    expect(findOwnedOracleResource(plan, "vcn", [observed])).toEqual(observed);
    expect(findOwnedOracleResource(plan, "vcn", [])).toBeUndefined();
    for (const rows of [[observed, observed], [{ ...observed, "freeform-tags": {} }],
      [{ ...observed, "compartment-id": id("compartment") }], [{ ...observed, "freeform-tags": { ...observed["freeform-tags"], ir35Plan: "changed" } }]]) {
      expect(() => findOwnedOracleResource(plan, "vcn", rows)).toThrow("collision/drift");
    }
    expect(() => findOwnedOracleResource(plan, "vcn", [{ id: "incomplete" }])).toThrow("ownership is unproven");
    expect(findOwnedOracleResource(plan, "vcn", [{ ...observed, "lifecycle-state": "DELETED" }])).toBeUndefined();
  });
  it("does not offer an apply/execute CLI mode", () => {
    expect(() => main(["--apply"])).toThrow("Offline only");
    expect(() => main(["--config", "--debug"])).toThrow("Offline only");
  });
  it("prints only the offline summary for an actual small public config, never the key/OCIDs", () => {
    const directory = mkdtempSync(join(tmpdir(), "ir35-oracle-plan-"));
    const path = join(directory, "public-config.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeFileSync(path, JSON.stringify(input), { mode: 0o600, flag: "wx" });
      main(["--config", path]);
      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls[0][0] as string;
      expect(JSON.parse(output)).toMatchObject({ mode: "offline-plan-only", hash: plan.hash,
        flags: { APPLY_RUNNER: "vercel", APPLICATION_WORKER_ACCEPT_JOBS: false }, network: { publicHealth: false } });
      expect(output).not.toContain(deployPublicKey); expect(output).not.toContain("ocid1.");
    } finally { log.mockRestore(); unlinkSync(path); rmdirSync(directory); }
  });
  it("rejects oversized or secret-shaped config without printing its contents", () => {
    const directory = mkdtempSync(join(tmpdir(), "ir35-oracle-plan-"));
    const path = join(directory, "invalid-config.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeFileSync(path, "x".repeat(16385), { mode: 0o600, flag: "wx" });
      expect(() => main(["--config", path])).toThrow("small regular file");
      writeFileSync(path, JSON.stringify({ ...input, secret: "controlled-never-print" }));
      expect(() => main(["--config", path])).toThrow("Invalid Oracle plan input");
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); unlinkSync(path); rmdirSync(directory); }
  });
});

describe("Oracle bounded capacity retry and unknown-outcome safety", () => {
  it("rotates ADs at ten-minute intervals, stops at two hours and does not reset on restart", () => {
    let current = journal();
    const domains: string[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const time = startedAt + attempt * CAPACITY_INTERVAL_MS;
      const decision = capacityDecision(JSON.parse(JSON.stringify(current)), plan.hash, time);
      expect(decision.action).toBe("launch");
      if (decision.action === "launch") domains.push(decision.ad);
      current = recordCapacityResult(beginCapacityAttempt(current, plan.hash, time), { serviceError: capacityError });
      if (attempt < 11) expect(capacityDecision(current, plan.hash, time + 1)).toEqual({ action: "wait", until: time + CAPACITY_INTERVAL_MS });
    }
    expect(domains).toEqual([...input.availabilityDomains, ...input.availabilityDomains, ...input.availabilityDomains, ...input.availabilityDomains]);
    expect(capacityDecision(current, plan.hash, startedAt + CAPACITY_WINDOW_MS)).toEqual({ action: "stop", reason: "capacity_window_exhausted" });
    expect(current.deadlineAt).toBe(startedAt + CAPACITY_WINDOW_MS);
    expect(() => beginCapacityAttempt(current, plan.hash, startedAt + CAPACITY_WINDOW_MS + 1)).toThrow("not permitted");
  });
  it.each([
    { code: "LimitExceeded", status: 400, message: "Limit exceeded" },
    { code: "InternalError", status: 500, message: "Unexpected server failure" },
    { code: "NotAuthenticated", status: 401, message: "Out of host capacity" },
    { code: "InternalError", status: 503, message: "Out of host capacity" },
    { code: "InternalError", status: 500, message: "Something else; Out of host capacity" },
    { code: "InternalError", status: 500, message: "Out of host capacity is not the cause" },
  ])("does not retry unrelated/ambiguous errors %j", serviceError => {
    // Match only the documented sentence, not negation or an embedded substring.
    expect(isOracleCapacityError(serviceError)).toBe(false);
    const halted = recordCapacityResult(beginCapacityAttempt(journal(), plan.hash, startedAt), { serviceError });
    expect(capacityDecision(halted, plan.hash, startedAt + CAPACITY_INTERVAL_MS)).toEqual({ action: "stop", reason: "previous_error" });
  });
  it("never retries an unknown network/CLI/process outcome, even after deadline", () => {
    const pending = beginCapacityAttempt(journal(), plan.hash, startedAt);
    expect(recordCapacityResult(pending, { unknown: true })).toEqual(pending);
    for (const now of [startedAt + 1, startedAt + CAPACITY_WINDOW_MS, startedAt + 86_400_000]) {
      expect(capacityDecision(JSON.parse(JSON.stringify(pending)), plan.hash, now)).toEqual({ action: "reconcile", attempt: pending.pending });
      expect(() => beginCapacityAttempt(pending, plan.hash, now)).toThrow("not permitted");
    }
    // There is deliberately no "empty list means reset" or timeout-to-capacity API.
    const found = recordCapacityResult(pending, { instanceId: id("instance") });
    expect(capacityDecision(found, plan.hash, startedAt + CAPACITY_WINDOW_MS)).toEqual({ action: "created", instanceId: id("instance") });
  });
  it("rejects tampered journals, changed plans, duplicate domains and backwards clocks", () => {
    const pending = beginCapacityAttempt(journal(), plan.hash, startedAt);
    expect(() => capacityDecision(journal(), "a".repeat(64), startedAt)).toThrow("Plan/clock");
    expect(() => capacityDecision(journal(), plan.hash, startedAt - 1)).toThrow("Plan/clock");
    expect(() => capacityDecision({ ...pending, pending: null }, plan.hash, startedAt)).toThrow("Invalid capacity journal");
    expect(() => capacityDecision({ ...journal(), deadlineAt: startedAt + 86_400_000 }, plan.hash, startedAt)).toThrow("Invalid capacity journal");
    expect(() => capacityDecision({ ...journal(), domains: [input.availabilityDomains[0], input.availabilityDomains[0]] }, plan.hash, startedAt)).toThrow("Invalid capacity journal");
    expect(() => recordCapacityResult(journal(), { instanceId: id("instance") })).toThrow("No pending launch");
    expect(() => recordCapacityResult(pending, { instanceId: "unverified" })).toThrow("Invalid launch result");
    expect(() => recordCapacityResult(pending, { instanceId: "ocid1.instance.oc1.eu-frankfurt-1.controlledfixture01" })).toThrow("Invalid launch result");
    for (const malformed of [null, [], {}, { unknown: false }, { instanceId: id("instance"), unknown: true }]) {
      expect(() => recordCapacityResult(pending, malformed)).toThrow("Invalid launch result");
    }
  });
  it("persists intent before calling the launch port, then persists the terminal result", async () => {
    const calls: string[] = [];
    const persist = vi.fn(async () => { calls.push("persist"); });
    const launch = vi.fn(async () => { calls.push("launch"); return { instanceId: id("instance") }; });
    const result = await runCapacityAttempt(journal(), plan.hash, startedAt, { persist, launch });
    expect(calls).toEqual(["persist", "launch", "persist"]);
    expect(persist.mock.calls).toHaveLength(2);
    expect(result.journal).toMatchObject({ outcome: "created", pending: null, instanceId: id("instance") });
  });
  it("a failed intent write prevents all API calls; thrown launch remains pending, not retried", async () => {
    const launch = vi.fn(async () => ({ instanceId: id("instance") }));
    await expect(runCapacityAttempt(journal(), plan.hash, startedAt, { persist: async () => { throw new Error("disk full"); }, launch })).rejects.toThrow("disk full");
    expect(launch).not.toHaveBeenCalled();
    const persist = vi.fn(async () => {});
    const result = await runCapacityAttempt(journal(), plan.hash, startedAt, { persist, launch: async () => { throw new Error("unknown timeout"); } });
    expect(result.journal.outcome).toBe("pending");
    expect(capacityDecision(result.journal, plan.hash, startedAt + CAPACITY_WINDOW_MS).action).toBe("reconcile");
  });
  it("does no API/persistence work when waiting, stopped, already created or needing reconciliation", async () => {
    const persist = vi.fn(async () => {}); const launch = vi.fn(async () => ({ instanceId: id("instance") }));
    const pending = beginCapacityAttempt(journal(), plan.hash, startedAt);
    const capacity = recordCapacityResult(pending, { serviceError: capacityError });
    const created = recordCapacityResult(pending, { instanceId: id("instance") });
    for (const state of [pending, capacity, created, recordCapacityResult(pending, { serviceError: {} })]) {
      await runCapacityAttempt(state, plan.hash, startedAt + 1, { persist, launch });
    }
    expect(persist).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled();
  });
});
