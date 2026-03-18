import { NextResponse } from "next/server";
import { getConfig, getOutputDir } from "@/lib/config";
import { checkAllAgents } from "@/lib/agents";

export async function GET() {
  const config = getConfig();
  const agents = checkAllAgents(config.agents || {});
  return NextResponse.json({
    data: {
      agents,
      output_dir: getOutputDir(),
      workspace: config.repo,
    },
  });
}
