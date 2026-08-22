import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface ResolvedPublicHttpsUrl {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

const reservedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) reservedIpv4.addSubnet(network, prefix, "ipv4");
const reservedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) reservedIpv6.addSubnet(network, prefix, "ipv6");

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);
  return family === 4
    ? reservedIpv4.check(normalized, "ipv4")
    : family === 6
      ? reservedIpv6.check(normalized, "ipv6")
      : true;
}

function normalizedLookupAddresses(
  value: unknown,
): Array<{ address: string; family: 4 | 6 }> {
  if (!Array.isArray(value) || value.length === 0) return [];
  const addresses: Array<{ address: string; family: 4 | 6 }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return [];
    const record = item as { address?: unknown; family?: unknown };
    if (typeof record.address !== "string") return [];
    const address = record.address.trim().toLowerCase();
    const family = isIP(address);
    if ((family !== 4 && family !== 6) || record.family !== family) return [];
    addresses.push({ address, family });
  }
  return addresses;
}

/** Resolve every address and approve a public HTTPS destination. */
export async function resolvePublicHttpsUrl(value: string): Promise<ResolvedPublicHttpsUrl> {
  if (!value || value.length > 2_048) throw new Error("The application URL is invalid.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Use a public HTTPS application URL without embedded credentials.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("The URL does not resolve to a public website.");
  }
  const lookupResult = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true });
  const addresses = normalizedLookupAddresses(lookupResult);
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("The URL does not resolve to a public website.");
  }
  return { url, addresses };
}

/** Resolve and approve a public HTTPS destination before server-side navigation. */
export async function validatePublicHttpsUrl(value: string): Promise<URL> {
  return (await resolvePublicHttpsUrl(value)).url;
}
