const baseUrl = (process.env.SNAPHOOD_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const requireCoin = process.env.SNAPHOOD_SMOKE_REQUIRE_COIN !== "false";
const verifyGenerate = process.env.SNAPHOOD_SMOKE_GENERATE === "true";
const syntheticIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

const checks = [];
const cookieJar = [];
let signedIn = false;

await checkPage("/", "SnapHood");
await checkSecurityHeaders("/");
await checkOriginGuard();
await checkPage("/stack", "Wrkr proof");
await checkPage("/robots.txt", "Sitemap:");

const health = await checkJson("/api/health", "health");
assert(health.ok === true, "health.ok should be true");
assert(health.app === "snaphood", "health.app should be snaphood");
assert(health.readiness?.databaseReachable === true, "database should be reachable");
if (health.readiness?.cache) {
  assert(health.readiness.cacheReachable === true, "configured Redis should be reachable");
}
if (health.readiness?.storage) {
  assert(health.readiness.storageCliAvailable === true, "enabled Wrkr storage should have an available CLI");
}

const coinsPayload = await checkJson("/api/coins", "coins");
assert(Array.isArray(coinsPayload.coins), "coins response should include an array");

const statsPayload = await checkJson("/api/coins/stats", "coin stats");
assert(Number.isInteger(statsPayload.stats?.totalLaunches), "coin stats should include totalLaunches");
assert(Number.isInteger(statsPayload.stats?.tradableLaunches), "coin stats should include tradableLaunches");
assert(Number.isInteger(statsPayload.stats?.chainCount), "coin stats should include chainCount");
assert(typeof statsPayload.stats?.totalLiquidityUsd === "number", "coin stats should include totalLiquidityUsd");
assert(typeof statsPayload.stats?.totalVolume24hUsd === "number", "coin stats should include totalVolume24hUsd");
assert(statsPayload.stats.totalLaunches >= coinsPayload.coins.length, "stats total should cover the current feed page");

if (requireCoin) {
  assert(coinsPayload.coins.length > 0, "expected at least one launched coin");
  const first = coinsPayload.coins[0];
  assert(first.contractAddress, "first coin should include a contract address");
  assert(first.profileImageUrl && first.bannerImageUrl, "first coin should include stored images");

  const searchPayload = await checkJson(`/api/coins?query=${encodeURIComponent(first.ticker)}`, "coin search");
  assert(searchPayload.filters?.query === first.ticker, "coin search should echo the query filter");
  assert(
    searchPayload.coins?.some((coin) => coin.contractAddress?.toLowerCase() === first.contractAddress.toLowerCase()),
    "coin search should find the feed coin by ticker"
  );

  const tradablePayload = await checkJson("/api/coins?tradable=true", "tradable coin filter");
  assert(tradablePayload.filters?.tradable === true, "tradable feed should echo the tradable filter");
  assert(
    tradablePayload.coins.every((coin) => coin.dexscreenerUrl || coin.poolAddress),
    "tradable feed should only return coins with trading metadata"
  );

  const chainStatsPayload = await checkJson(`/api/coins/stats?chainId=${first.chainId}`, "chain coin stats");
  assert(chainStatsPayload.stats?.filters?.chainId === first.chainId, "chain stats should echo the chain filter");
  assert(chainStatsPayload.stats?.totalLaunches >= 1, "chain stats should include at least the feed coin");

  const proofCoin = coinsPayload.coins.find((coin) => coin.dexscreenerUrl || coin.poolAddress) ?? first;
  assert(proofCoin.contractAddress, "proof coin should include a contract address");

  const detail = await checkJson(`/api/coins/${proofCoin.contractAddress}`, "coin detail");
  assert(detail.coin?.contractAddress?.toLowerCase() === proofCoin.contractAddress.toLowerCase(), "coin detail should match feed contract");
  assert(detail.coin?.explorerUrl, "coin detail should include explorer URL");

  const proof = await checkJson(`/api/coins/${proofCoin.contractAddress}/proof`, "launch proof");
  assert(proof.proof?.contractAddress?.toLowerCase() === proofCoin.contractAddress.toLowerCase(), "launch proof should match feed contract");
  assert(/^sha256:[a-f0-9]{64}$/.test(proof.proof?.proofHash ?? ""), "launch proof should include a sha256 fingerprint");
  assert(proof.proof?.proofVersion === "snaphood.launch-proof.v1", "launch proof should include a version");
  assert(Array.isArray(proof.proof?.events), "launch proof should expose event history");
  assert(proof.proof.events.some((event) => event.eventType === "launch.completed"), "launch proof should include launch.completed event");
  assert(proof.proof.guardrails?.acknowledgements, "launch proof should include persisted guardrail acknowledgements");
  assert(proof.proof.events.some((event) => event.eventType === "trading.liquidity_seeded"), "launch proof should include liquidity event");
  assert(proof.proof.events.some((event) => event.eventType === "trading.indexer_swap"), "launch proof should include indexer swap event");
  assert(proof.proof.events.some((event) => event.eventType === "trading.dexscreener_synced"), "launch proof should include Dexscreener sync event");
  assert(Array.isArray(proof.proof?.timeline), "launch proof should include a timeline");
  assert(proof.proof.timeline.some((item) => item.label === "Token deployed" && item.status === "complete"), "launch proof should include completed deployment");
  assert(proof.proof.timeline.every((item) => item.status === "complete"), "seeded launch proof timeline should be complete");
  const repeatedProof = await checkJson(`/api/coins/${proofCoin.contractAddress}/proof`, "launch proof repeat");
  assert(repeatedProof.proof?.proofHash === proof.proof.proofHash, "launch proof fingerprint should be stable across reads");

  const tradable = proofCoin.dexscreenerUrl || proofCoin.poolAddress ? proofCoin : undefined;
  assert(tradable, "expected at least one tradable coin with pool or Dexscreener metadata");

  const coinPage = await checkPage(`/coin/${proofCoin.contractAddress}`, proofCoin.ticker);
  assert(coinPage.includes(`${proofCoin.name} ($${proofCoin.ticker})`), "coin page should include token-specific metadata title");
  assert(coinPage.includes('property="og:title"'), "coin page should include Open Graph title metadata");
  assert(coinPage.includes('name="twitter:card"'), "coin page should include Twitter card metadata");
  assert(coinPage.includes("Tokenomics"), "coin page should include tokenomics");
  assert(coinPage.includes("Supply"), "coin page should include token supply");
  assert(coinPage.includes(proof.proof.proofHash), "coin page should render the launch proof fingerprint");

  const sitemap = await checkPage("/sitemap.xml", proofCoin.contractAddress);
  assert(sitemap.includes("/stack"), "sitemap should include stack proof page");
  assert(sitemap.includes(`/coin/${proofCoin.contractAddress}`), "sitemap should include launched coin page");
}

const authPayload = await postJson("/api/auth/start", {
  email: `smoke-${Date.now()}@snaphood.local`
});

if (health.readiness?.demoAuthEnabled) {
  assert(authPayload.user?.email, "demo auth should return a user");
  assert(authPayload.mode === "demo", "demo auth should report demo mode");
  signedIn = true;
} else {
  assert(authPayload.sent === true, "magic-link auth should report a sent link");
  assert(authPayload.email, "magic-link auth should return normalized email");
  if (authPayload.magicLink) {
    await verifyMagicLink(authPayload.magicLink);
    signedIn = true;
  }
}

if (signedIn) {
  const draftsPayload = await checkJson("/api/me/drafts", "user drafts");
  assert(Array.isArray(draftsPayload.drafts), "authenticated drafts response should include an array");
}

if (verifyGenerate) {
  assert(signedIn, "generate smoke requires demo auth or a dry-run magic link so the script can hold a session");
  await postBadImage("/api/generate");
  const generated = await postImage("/api/generate");
  const draft = generated.draft;
  assert(draft?.id, "generate response should include a draft id");
  assert(draft?.name && draft?.ticker && draft?.description, "generated draft should include token metadata");
  assert(draft?.originalImageUrl && draft?.profileImageUrl && draft?.bannerImageUrl, "generated draft should include stored image URLs");
  if (health.readiness?.storage && health.readiness?.publicStorageUploads) {
    assert(isHttpUrl(draft.originalImageUrl), "storage-backed original image should use a public URL");
    assert(isHttpUrl(draft.profileImageUrl), "storage-backed profile image should use a public URL");
    assert(isHttpUrl(draft.bannerImageUrl), "storage-backed banner image should use a public URL");
  }
  assert(Array.isArray(draft?.tokenomics?.allocation), "generated draft should include tokenomics allocation");

  const draftsPayload = await checkJson("/api/me/drafts", "generated draft persistence");
  assert(
    draftsPayload.drafts?.some((persistedDraft) => persistedDraft.id === draft.id),
    "generated draft should be visible in the signed-in user's recent drafts"
  );
}

if (signedIn) {
  const logout = await postJson("/api/auth/logout", {});
  assert(logout.ok === true, "logout should succeed");
  assert(logout.revoked === true, "logout should revoke the server-side session");
  const afterLogout = await checkJson("/api/me", "post-logout session");
  assert(afterLogout.user === null, "logout should clear the browser session");
  await checkUnauthorized("/api/me/drafts", "post-logout drafts");
  signedIn = false;
}

async function verifyMagicLink(url) {
  const response = await fetch(url, {
    headers: withCookies({ "x-forwarded-for": syntheticIp }),
    redirect: "manual"
  });
  captureCookies(response);
  assert([302, 303, 307, 308].includes(response.status), `magic-link verify should redirect after setting a session, got ${response.status}`);
  checks.push({ name: "/api/auth/verify", status: response.status });
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
    headers: withCookies({ "x-forwarded-for": syntheticIp })
  });
  const text = await response.text();
  assert(response.ok, `${path} should return 2xx, got ${response.status}`);
  assert(text.includes(expectedText), `${path} should include ${expectedText}`);
  checks.push({ name: path, status: response.status });
  return text;
}

async function checkSecurityHeaders(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: withCookies({ "x-forwarded-for": syntheticIp })
  });
  assert(response.ok, `${path} should return 2xx for security header check, got ${response.status}`);
  assert(response.headers.get("x-powered-by") === null, "X-Powered-By header should be disabled");
  assert(response.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options should be nosniff");
  assert(response.headers.get("x-frame-options") === "DENY", "X-Frame-Options should be DENY");
  assert(response.headers.get("referrer-policy") === "strict-origin-when-cross-origin", "Referrer-Policy should be strict");
  assert(response.headers.get("permissions-policy")?.includes("camera=(self)"), "Permissions-Policy should allow camera only for self");
  const csp = response.headers.get("content-security-policy") ?? "";
  assert(csp.includes("frame-ancestors 'none'"), "CSP should block framing");
  assert(csp.includes("object-src 'none'"), "CSP should block plugins");
  checks.push({ name: "security headers", status: response.status });
}

async function checkOriginGuard() {
  const response = await fetch(`${baseUrl}/api/auth/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.invalid",
      "x-forwarded-for": syntheticIp
    },
    body: JSON.stringify({ email: `origin-guard-${Date.now()}@snaphood.local` })
  });
  assert(response.status === 403, `cross-origin mutating request should be rejected, got ${response.status}`);
  checks.push({ name: "origin guard", status: response.status });
}

async function checkJson(path, name) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: withCookies({ "x-forwarded-for": syntheticIp })
  });
  const text = await response.text();
  assert(response.ok, `${path} should return 2xx, got ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  checks.push({ name, status: response.status });
  return payload;
}

async function checkUnauthorized(path, name) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: withCookies({ "x-forwarded-for": syntheticIp })
  });
  const text = await response.text();
  assert(response.status === 401, `${path} should return 401 when logged out, got ${response.status}: ${text}`);
  checks.push({ name, status: response.status });
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: withCookies({
      "content-type": "application/json",
      "x-forwarded-for": syntheticIp
    }),
    body: JSON.stringify(body)
  });
  captureCookies(response);
  const text = await response.text();
  assert(response.ok, `${path} should return 2xx, got ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  checks.push({ name: path, status: response.status });
  return payload;
}

async function postImage(path) {
  const formData = new FormData();
  formData.append("image", new Blob([tinyPng()], { type: "image/png" }), "smoke-green-dot.png");

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: withCookies({ "x-forwarded-for": syntheticIp }),
    body: formData
  });
  captureCookies(response);
  const text = await response.text();
  assert(response.ok, `${path} should return 2xx, got ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  checks.push({ name: path, status: response.status });
  return payload;
}

async function postBadImage(path) {
  const formData = new FormData();
  formData.append("image", new Blob([Buffer.from("<svg><script>alert(1)</script></svg>")], { type: "image/svg+xml" }), "bad.svg");

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: withCookies({ "x-forwarded-for": syntheticIp }),
    body: formData
  });
  captureCookies(response);
  const text = await response.text();
  assert(response.status === 400, `${path} should reject unsafe image uploads, got ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  assert(payload.error, "unsafe image upload should return an error");
  checks.push({ name: `${path} unsafe image`, status: response.status });
}

function withCookies(headers) {
  if (cookieJar.length) {
    return {
      ...headers,
      cookie: cookieJar.join("; ")
    };
  }

  return headers;
}

function captureCookies(response) {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const value = cookie.split(";")[0];
    const name = value.split("=")[0];
    const existingIndex = cookieJar.findIndex((entry) => entry.startsWith(`${name}=`));
    if (existingIndex >= 0) {
      cookieJar[existingIndex] = value;
    } else {
      cookieJar.push(value);
    }
  }
}

function tinyPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
  );
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//.test(value);
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
