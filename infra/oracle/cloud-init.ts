import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { z } from "zod";

const inputSchema = z.strictObject({
  deployPublicKey: z.string().max(300).regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [A-Za-z0-9_.@-]{1,100})?$/).refine(value => {
    const encoded = value.split(" ")[1];
    const bytes = Buffer.from(encoded, "base64");
    return bytes.length === 51 && bytes.readUInt32BE(0) === 11
      && bytes.subarray(4, 15).toString() === "ssh-ed25519" && bytes.readUInt32BE(15) === 32
      && bytes.toString("base64") === encoded;
  }),
  sshCidr: z.string().refine(value => {
    if (!value.endsWith("/32") || isIP(value.slice(0, -3)) !== 4) return false;
    const [a, b, c] = value.slice(0, -3).split(".").map(Number);
    return a > 0 && a < 224 && ![10, 127].includes(a)
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0))
      && !(a === 192 && b === 0 && c === 2) && !(a === 198 && [18, 19].includes(b))
      && !(a === 198 && b === 51 && c === 100) && !(a === 203 && b === 0 && c === 113);
  }),
});

/** Public bootstrap only. It never provisions, opens SSH, writes secrets or starts work. */
export function oracleCloudInit(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("Cloud-init needs one valid Ed25519 public key and the owner's public IPv4 /32.");
  const setup = readFileSync(new URL("./setup-host.sh", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  return {
    package_update: true,
    ssh_pwauth: false,
    disable_root: true,
    users: ["default", { name: "ir35deploy", shell: "/bin/bash", lock_passwd: true, sudo: [], ssh_authorized_keys: [parsed.data.deployPublicKey] }],
    packages: ["ca-certificates", "curl", "fail2ban", "unattended-upgrades", "ufw"],
    write_files: [
      { path: "/usr/local/share/ir35-docker.sources", permissions: "0644", content: "Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: arm64\nSigned-By: /etc/apt/keyrings/docker.asc\n" },
      { path: "/usr/local/sbin/ir35-host-setup", permissions: "0700", content: setup },
      { path: "/etc/ssh/sshd_config.d/10-ir35-worker.conf", permissions: "0644", content: "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n" },
      { path: "/etc/fail2ban/jail.d/ir35-ssh.local", permissions: "0644", content: "[sshd]\nenabled = true\nbackend = systemd\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\n" },
      { path: "/etc/apt/apt.conf.d/20auto-upgrades", permissions: "0644", content: "APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";\n" },
    ],
    runcmd: [
      ["/usr/local/sbin/ir35-host-setup"],
      ["ufw", "default", "deny", "incoming"], ["ufw", "default", "allow", "outgoing"],
      ["ufw", "allow", "from", parsed.data.sshCidr, "to", "any", "port", "22", "proto", "tcp"],
      ["ufw", "--force", "enable"],
    ],
  };
}

/** JSON is a YAML subset accepted by cloud-init, with no shell/template interpolation. */
export function renderOracleCloudInit(input: unknown): string {
  return `#cloud-config\n${JSON.stringify(oracleCloudInit(input), null, 2)}\n`;
}
