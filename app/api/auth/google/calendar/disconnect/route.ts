/**
 * Disconnect Google Calendar — revoke tokens at Google + delete local row.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { disconnect } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await disconnect(supabase, user.id);
  return NextResponse.json({ ok: true });
}
