import type { NextConfig } from "next";

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
};

export default nextConfig;
