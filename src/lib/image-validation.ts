const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function validateRasterImage(file: File) {
  if (!allowedImageTypes.has(file.type)) {
    return "Upload a PNG, JPEG, WebP, or GIF image.";
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesSignature(file.type, header)) {
    return "Image content does not match the uploaded file type.";
  }

  return null;
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
