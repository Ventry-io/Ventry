import { connection } from "next/server";

// Liveness only: no database, Redis, or session access, so Docker can poll it often.
export async function GET() {
  await connection();
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
