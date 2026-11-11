import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { type NextRequest, NextResponse } from "next/server";
import { checkAdminAuth, forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { getSignedUrl, uploadEventImage } from "@/lib/supabase";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await checkAdminAuth(request.headers);
  if (!auth.authorized) return forbiddenResponse(auth.error);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const eventId = form?.get("eventId");
  if (eventId) {
    if (typeof eventId !== "string" || !/^[1-9]\d*$/.test(eventId)) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    const access = await checkEventAdminAuth(Number(eventId), request.headers, undefined, true);
    if (!access.authorized) return forbiddenResponse(access.error);
  }
  if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Choose an image up to 5 MB" }, { status: 400 });
  }
  let image: Buffer;
  let poster: Buffer;
  let animated: boolean;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(bytes, { animated: true, limitInputPixels: 50_000_000 }).metadata();
    if (!["jpeg", "png", "webp", "gif"].includes(metadata.format || "") || (metadata.pages || 1) > 200) throw new Error("Unsupported image");
    animated = metadata.format === "gif" && (metadata.pages || 1) > 1;
    poster = await sharp(bytes, { limitInputPixels: 50_000_000 }).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    image = animated ? await sharp(bytes, { animated: true, limitInputPixels: 50_000_000 }).resize({ width: 1200, withoutEnlargement: true }).gif().toBuffer() : poster;
    if (image.length > MAX_BYTES) throw new Error("Image too large");
  } catch {
    return NextResponse.json({ error: "Use a valid JPEG, PNG, WebP or GIF (up to 5 MB and 200 frames)" }, { status: 422 });
  }
  try {
    const name = `page-${randomUUID()}`;
    const upload = await uploadEventImage(image, `${name}.${animated ? "gif" : "jpg"}`, "banners", animated ? "image/gif" : "image/jpeg");
    const url = (await getSignedUrl(upload.path, 10 * 365 * 24 * 60 * 60, "banners")).signedUrl;
    let posterUrl = url;
    if (animated) {
      const uploadedPoster = await uploadEventImage(poster, `${name}-poster.jpg`, "banners");
      posterUrl = (await getSignedUrl(uploadedPoster.path, 10 * 365 * 24 * 60 * 60, "banners")).signedUrl;
    }
    return NextResponse.json({ url, posterUrl });
  } catch {
    return NextResponse.json({ error: "Image upload failed. Please retry." }, { status: 500 });
  }
}
