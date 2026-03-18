import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";

export async function GET() {
  const config = getConfig();
  const agents = Object.entries(config.agents || {}).map(
    ([name, cfg]: [string, any]) => ({
      name,
      command: cfg.command,
      max_concurrent: cfg.max_concurrent,
    }),
  );
  return NextResponse.json({ data: agents });
}
