import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oracleCloudInit, renderOracleCloudInit } from "../../infra/oracle/cloud-init";

const syntheticKey = generateKeyPairSync("ed25519");
const key = syntheticKey.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
const publicKey = `ssh-ed25519 ${Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25519"), Buffer.from([0, 0, 0, 32]), key]).toString("base64")} controlled-test`;
const input = { deployPublicKey: publicKey, sshCidr: "8.8.8.8/32" };

describe("Oracle offline bootstrap safety", () => {
  it("renders valid cloud-config without deploying or embedding credentials", () => {
    const rendered = renderOracleCloudInit(input);
    expect(rendered.startsWith("#cloud-config\n")).toBe(true);
    const config = JSON.parse(rendered.split("\n").slice(1).join("\n"));
    expect(config).toEqual(oracleCloudInit(input));
    expect(config).toMatchObject({ ssh_pwauth: false, disable_root: true });
    expect(config.users[1]).toMatchObject({ name: "ir35deploy", lock_passwd: true, sudo: [], ssh_authorized_keys: [publicKey] });
    expect(config.packages).toEqual(expect.arrayContaining(["fail2ban", "unattended-upgrades", "ufw"]));
    expect(config.runcmd).toContainEqual(["ufw", "allow", "from", "8.8.8.8/32", "to", "any", "port", "22", "proto", "tcp"]);
    expect(config.write_files.map((file: { path: string }) => file.path)).not.toContain("/opt/ir35-worker/.env");
    expect(rendered).not.toContain("APPLICATION_WORKER_ACCEPT_JOBS=true");
    const setup = config.write_files.find((file: { path: string }) => file.path === "/usr/local/sbin/ir35-host-setup").content;
    expect(setup).toContain('test "$(dpkg --print-architecture)" = arm64');
    expect(setup).toContain('test "$ID" = ubuntu && test "$VERSION_ID" = 24.04');
    expect(setup).toContain("fallocate -l 2G /swapfile"); expect(setup).toContain("docker-compose-plugin");
    // Do not install a signed apt source before its key / initial package update.
    expect(config.write_files.some((file: { path: string }) => file.path.startsWith("/etc/apt/sources.list.d/"))).toBe(false);
    expect(setup.indexOf("docker.asc\n")).toBeLessThan(setup.indexOf("/etc/apt/sources.list.d/docker.sources"));
  });
  it.each(["0.0.0.0/0", "8.8.8.8/24", "127.0.0.1/32", "10.0.0.1/32", "169.254.169.254/32", "8.8.8.8/32;touch /tmp/bad", "::/0"])("rejects broad/private/injected SSH source %s", sshCidr => {
    expect(() => oracleCloudInit({ ...input, sshCidr })).toThrow("public IPv4 /32");
  });
  it.each(["ssh-ed25519 bad-key", `${publicKey}\npassword: bad`, syntheticKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString()])("rejects invalid/injected/private-key input", deployPublicKey => {
    expect(() => oracleCloudInit({ ...input, deployPublicKey })).toThrow("Ed25519 public key");
  });
  it("binds only localhost health, limits logs/memory, and keeps both cutover gates off by default", () => {
    const config = JSON.parse(readFileSync("infra/oracle/docker-compose.yml", "utf8"));
    const worker = config.services.worker;
    expect(worker).toMatchObject({ platform: "linux/arm64", restart: "unless-stopped", init: true, mem_limit: "4g", ports: ["127.0.0.1:8787:8787"], stop_grace_period: "330s" });
    expect(worker.environment).toMatchObject({ APPLY_RUNNER: "${APPLY_RUNNER:-vercel}", APPLICATION_WORKER_ACCEPT_JOBS: "${APPLICATION_WORKER_ACCEPT_JOBS:-false}" });
    expect(worker.env_file).toEqual([{ path: "/opt/ir35-worker/.env", format: "raw", required: true }]);
    expect(worker.logging.options).toEqual({ "max-size": "10m", "max-file": "3" });
    expect(worker.cap_drop).toEqual(["ALL"]); expect(worker.security_opt).toEqual(["no-new-privileges:true"]);
  });
  it("runs useful mock-only health checks without exposing secrets or promising idle immunity", () => {
    const smoke = readFileSync("infra/oracle/run-smoke.sh", "utf8");
    expect(smoke).toContain("--network none"); expect(smoke).toContain("config --images");
    expect(smoke).toContain("--env-file deploy.env");
    expect(smoke).not.toContain("--env-file .env");
    expect(smoke).not.toMatch(/docker run[^\n]*--env-file/);
    expect(smoke).toContain("services/application-worker/mock-ats-smoke.ts");
    const timer = readFileSync("infra/oracle/ir35-worker-smoke.timer", "utf8");
    expect(timer).toContain("OnUnitActiveSec=6h"); expect(timer).toContain("not an idle-reclamation guarantee");
  });
});
