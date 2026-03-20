import { NextResponse } from "next/server";

export async function POST() {
  // Send SIGTERM for graceful shutdown instead of abrupt process.exit().
  // This allows Next.js and any open connections to clean up properly.
  setTimeout(() => {
    console.log("[hive] Sending SIGTERM for graceful shutdown");
    process.kill(process.pid, "SIGTERM");
  }, 200);
  return NextResponse.json({ data: { status: "shutting_down" } });
}
