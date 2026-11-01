import { getAdminClient } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

// Extension calls this (with the user's Supabase JWT) to register a tracked email.
export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { data, error: insertError } = await supabase
      .from("tracked_emails")
      .insert({
        user_id: userData.user.id,
        recipient: body.recipient ?? null,
        subject: body.subject ?? null,
      })
      .select("id")
      .single();

    if (insertError) return Response.json({ error: insertError.message }, { status: 400 });
    return Response.json({ id: data.id });
  } catch (e) {
    console.error("events error", e);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
