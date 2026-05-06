/**
 * Plaid Link onSuccess sends us the public_token. Exchange it for a
 * long-lived access_token, persist the item, and pull initial accounts so
 * the UI has data to render.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { exchangePublicToken } from "@/lib/plaid";

export const runtime = "nodejs";

const bodySchema = z.object({
  public_token: z.string().min(1),
});

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

  // Use the service-role client so RLS can't bite us during item insert
  // (the user is authed, but RLS evaluates against auth.uid() which is null
  // server-side; service-role bypasses for this trusted server flow).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }
  const serviceClient = createServerClient(supabaseUrl, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  try {
    const result = await exchangePublicToken(serviceClient, user.id, parsed.public_token);
    return NextResponse.json({
      ok: true,
      item_id: result.itemId,
      institution_name: result.institutionName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "exchange_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
