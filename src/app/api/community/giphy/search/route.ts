import { type NextRequest, NextResponse } from "next/server";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { getSession } from "@/lib/auth/session";
import { recordGiphyHealth } from "@/lib/giphy-health";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    recordGiphyHealth({ success: false, durationMs: 0, error: "Health check giphy failed", code: "MISSING_API_KEY" });
    return NextResponse.json({ error: "Giphy not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const requestedLimit = Number(searchParams.get("limit") ?? "20");
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }
  const limit = Math.min(requestedLimit, 25);

  const started = performance.now();
  try {
    const gf = new GiphyFetch(apiKey);
    const { data } = q
      ? await gf.search(q, { limit, rating: "g" })
      : await gf.trending({ limit, rating: "g" });
    recordGiphyHealth({ success: true, durationMs: Math.round(performance.now() - started) });
    return NextResponse.json({ gifs: data }, { status: 200 });
  } catch (error) {
    console.error("Giphy search error:", error);
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    recordGiphyHealth({
      success: false,
      durationMs: Math.round(performance.now() - started),
      error: "Health check giphy failed",
      ...(typeof code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(code) ? { code } : {}),
    });
    return NextResponse.json({ error: "Giphy search failed" }, { status: 502 });
  }
}
