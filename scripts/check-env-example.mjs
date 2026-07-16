import { readFile } from "fs/promises";

const requiredKeys = [
  "DATABASE_URL",
  "REDIS_URL",
  "NEXT_PUBLIC_APP_URL",
  "SNAPHOOD_SESSION_SECRET",
  "SNAPHOOD_DEMO_AUTH_ENABLED",
  "SNAPHOOD_AUTH_EMAIL_MODE",
  "SNAPHOOD_ADMIN_EMAILS",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_API_KEY",
  "FAL_KEY",
  "WRKR_STORAGE_ENABLED",
  "WRKR_STORAGE_PUBLIC_UPLOADS",
  "ROBINHOOD_NETWORK",
  "ROBINHOOD_RPC_URL",
  "ROBINHOOD_CHAIN_ID",
  "DEPLOYER_PRIVATE_KEY",
  "TOKEN_LAUNCH_MODE",
  "DEFAULT_TOKEN_SUPPLY",
  "TRADING_TOKEN_ADDRESS",
  "UNISWAP_V3_POSITION_MANAGER",
  "LIQUIDITY_DRY_RUN",
  "SWAP_DRY_RUN"
];

const secretLikeKeys = [
  "SNAPHOOD_SESSION_SECRET",
  "SNAPHOOD_ADMIN_EMAILS",
  "LLM_API_KEY",
  "FAL_KEY",
  "ALCHEMY_API_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "DEPLOYER_ADDRESS",
  "TRADING_TOKEN_ADDRESS",
  "TRADING_POOL_ADDRESS",
  "TRADING_POSITION_ID"
];

const text = await readFile(".env.example", "utf8");
const values = new Map();
const errors = [];

for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;

  const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
  if (!match) continue;

  values.set(match[1], stripQuotes(match[2].trim()));
}

for (const key of requiredKeys) {
  if (!values.has(key)) {
    errors.push(`Missing ${key} from .env.example`);
  }
}

for (const key of secretLikeKeys) {
  const value = values.get(key);
  if (value && !isSafePlaceholder(value)) {
    errors.push(`${key} must be blank or a placeholder in .env.example`);
  }
}

if (values.get("TOKEN_LAUNCH_MODE") !== "demo") {
  errors.push("TOKEN_LAUNCH_MODE must default to demo in .env.example");
}

if (values.get("LIQUIDITY_DRY_RUN") !== "true") {
  errors.push("LIQUIDITY_DRY_RUN must default to true in .env.example");
}

if (values.get("SWAP_DRY_RUN") !== "true") {
  errors.push("SWAP_DRY_RUN must default to true in .env.example");
}

if (values.get("SNAPHOOD_DEMO_AUTH_ENABLED") !== "true") {
  errors.push("SNAPHOOD_DEMO_AUTH_ENABLED should default to true for local demo setup.");
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedKeys: values.size,
      requiredKeys: requiredKeys.length
    },
    null,
    2
  )
);

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function isSafePlaceholder(value) {
  return value === "" || /^<[^>]+>$/.test(value) || value.includes("example") || value.includes("placeholder");
}
