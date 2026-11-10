import sharp, { type FitEnum } from "sharp";

export interface JpegCompressionAttempt {
  quality: number;
  width: number;
  height?: number;
  fit?: keyof FitEnum;
}

export interface JpegCompressionResult {
  buffer: Buffer;
  attempt: JpegCompressionAttempt;
}

export async function buildJpegCompressionCandidate(
  input: Buffer,
  attempt: JpegCompressionAttempt,
): Promise<JpegCompressionResult> {
  const buffer = await sharp(input)
    .rotate()
    .resize(attempt.width, attempt.height, {
      fit: attempt.fit ?? "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: attempt.quality, mozjpeg: true })
    .toBuffer();

  return { buffer, attempt };
}

export function isStorageSizeError(error: unknown): boolean {
  const details = [
    error instanceof Error ? error.message : "",
    typeof error === "object" && error && "message" in error ? String(error.message) : "",
    typeof error === "object" && error && "statusCode" in error ? String(error.statusCode) : "",
    typeof error === "object" && error && "status" in error ? String(error.status) : "",
  ].join(" ");

  return /413|entity too large|payload too large|file size|object size|exceed|exceeds|too large|maximum/i.test(details);
}
