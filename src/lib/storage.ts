import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { env } from "@/lib/env";

const execFileAsync = promisify(execFile);

export async function saveUpload(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = extensionFor(file.type, file.name);
  const id = crypto.randomUUID();
  const filename = `${id}${ext}`;
  const key = `snaphood/uploads/${filename}`;

  await mkdir(path.join(process.cwd(), "public", "uploads"), { recursive: true });
  const localPath = path.join(process.cwd(), "public", "uploads", filename);
  await writeFile(localPath, bytes);

  if (env.wrkrStorageEnabled) {
    try {
      await execFileAsync("wrkr", ["storage", "put", localPath, key, "--content-type", file.type || "application/octet-stream"]);
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
