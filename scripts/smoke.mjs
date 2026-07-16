const baseUrl = (process.env.SNAPHOOD_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const requireCoin = process.env.SNAPHOOD_SMOKE_REQUIRE_COIN !== "false";
const syntheticIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

const checks = [];

await checkPage("/", "SnapHood");
await checkPage("/stack", "Wrkr proof");

const health = await checkJson("/api/health", "health");
assert(health.ok === true, "health.ok should be true");
assert(health.app === "snaphood", "health.app should be snaphood");
assert(health.readiness?.databaseReachable === true, "database should be reachable");

const coinsPayload = await checkJson("/api/coins", "coins");
assert(Array.isArray(coinsPayload.coins), "coins response should include an array");

if (requireCoin) {
  assert(coinsPayload.coins.length > 0, "expected at least one launched coin");
  const first = coinsPayload.coins[0];
  assert(first.contractAddress, "first coin should include a contract address");
  assert(first.profileImageUrl && first.bannerImageUrl, "first coin should include stored images");

  const detail = await checkJson(`/api/coins/${first.contractAddress}`, "coin detail");
  assert(detail.coin?.contractAddress?.toLowerCase() === first.contractAddress.toLowerCase(), "coin detail should match feed contract");
  assert(detail.coin?.explorerUrl, "coin detail should include explorer URL");

  const tradable = coinsPayload.coins.find((coin) => coin.dexscreenerUrl || coin.poolAddress);
  assert(tradable, "expected at least one tradable coin with pool or Dexscreener metadata");

  await checkPage(`/coin/${first.contractAddress}`, first.ticker);
}

const authPayload = await postJson("/api/auth/start", {
  email: `smoke-${Date.now()}@snaphood.local`
});

if (health.readiness?.demoAuthEnabled) {
  assert(authPayload.user?.email, "demo auth should return a user");
  assert(authPayload.mode === "demo", "demo auth should report demo mode");
} else {
  assert(authPayload.sent === true, "magic-link auth should report a sent link");
  assert(authPayload.email, "magic-link auth should return normalized email");
}

const adminResponse = await fetch(`${baseUrl}/api/admin/coins/${coinsPayload.coins?.[0]?.contractAddress ?? "0x0000000000000000000000000000000000000000"}/sync-dex`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-forwarded-for": syntheticIp
  },
  body: "{}"
});
assert(adminResponse.status === 401, "unauthenticated admin route should return 401");
checks.push({ name: "admin protection", status: adminResponse.status });

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      checks
    },
    null,
    2
  )
);

async function checkPage(path, expectedText) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-forwarded-for": syntheticIp }
  });
  const text = await response.text();
  assert(response.ok, `${path} should return 2xx, got ${response.status}`);
  assert(text.includes(expectedText), `${path} should include ${expectedText}`);
  checks.push({ name: path, status: response.status });
}

async function checkJson(path, name) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-forwarded-for": syntheticIp }
  });
  const text = await response.text();
  assert(response.ok, `${path} should return 2xx, got ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  checks.push({ name, status: response.status });
  return payload;
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
  const text = await response.text();
  assert(response.ok, `${path} should return 2xx, got ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  checks.push({ name: path, status: response.status });
  return payload;
}

function assert(condition, message) {
  if (!condition) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          baseUrl,
          checks,
          error: message
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}
