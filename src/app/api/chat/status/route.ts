import { NextResponse } from "next/server";
import { getChatStatus } from "@/lib/chat-status";

export async function GET() {
  return NextResponse.json({ data: getChatStatus() });
}
