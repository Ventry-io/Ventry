import sharp from "sharp";
import { type NextRequest, NextResponse } from "next/server";
import { checkAdminAuth, forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { eventMediaPath, getSignedUrl, uploadEventImage } from "@/lib/supabase";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FONT_BYTES = 1024 * 1024;
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;

export async function POST(request: NextRequest) {
  const auth = await checkAdminAuth(request.headers);
  if (!auth.authorized) return forbiddenResponse(auth.error);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const eventId = form?.get("eventId");
  // Page media always belongs to one event, so it is stored in (and authorized for) that event.
  if (typeof eventId !== "string" || !/^[1-9]\d*$/.test(eventId)) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  const access = await checkEventAdminAuth(Number(eventId), request.headers, undefined, true);
  if (!access.authorized) return forbiddenResponse(access.error);
  const owner = { eventId: Number(eventId) };
  if (form?.get("kind") === "font") return uploadFont(file, owner);
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
    const path = eventMediaPath(owner, "page", animated ? "gif" : "jpg");
    const upload = await uploadEventImage(image, path, "banners", animated ? "image/gif" : "image/jpeg");
    const url = (await getSignedUrl(upload.path, TEN_YEARS, "banners")).signedUrl;
    let posterUrl = url;
    if (animated) {
      const uploadedPoster = await uploadEventImage(poster, path.replace(/\.gif$/, "-poster.jpg"), "banners");
      posterUrl = (await getSignedUrl(uploadedPoster.path, TEN_YEARS, "banners")).signedUrl;
    }
    return NextResponse.json({ url, posterUrl });
  } catch {
    return NextResponse.json({ error: "Image upload failed. Please retry." }, { status: 500 });
  }
}

/** Custom page fonts: WOFF2 only, checked by its signature rather than the client-sent type. */
async function uploadFont(file: FormDataEntryValue | null | undefined, owner: { eventId: number }) {
  if (!(file instanceof File) || !file.size || file.size > MAX_FONT_BYTES) {
    return NextResponse.json({ error: "Choose a WOFF2 font up to 1 MB" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 4).toString("latin1") !== "wOF2") {
    return NextResponse.json({ error: "Use a WOFF2 font file (.woff2)" }, { status: 422 });
  }
  try {
    const upload = await uploadEventImage(bytes, eventMediaPath(owner, "fonts", "woff2"), "banners", "font/woff2");
    return NextResponse.json({ url: (await getSignedUrl(upload.path, TEN_YEARS, "banners")).signedUrl });
  } catch {
    return NextResponse.json({ error: "Font upload failed. Please retry." }, { status: 500 });
  }
}
