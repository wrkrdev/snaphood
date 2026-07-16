import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { env } from "@/lib/env";

const execFileAsync = promisify(execFile);

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

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch generated image: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
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
  const key = `snaphood/${options.namespace}/${filename}`;

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
