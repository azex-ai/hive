import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { readBlueprint, scanWorkspace } from "@/lib/blueprint";

/** GET /api/workspace/blueprint — return current workspace's blueprint */
export async function GET() {
  const config = getConfig();
  const workspace = config.repo;

  if (!workspace) {
    return NextResponse.json({ error: "no workspace configured" }, { status: 400 });
  }

  // Try reading existing, or scan fresh
  let blueprint = readBlueprint(workspace);
  if (!blueprint) {
    blueprint = scanWorkspace(workspace);
  }

  return NextResponse.json({ data: blueprint });
}
