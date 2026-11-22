export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    time: new Date().toISOString(),
  });
}
