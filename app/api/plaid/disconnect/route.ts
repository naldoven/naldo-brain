/**
 * Disconnect a Plaid Item. Removes upstream + cascades local data.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { disconnectItem } from "@/lib/plaid";

export const runtime = "nodejs";

const bodySchema = z.object({ item_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const cookieClient = await createClient();
  const {
    data: { user },
  } = await cookieClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad_body";
    return NextResponse.json({ error: "bad_request", detail: msg }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }
  const serviceClient = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  try {
    await disconnectItem(serviceClient, user.id, parsed.item_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "disconnect_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
