import { readFile } from "fs/promises";

const checks = [];

await checkGitignore();
await checkPackageScripts();
await checkCiWorkflow();
await checkEnvExample();
await checkReleaseDocs();
await checkSecurityHeaders();
await checkContractArtifact();

const failures = checks.filter((check) => check.status === "fail");

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      summary: {
        pass: checks.filter((check) => check.status === "pass").length,
        fail: failures.length
      },
      checks
    },
    null,
    2
  )
);

if (failures.length) {
  process.exit(1);
}

async function checkGitignore() {
  const gitignore = await readText(".gitignore");
  includesOrFail(gitignore, ".env.*", ".gitignore", "Local environment files are ignored.");
  includesOrFail(gitignore, "!.env.example", ".gitignore", "Public env template remains tracked.");
  includesOrFail(gitignore, "public/uploads/", ".gitignore", "Local generated public uploads are ignored.");
  includesOrFail(gitignore, "data/uploads/", ".gitignore", "Local generated data uploads are ignored.");
}

async function checkPackageScripts() {
  const packageJson = JSON.parse(await readText("package.json"));
  const scripts = packageJson.scripts ?? {};
  const required = [
    "verify:env-example",
    "verify:secrets",
    "verify:smoke",
    "verify:ai-normalization",
    "verify:image-validation",
    "verify:launch-consistency",
    "verify:readiness",
    "verify:public-release",
    "contract:verify",
    "db:migrate",
    "db:seed",
    "db:maintenance"
  ];

  for (const script of required) {
    if (scripts[script]) {
      pass(`package script ${script}`, "Required release verification script exists.");
    } else {
      fail(`package script ${script}`, "Missing required release verification script.");
    }
  }
}

async function checkCiWorkflow() {
  const workflow = await readText(".github/workflows/ci.yml");
  for (const command of [
    "npm run verify:env-example",
    "npm run verify:secrets",
    "npm run verify:public-release",
    "npm run verify:ai-normalization",
    "npm run verify:image-validation",
    "npm run contract:verify",
    "npm audit --audit-level=high",
    "npm run build"
  ]) {
    includesOrFail(workflow, command, ".github/workflows/ci.yml", `CI runs ${command}.`);
  }
}

async function checkEnvExample() {
  const envExample = await readText(".env.example");
  const values = Object.fromEntries(
    envExample
      .split(/\r?\n/)
      .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line))
      .filter(Boolean)
      .map((match) => [match[1], stripQuotes(match[2].trim())])
  );

  equalsOrFail(values.SNAPHOOD_DEMO_AUTH_ENABLED, "true", ".env.example", "Example defaults to local demo auth.");
  equalsOrFail(values.TOKEN_LAUNCH_MODE, "demo", ".env.example", "Example defaults to non-spending demo launch mode.");
  equalsOrFail(values.LIQUIDITY_DRY_RUN, "true", ".env.example", "Example liquidity script defaults to dry run.");
  equalsOrFail(values.SWAP_DRY_RUN, "true", ".env.example", "Example swap script defaults to dry run.");
  equalsOrFail(values.WRKR_STORAGE_ENABLED, "false", ".env.example", "Example storage starts local-only.");
  blankOrFail(values.LLM_API_KEY, ".env.example", "LLM key placeholder is blank.");
  blankOrFail(values.FAL_KEY, ".env.example", "Fal key placeholder is blank.");
  blankOrFail(values.DEPLOYER_PRIVATE_KEY, ".env.example", "Deployer key placeholder is blank.");
  blankOrFail(values.SNAPHOOD_ADMIN_EMAILS, ".env.example", "Admin allowlist placeholder is blank.");
}

async function checkReleaseDocs() {
  const docs = await readText("docs/PUBLIC_RELEASE.md");
  for (const phrase of [
    "Rotate any key",
    "npm run verify:secrets",
    "npm run verify:readiness -- --profile=public",
    "Disable demo auth",
    "Enable Wrkr storage",
    "dedicated deployer wallet",
    "Avoid Robinhood logos"
  ]) {
    includesOrFail(docs, phrase, "docs/PUBLIC_RELEASE.md", `Release checklist covers: ${phrase}`);
  }
}

async function checkSecurityHeaders() {
  const nextConfig = await readText("next.config.ts");
  for (const header of [
    "Content-Security-Policy",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Permissions-Policy",
    "Strict-Transport-Security"
  ]) {
    includesOrFail(nextConfig, header, "next.config.ts", `Security header configured: ${header}`);
  }
}

async function checkContractArtifact() {
  const artifact = JSON.parse(await readText("src/generated/SnapHoodToken.json"));
  if (Array.isArray(artifact.abi) && typeof artifact.bytecode === "string" && artifact.bytecode.startsWith("0x")) {
    pass("contract artifact", "Compiled token ABI and bytecode are present.");
  } else {
    fail("contract artifact", "Generated token ABI/bytecode artifact is missing or malformed.");
  }
}

async function readText(path) {
  return readFile(path, "utf8");
}

function includesOrFail(text, expected, name, detail) {
  if (text.includes(expected)) {
    pass(name, detail);
  } else {
    fail(name, `Missing ${expected}. ${detail}`);
  }
}

function equalsOrFail(actual, expected, name, detail) {
  if (actual === expected) {
    pass(name, detail);
  } else {
    fail(name, `Expected ${expected}, got ${actual ?? "<missing>"}. ${detail}`);
  }
}

function blankOrFail(actual, name, detail) {
  if (!actual) {
    pass(name, detail);
  } else {
    fail(name, `Expected a blank placeholder. ${detail}`);
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function pass(name, detail) {
  checks.push({ name, status: "pass", detail });
}

function fail(name, detail) {
  checks.push({ name, status: "fail", detail });
}
