import type { NextConfig } from "next";

const PRIVATE_ROUTES = [
  "/account/:path*",
  "/admin/:path*",
  "/alerts/:path*",
  "/analytics/:path*",
  "/applications/:path*",
  "/automation/:path*",
  "/billing/:path*",
  "/dashboard/:path*",
  "/inbox/:path*",
  "/network/:path*",
  "/onboarding/:path*",
  "/profile/:path*",
  "/saved/:path*",
  "/settings/:path*",
] as const;

const nextConfig: NextConfig = {
  // A second lockfile exists above this repository on the workstation. Keep
  // output tracing bounded to this project so builds do not scan the user's
  // wider home directory.
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1"],
  agentRules: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async redirects() {
    return [
      { source: "/developers", destination: "/jobs", permanent: true },
      { source: "/connections", destination: "/platforms", permanent: true },
      { source: "/downloads/ir35careers-cli.mjs", destination: "/jobs", permanent: true },
      { source: "/downloads/ir35careers-mcp-v1.zip", destination: "/jobs", permanent: true },
      { source: "/downloads/ir35careers-chrome-extension-v1.zip", destination: "/analyse-job", permanent: true },
    ];
  },
  async headers() {
    return [
      ...PRIVATE_ROUTES.map((source) => ({
        source,
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      })),
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Email clients fetch the public brand mark through their own image
        // proxies. This narrow exception lets the logo render without relaxing
        // the same-origin policy used by the rest of the application.
        source: "/images/generated/brand/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
