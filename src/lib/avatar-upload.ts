import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors.js";

const MAX_BYTES = 1_500_000;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function avatarsUploadDir(): string {
  return path.join(process.cwd(), "uploads", "avatars");
}

export async function saveAvatarFile(
  userId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ relativePath: string; absolutePath: string }> {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new AppError("INVALID_INPUT", 400, "Image must be JPEG, PNG, or WebP.");
  }
  if (buffer.length > MAX_BYTES) {
    throw new AppError("INVALID_INPUT", 400, "Image is too large. Use a photo under 1.5 MB.");
  }

  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const dir = avatarsUploadDir();
  await mkdir(dir, { recursive: true });

  const filename = `${userId}.${ext}`;
  const absolutePath = path.join(dir, filename);
  await writeFile(absolutePath, buffer);

  return { relativePath: `/uploads/avatars/${filename}`, absolutePath };
}

export function decodeBase64Image(imageBase64: string): Buffer {
  const payload = imageBase64.includes(",") ? imageBase64.split(",").pop()! : imageBase64;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    throw new AppError("INVALID_INPUT", 400, "Invalid image data.");
  }
  if (buffer.length < 32) {
    throw new AppError("INVALID_INPUT", 400, "Image data is too small.");
  }
  return buffer;
}
