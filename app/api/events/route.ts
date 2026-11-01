import { getAdminClient } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

// The extension registers a tracked email (and its links) here.
export async function POST(req: Request) {
  try {
    const secret = process.env.AFTERSEND_API_SECRET;
    const userId = process.env.AFTERSEND_USER_ID;
    if (!secret || !userId) return Response.json({ error: "Server not configured" }, { status: 500 });
    if (req.headers.get("x-api-key") !== secret) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const supabase = getAdminClient();

    const { error } = await supabase.from("tracked_emails").insert({
      id: body.id,
      user_id: userId,
      recipient: body.recipient ?? null,
      subject: body.subject ?? null,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    if (Array.isArray(body.links) && body.links.length) {
      const rows = body.links.map((l: { id: string; url: string }) => ({
        id: l.id,
        tracked_email_id: body.id,
        destination_url: l.url,
      }));
      const { error: linkError } = await supabase.from("tracked_links").insert(rows);
      if (linkError) return Response.json({ error: linkError.message }, { status: 400 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("events error", e);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
