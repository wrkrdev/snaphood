import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { env } from "@/lib/env";
import { maxRasterImageBytes, normalizeImageType, validateRasterBytes } from "@/lib/image-validation";

const execFileAsync = promisify(execFile);
const remoteImageFetchTimeoutMs = 15_000;

export async function saveUpload(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = extensionFor(file.type, file.name);
  return saveBuffer(bytes, {
    extension: ext,
    contentType: file.type || "application/octet-stream",
    namespace: "uploads"
  });
}

export async function saveRemoteImage(url: string, namespace: "generated" | "uploads" = "generated") {
  if (url.startsWith("/")) {
    return { url, key: url.replace(/^\//, ""), localPath: path.join(process.cwd(), "public", url) };
  }

  const parsedUrl = safeRemoteImageUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remoteImageFetchTimeoutMs);
  let response: Response;
  try {
    response = await fetch(parsedUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Could not fetch generated image: ${response.status}`);
  }

  const contentType = normalizeImageType(response.headers.get("content-type") ?? "");
  const bytes = await readLimitedImageBody(response);
  const imageError = validateRasterBytes(bytes, contentType);
  if (imageError) {
    throw new Error(`Generated image rejected: ${imageError}`);
  }

  return saveBuffer(bytes, {
    extension: extensionFor(contentType, url),
    contentType,
    namespace
  });
}

async function saveBuffer(
  bytes: Buffer,
  options: {
    extension: string;
    contentType: string;
    namespace: "uploads" | "generated";
  }
) {
  const id = crypto.randomUUID();
  const filename = `${id}${options.extension}`;
  const keyPrefix = env.wrkrStoragePublicUploads ? "public/snaphood" : "snaphood";
  const key = `${keyPrefix}/${options.namespace}/${filename}`;

  await mkdir(path.join(process.cwd(), "public", "uploads"), { recursive: true });
  const localPath = path.join(process.cwd(), "public", "uploads", filename);
  await writeFile(localPath, bytes);

  if (env.wrkrStorageEnabled) {
    try {
      await execFileAsync("wrkr", ["storage", "put", localPath, key, "--content-type", options.contentType]);
      if (env.wrkrStoragePublicUploads) {
        const { stdout } = await execFileAsync("wrkr", ["storage", "url", key, "--public"]);
        const publicUrl = stdout.trim().split(/\s+/).find((part) => part.startsWith("http"));
        if (publicUrl) {
          return { url: publicUrl, key, localPath };
        }
      }
    } catch {
      // Local file remains available for development even if wrkr storage is not configured.
    }
  }

  return { url: `/uploads/${filename}`, key, localPath };
}

function safeRemoteImageUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Generated image URL is invalid.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Generated image URL must be http or https.");
  }

  return parsed;
}

async function readLimitedImageBody(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxRasterImageBytes) {
    throw new Error("Generated image is larger than 8 MB.");
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxRasterImageBytes) {
      throw new Error("Generated image is larger than 8 MB.");
    }
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    size += value.byteLength;
    if (size > maxRasterImageBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Generated image is larger than 8 MB.");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

function extensionFor(contentType: string, name: string) {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".png")) return ".png";
  if (lowerName.endsWith(".webp")) return ".webp";
  if (lowerName.endsWith(".gif")) return ".gif";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  return ".jpg";
}
