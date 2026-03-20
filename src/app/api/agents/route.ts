import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { checkAllAgents } from "@/lib/agents";

export async function GET() {
  const config = getConfig();
  const health = await checkAllAgents(config.agents || {});

  const agents = Object.entries(config.agents || {}).map(([name, cfg]) => ({
    name,
    command: cfg.command,
    max_concurrent: cfg.max_concurrent,
    available: health.find((h) => h.name === name)?.available ?? false,
    version: health.find((h) => h.name === name)?.version,
  }));

  return NextResponse.json({ data: agents });
}
