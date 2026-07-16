export const maxRasterImageBytes = 8 * 1024 * 1024;

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function validateRasterImage(file: File) {
  if (file.size > maxRasterImageBytes) {
    return "Image must be 8 MB or smaller.";
  }

  const contentType = normalizeImageType(file.type);
  if (!allowedImageTypes.has(contentType)) {
    return "Upload a PNG, JPEG, WebP, or GIF image.";
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesSignature(contentType, header)) {
    return "Image content does not match the uploaded file type.";
  }

  return null;
}

export function validateRasterBytes(bytes: Uint8Array, contentType: string) {
  if (bytes.byteLength > maxRasterImageBytes) {
    return "Image must be 8 MB or smaller.";
  }

  const normalizedType = normalizeImageType(contentType);
  if (!allowedImageTypes.has(normalizedType)) {
    return "Upload a PNG, JPEG, WebP, or GIF image.";
  }

  if (!matchesSignature(normalizedType, bytes.slice(0, 16))) {
    return "Image content does not match the uploaded file type.";
  }

  return null;
}

export function normalizeImageType(contentType: string) {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function matchesSignature(contentType: string, header: Uint8Array) {
  if (contentType === "image/png") {
    return startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }

  if (contentType === "image/jpeg") {
    return startsWith(header, [0xff, 0xd8, 0xff]);
  }

  if (contentType === "image/gif") {
    return ascii(header, 0, 6) === "GIF87a" || ascii(header, 0, 6) === "GIF89a";
  }

  if (contentType === "image/webp") {
    return ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 12) === "WEBP";
  }

  return false;
}

function startsWith(header: Uint8Array, expected: number[]) {
  return expected.every((byte, index) => header[index] === byte);
}

function ascii(header: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...header.slice(start, end));
}
