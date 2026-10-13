import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep `next build` from replacing the files used by an already-running
  // `next dev` process. The two commands can otherwise share .next and leave
  // the dev server emitting asset URLs that now return 404.
  distDir: process.env.NODE_ENV === "production" ? ".next-prod" : ".next",
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
