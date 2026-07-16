const baseUrl = (process.env.SNAPHOOD_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const syntheticIp = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;

const health = await getJson("/api/health");
if (health.readiness?.demoAuthEnabled) {
  fail({
    error: "Auth challenge consistency verification requires SNAPHOOD_DEMO_AUTH_ENABLED=false.",
    demoAuthEnabled: health.readiness?.demoAuthEnabled
  });
}

if (health.readiness?.authEmailMode !== "dry-run") {
  fail({
    error: "Auth challenge consistency verification requires SNAPHOOD_AUTH_EMAIL_MODE=dry-run.",
    authEmailMode: health.readiness?.authEmailMode
  });
}

const email = `auth-consistency-${Date.now()}@snaphood.local`;
const first = await postJson("/api/auth/start", { email });
const second = await postJson("/api/auth/start", { email });

assert(first.magicLink, "first dry-run auth response should include a magic link");
assert(second.magicLink, "second dry-run auth response should include a magic link");
assert(first.magicLink !== second.magicLink, "new auth challenge should produce a distinct magic link");

const firstVerify = await fetch(first.magicLink, {
  headers: { "x-forwarded-for": syntheticIp },
  redirect: "manual"
});
assert(firstVerify.status >= 300 && firstVerify.status < 400, "retired magic link should redirect");
assert(
  firstVerify.headers.get("location")?.endsWith("/?auth=expired"),
  `retired magic link should redirect to auth=expired, got ${firstVerify.headers.get("location")}`
);

const secondVerify = await fetch(second.magicLink, {
  headers: { "x-forwarded-for": syntheticIp },
  redirect: "manual"
});
assert(secondVerify.status >= 300 && secondVerify.status < 400, "latest magic link should redirect");
assert(
  secondVerify.headers.get("location")?.endsWith("/?auth=verified"),
  `latest magic link should redirect to auth=verified, got ${secondVerify.headers.get("location")}`
);

console.log(
  JSON.stringify(
    {
      ok: true,
      email,
      retiredFirstLink: true,
      verifiedLatestLink: true
    },
    null,
    2
  )
);

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-forwarded-for": syntheticIp }
  });
  return readJsonResponse(response, path);
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": syntheticIp
    },
    body: JSON.stringify(body)
  });
  return readJsonResponse(response, path);
}

async function readJsonResponse(response, path) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return JSON: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text}`);
  }

  return payload;
}

function assert(condition, message) {
  if (!condition) {
    fail({ error: message });
  }
}

function fail(payload) {
  console.error(JSON.stringify({ ok: false, baseUrl, ...payload }, null, 2));
  process.exit(1);
}
