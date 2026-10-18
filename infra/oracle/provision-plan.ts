import { createHash } from "node:crypto";
import { z } from "zod";
import { renderOracleCloudInit } from "./cloud-init";

export const ORACLE_TARGET = Object.freeze({
  region: "uk-london-1", shape: "VM.Standard.A1.Flex", ocpus: 2,
  memoryInGBs: 12, bootVolumeSizeInGBs: 50, vcnCidr: "10.35.0.0/16", subnetCidr: "10.35.1.0/24",
});

type OcidKind = "tenancy" | "compartment" | "image" | "vcn" | "internetgateway" | "routetable" | "securitylist" | "subnet" | "instance";
export function ocidSchema(kind: OcidKind) {
  return z.string().max(255).regex(new RegExp(`^ocid1\\.${kind}\\.oc1\\.[a-z0-9-]*\\.[a-z0-9]{8,}$`));
}

const configSchema = z.strictObject({
  version: z.literal(1),
  deploymentId: z.uuid(),
  tenancyId: ocidSchema("tenancy"),
  compartmentId: z.union([ocidSchema("compartment"), ocidSchema("tenancy")]),
  region: z.literal("uk-london-1"),
  imageId: ocidSchema("image"),
  availabilityDomains: z.array(z.string().regex(/^[A-Za-z0-9]{1,20}:UK-LONDON-1-AD-[1-3]$/)).min(1).max(3)
    .refine(domains => new Set(domains).size === domains.length),
  deployPublicKey: z.string().max(300),
  sshCidr: z.string().max(32),
});

export type OracleProvisionConfig = z.infer<typeof configSchema>;
export type ResourceName = "vcn" | "gateway" | "routes" | "security" | "subnet" | "instance";
export type ResourceIds = Partial<Record<ResourceName, string>>;
export type CliCommand = { args: string[]; purpose: string };

export type OracleProvisionPlan = {
  mode: "offline-plan-only";
  hash: string;
  config: OracleProvisionConfig;
  target: typeof ORACLE_TARGET;
  cloudInit: string;
  prerequisites: readonly string[];
};

/** No OCI, filesystem writes, env loading, account verification, or resource creation. */
export function createOracleProvisionPlan(input: unknown): OracleProvisionPlan {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid Oracle plan input; use a London config with real OCIDs, unique ADs and public SSH inputs. No resources created.");
  const config = parsed.data;
  if (!config.imageId.startsWith("ocid1.image.oc1.uk-london-1.")) throw new Error("The image OCID must belong to London.");
  const cloudInit = renderOracleCloudInit({ deployPublicKey: config.deployPublicKey, sshCidr: config.sshCidr });
  // Bind the complete public bootstrap to the reviewed plan, not just the display name.
  const hash = createHash("sha256").update(JSON.stringify({ config, target: ORACLE_TARGET, cloudInit })).digest("hex");
  return {
    mode: "offline-plan-only", hash, config, target: ORACLE_TARGET, cloudInit,
    prerequisites: [
      "Owner confirms Oracle account active; native CLI/API-key setup succeeds.",
      "Console confirms this tenancy is Free Tier, not PAYG; home region is London.",
      "Verify actual Always Free A1, image and total boot/block usage and zero charge estimate; trial credit is not evidence of free eligibility.",
      "Confirm the requested budget/alert and billing currency; a budget is not a cap.",
      "Re-read all compartments/ADs, limits and existing resources; do not infer tenancy-wide usage from one compartment.",
      "Verify the chosen image is official Canonical Ubuntu 24.04 ARM/A1-compatible, not Marketplace or paid Ubuntu Pro.",
      "Refresh owner public IPv4 and verify SSH key; verify no conflicting deployment/tagged resources.",
      "Use a durable single-writer journal and reconcile ambiguous creates before any further mutation.",
      "After launch verify actual resource shape/volume/network/readiness and billing; do not enable applications.",
    ],
  };
}

function tags(plan: OracleProvisionPlan) {
  return { managedBy: "ir35careers", ir35Deployment: plan.config.deploymentId, ir35Plan: plan.hash };
}

function requiredId(ids: ResourceIds, name: ResourceName, kind: OcidKind) {
  const parsed = ocidSchema(kind).safeParse(ids[name]);
  if (!parsed.success || !parsed.data.startsWith(`ocid1.${kind}.oc1.uk-london-1.`)) throw new Error(`A verified ${name} resource ID is required; do not substitute a placeholder.`);
  return parsed.data;
}

/** CLI argument arrays only; never shell text or commands containing private keys. */
export function oracleCreateCommand(plan: OracleProvisionPlan, resource: ResourceName, ids: ResourceIds = {}, ad?: string): CliCommand {
  // Revalidate callers, including mutable objects supplied by an external adapter.
  const checked = createOracleProvisionPlan(plan.config);
  if (checked.hash !== plan.hash || checked.cloudInit !== plan.cloudInit) throw new Error("Plan changed after review.");
  const common = ["--compartment-id", plan.config.compartmentId, "--display-name", `ir35-worker-${resource}`,
    "--freeform-tags", JSON.stringify(tags(plan))];
  const allOutbound = [{ destination: "0.0.0.0/0", destinationType: "CIDR_BLOCK", protocol: "all", isStateless: false }];
  let args: string[];
  switch (resource) {
    case "vcn":
      args = ["network", "vcn", "create", ...common, "--cidr-blocks", JSON.stringify([ORACLE_TARGET.vcnCidr]),
        "--dns-label", "ir35worker", "--is-ipv6-enabled", "false"];
      break;
    case "gateway":
      args = ["network", "internet-gateway", "create", ...common, "--vcn-id", requiredId(ids, "vcn", "vcn"), "--is-enabled", "true"];
      break;
    case "routes":
      args = ["network", "route-table", "create", ...common, "--vcn-id", requiredId(ids, "vcn", "vcn"), "--route-rules", JSON.stringify([
        { destination: "0.0.0.0/0", destinationType: "CIDR_BLOCK", networkEntityId: requiredId(ids, "gateway", "internetgateway") },
      ])];
      break;
    case "security":
      args = ["network", "security-list", "create", ...common, "--vcn-id", requiredId(ids, "vcn", "vcn"),
        "--ingress-security-rules", JSON.stringify([{
          source: plan.config.sshCidr, sourceType: "CIDR_BLOCK", protocol: "6", isStateless: false,
          tcpOptions: { destinationPortRange: { min: 22, max: 22 } },
        }]), "--egress-security-rules", JSON.stringify(allOutbound)];
      break;
    case "subnet":
      // Use only this explicit security list, never OCI's broad default list.
      args = ["network", "subnet", "create", ...common, "--vcn-id", requiredId(ids, "vcn", "vcn"),
        "--cidr-block", ORACLE_TARGET.subnetCidr, "--dns-label", "worker", "--prohibit-public-ip-on-vnic", "false",
        "--route-table-id", requiredId(ids, "routes", "routetable"),
        "--security-list-ids", JSON.stringify([requiredId(ids, "security", "securitylist")])];
      break;
    case "instance":
      if (!ad || !plan.config.availabilityDomains.includes(ad)) throw new Error("Launch AD must be one of the inspected London domains.");
      args = ["compute", "instance", "launch", ...common, "--availability-domain", ad,
        "--subnet-id", requiredId(ids, "subnet", "subnet"), "--shape", ORACLE_TARGET.shape,
        "--shape-config", JSON.stringify({ ocpus: ORACLE_TARGET.ocpus, memoryInGBs: ORACLE_TARGET.memoryInGBs }),
        "--image-id", plan.config.imageId, "--boot-volume-size-in-gbs", String(ORACLE_TARGET.bootVolumeSizeInGBs),
        "--assign-public-ip", "true", "--assign-ipv6-ip", "false",
        "--instance-options", JSON.stringify({ areLegacyImdsEndpointsDisabled: true }),
        "--metadata", JSON.stringify({ ssh_authorized_keys: plan.config.deployPublicKey, user_data: Buffer.from(plan.cloudInit).toString("base64") })];
      break;
  }
  return { purpose: `Create ${resource} only after live free-tier and reconciliation gates`, args: [
    ...args, "--region", ORACLE_TARGET.region, "--output", "json", "--no-retry",
  ] };
}

/** Fail on name/tag collisions. An adapter must additionally compare actual OCI properties. */
export function findOwnedOracleResource(plan: OracleProvisionPlan, resource: ResourceName, observed: unknown) {
  const kinds: Record<ResourceName, OcidKind> = { vcn: "vcn", gateway: "internetgateway", routes: "routetable", security: "securitylist", subnet: "subnet", instance: "instance" };
  const schema = z.array(z.object({ id: ocidSchema(kinds[resource]).refine(value => value.startsWith(`ocid1.${kinds[resource]}.oc1.uk-london-1.`)), "display-name": z.string(), "lifecycle-state": z.string(),
    "compartment-id": z.string(), "freeform-tags": z.record(z.string(), z.string()),
  }));
  const result = schema.safeParse(observed);
  if (!result.success) throw new Error("Invalid OCI inventory; resource ownership is unproven.");
  const candidates = result.data.filter(row => !["TERMINATED", "DELETED"].includes(row["lifecycle-state"]) && (
    row["display-name"] === `ir35-worker-${resource}` || row["freeform-tags"].ir35Deployment === plan.config.deploymentId
  ));
  const owned = candidates.filter(row => row["compartment-id"] === plan.config.compartmentId
    && row["display-name"] === `ir35-worker-${resource}`
    && Object.entries(tags(plan)).every(([key, value]) => row["freeform-tags"][key] === value));
  if (candidates.length !== owned.length || owned.length > 1) throw new Error("Oracle resource collision/drift; stop and inspect, never create another copy.");
  return owned[0];
}
