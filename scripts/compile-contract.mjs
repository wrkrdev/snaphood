import { mkdir, readFile, writeFile } from "fs/promises";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import path from "path";

const solcVersion = "0.8.24";
const contractPath = path.join(process.cwd(), "contracts", "SnapHoodToken.sol");
const source = await readFile(contractPath, "utf8");
const compilerLongVersion = readCompilerVersion();

const input = {
  language: "Solidity",
  sources: {
    "SnapHoodToken.sol": {
      content: source
    }
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"]
      }
    }
  }
};

const result = spawnSync("npm", ["exec", "--yes", "--package", `solc@${solcVersion}`, "solcjs", "--", "--standard-json"], {
  input: JSON.stringify(input),
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 10
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const jsonStart = result.stdout.indexOf("{");
const output = JSON.parse(result.stdout.slice(jsonStart));
const errors = output.errors ?? [];
const fatal = errors.filter((error) => error.severity === "error");

for (const error of errors) {
  const line = error.formattedMessage ?? error.message;
  if (error.severity === "error") {
    console.error(line);
  } else {
    console.warn(line);
  }
}

if (fatal.length > 0) {
  process.exit(1);
}

const compiled = output.contracts?.["SnapHoodToken.sol"]?.SnapHoodToken;
if (!compiled?.abi || !compiled?.evm?.bytecode?.object) {
  throw new Error("SnapHoodToken artifact was not produced.");
}

const artifact = {
  contractName: "SnapHoodToken",
  compiler: {
    package: "solc",
    version: solcVersion,
    longVersion: compilerLongVersion
  },
  source: {
    path: "contracts/SnapHoodToken.sol",
    sha256: sha256(source)
  },
  bytecodeHash: sha256(`0x${compiled.evm.bytecode.object}`),
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`
};

const outDir = path.join(process.cwd(), "src", "generated");
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "SnapHoodToken.json"), `${JSON.stringify(artifact, null, 2)}\n`);
console.log("Compiled SnapHoodToken artifact.");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readCompilerVersion() {
  const result = spawnSync("npm", ["exec", "--yes", "--package", `solc@${solcVersion}`, "solcjs", "--", "--version"], {
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_loglevel: "silent"
    }
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^\d+\.\d+\.\d+/.test(line)) ?? solcVersion;
}
