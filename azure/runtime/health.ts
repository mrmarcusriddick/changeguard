import { database } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await database().prepare("SELECT id FROM changes LIMIT 1").all();
    return Response.json({status: "ok", commit: process.env.CHANGEGUARD_COMMIT ?? "unknown"}, {headers: {"Cache-Control": "no-store"}});
  } catch {
    return Response.json({status: "unavailable"}, {status: 503, headers: {"Cache-Control": "no-store"}});
  }
}
