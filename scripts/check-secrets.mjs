import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const forbiddenTrackedPathPatterns = [
  /^\.env(?:\.|$)/,
  /^public\/uploads\//,
  /^data\/uploads\//
];

const directPatterns = [
  {
    name: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g
  },
  {
    name: "Fal API key",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_-]{20,}\b/gi
  },
  {
    name: "Ethereum private key assignment",
    pattern: /\b(?:DEPLOYER_)?PRIVATE_KEY\s*[:=]\s*["']?0x[0-9a-f]{64}\b/gi
  },
  {
    name: "PEM private key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g
  }
];

const secretEnvNames = [
  "SNAPHOOD_SESSION_SECRET",
  "LLM_API_KEY",
  "FAL_KEY",
  "ALCHEMY_API_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "DATABASE_URL",
  "REDIS_URL"
];

const { stdout } = await execFileAsync("git", ["ls-files"], { maxBuffer: 1024 * 1024 * 10 });
const files = stdout.split(/\r?\n/).filter(Boolean);
const findings = [];

for (const file of files) {
  for (const pattern of forbiddenTrackedPathPatterns) {
    if (pattern.test(file) && file !== ".env.example") {
      findings.push({
        file,
        line: 1,
        type: "Forbidden tracked path",
        detail: "Local env files and generated upload files must not be committed."
      });
    }
  }

  const bytes = await readFile(file);
  if (bytes.includes(0)) continue;

  const text = bytes.toString("utf8");
  scanDirectPatterns(file, text);
  scanSecretEnvAssignments(file, text);
}

if (findings.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        findings
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      scannedFiles: files.length
    },
    null,
    2
  )
);

function scanDirectPatterns(file, text) {
  for (const rule of directPatterns) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        file,
        line: lineNumberFor(text, match.index ?? 0),
        type: rule.name,
        detail: redact(match[0])
      });
    }
  }
}

function scanSecretEnvAssignments(file, text) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || !secretEnvNames.includes(match[1])) continue;

    const value = stripQuotes(match[2].trim());
    if (value && !isSafePlaceholder(value) && !isSafeLocalServiceExample(file, match[1], value)) {
      findings.push({
        file,
        line: lineNumberFor(text, text.indexOf(line)),
        type: "Secret env assignment",
        detail: `${match[1]} has a non-placeholder value`
      });
    }
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

function isSafePlaceholder(value) {
  return value === "" || value === "..." || /^<[^>]+>$/.test(value) || value.includes("example") || value.includes("placeholder");
}

function isSafeLocalServiceExample(file, name, value) {
  if (file !== ".env.example") return false;
  if (!["DATABASE_URL", "REDIS_URL"].includes(name)) return false;
  return /^(postgresql|redis):\/\/(?:[^@\s]+@)?(127\.0\.0\.1|localhost)(:\d+)?/.test(value);
}

function lineNumberFor(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function redact(value) {
  if (value.length <= 12) return "<redacted>";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
