import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@anthropic-ai/claude-code", "execa"],
};

export default nextConfig;
