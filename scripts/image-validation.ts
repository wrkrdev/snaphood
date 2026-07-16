import { createServer } from "http";
import { rm } from "fs/promises";
import { saveRemoteImage } from "../src/lib/storage";
import { maxRasterImageBytes, validateRasterBytes, validateRasterImage } from "../src/lib/image-validation";

const png = tinyPng();
const svg = Buffer.from("<svg><script>alert(1)</script></svg>");
const server = createServer((request, response) => {
  if (request.url === "/png") {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(png);
    return;
  }

  if (request.url === "/png-params") {
    response.writeHead(200, { "content-type": "image/png; charset=binary" });
    response.end(png);
    return;
  }

  if (request.url === "/mismatch") {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(svg);
    return;
  }

  if (request.url === "/svg") {
    response.writeHead(200, { "content-type": "image/svg+xml" });
    response.end(svg);
    return;
  }

  if (request.url === "/large") {
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(maxRasterImageBytes + 1)
    });
    response.end();
    return;
  }

  response.writeHead(404);
  response.end();
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  try {
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not bind image validation test server.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    assert(validateRasterBytes(png, "image/png; charset=binary") === null, "valid PNG bytes should pass");
    assert(validateRasterBytes(svg, "image/png"), "mismatched image signature should fail");

    const file = new File([png], "dot.png", { type: "image/png" });
    assert((await validateRasterImage(file)) === null, "valid uploaded PNG file should pass");

    const saved = await saveRemoteImage(`${baseUrl}/png-params`, "generated");
    assert(saved.url.endsWith(".png"), "remote PNG with content-type parameters should persist as .png");
    await rm(saved.localPath, { force: true });

    await rejects(() => saveRemoteImage("file:///etc/passwd"), "non-http remote image URLs should be rejected");
    await rejects(() => saveRemoteImage(`${baseUrl}/svg`), "SVG remote images should be rejected");
    await rejects(() => saveRemoteImage(`${baseUrl}/mismatch`), "remote image signatures should be validated");
    await rejects(() => saveRemoteImage(`${baseUrl}/large`), "oversized remote images should be rejected");

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: ["upload signature", "remote scheme", "remote type", "remote signature", "remote size"]
        },
        null,
        2
      )
    );
  } finally {
    await close(server);
  }
}

function listen(instance: typeof server) {
  return new Promise<void>((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", () => {
      instance.off("error", reject);
      resolve();
    });
  });
}

function close(instance: typeof server) {
  return new Promise<void>((resolve, reject) => {
    instance.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function rejects(callback: () => Promise<unknown>, message: string) {
  try {
    await callback();
  } catch {
    return;
  }
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function tinyPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
  );
}
