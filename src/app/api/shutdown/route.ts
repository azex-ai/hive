import { NextResponse } from "next/server";

export async function POST() {
  // In Next.js we can't easily kill the server, but we signal shutdown
  setTimeout(() => process.exit(0), 200);
  return NextResponse.json({ data: { status: "shutting_down" } });
}
