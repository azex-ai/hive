import { NextResponse } from "next/server";
import { getChatHistory } from "@/lib/chat-store";

export async function GET() {
  const history = getChatHistory();
  return NextResponse.json({ data: history });
}
