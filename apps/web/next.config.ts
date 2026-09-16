import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // TypeScript 5.9 is installed in this repository; Next 16's CLI mode
    // currently returns empty output under the workspace's Node runtime.
    useTypeScriptCli: false,
    workerThreads: true,
  },
};

export default nextConfig;
