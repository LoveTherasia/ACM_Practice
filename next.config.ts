import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The orchestration layer shells out to the vendored PowerShell toolchain and reads
  // problem workspaces from disk, so those trees must survive production tracing.
  outputFileTracingIncludes: {
    "/api/**": ["./skills/**/*", "./problems/**/*"],
  },
  experimental: {
    // The generator page keeps a long-lived SSE connection alive.
    proxyTimeout: 1000 * 60 * 30,
  },
};

export default nextConfig;