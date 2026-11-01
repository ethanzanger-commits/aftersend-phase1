import { getAdminClient } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await params;
  try {
    const supabase = getAdminClient();
    const { data: link } = await supabase
      .from("tracked_links")
      .select("id, tracked_email_id, destination_url")
      .eq("id", id)
      .single();

    if (!link || !/^https?:\/\//i.test(link.destination_url)) {
      return new Response("Not found", { status: 404 });
    }

    await supabase.from("email_events").insert({
      tracked_email_id: link.tracked_email_id,
      event_type: "link_clicked",
      tracked_link_id: link.id,
    });

    return Response.redirect(link.destination_url, 302);
  } catch (e) {
    console.error("click error", e);
    return new Response("Error", { status: 500 });
  }
}
