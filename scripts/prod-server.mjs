import { spawn } from "child_process";
import { constants, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "fs";
import { access } from "fs/promises";
import path from "path";

const root = process.cwd();
const command = process.argv[2] ?? "status";
const host = process.env.SNAPHOOD_HOST || "0.0.0.0";
const port = process.env.SNAPHOOD_PORT || "3000";
const runtimeDir = process.env.SNAPHOOD_RUNTIME_DIR || path.join(root, "logs");
const pidPath = path.join(runtimeDir, "server.pid");
const logPath = path.join(runtimeDir, "server.log");
const healthUrl = process.env.SNAPHOOD_HEALTH_URL || `http://127.0.0.1:${port}/api/health`;

switch (command) {
  case "start":
    await start();
    break;
  case "ensure":
    await ensure();
    break;
  case "stop":
    await stop();
    break;
  case "restart":
    await stop({ quietIfMissing: true });
    await start();
    break;
  case "status":
    await status();
    break;
  default:
    console.error("Usage: node scripts/prod-server.mjs <start|ensure|stop|restart|status>");
    process.exit(1);
}

async function start() {
  await ensureBuildExists();
  mkdirSync(runtimeDir, { recursive: true });

  const existing = readPidFile();
  if (existing && isProcessAlive(existing.pid)) {
    await printStatus(existing);
    return;
  }

  if (existing) rmSync(pidPath, { force: true });

  const unmanagedHealth = await fetchHealth(healthUrl);
  if (unmanagedHealth.ok && unmanagedHealth.body?.ok === true) {
    console.error(
      `A healthy SnapHood server already responds at ${healthUrl}, but ${pidPath} has no live managed PID. Stop the unmanaged process before running prod:start.`
    );
    process.exit(1);
  }

  const logFd = openSync(logPath, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY, 0o644);
  const child = spawn("npm", ["run", "start", "--", "--hostname", host, "-p", port], {
    cwd: root,
    detached: true,
    env: process.env,
    stdio: ["ignore", logFd, logFd]
  });

  child.unref();

  const runtime = {
    pid: child.pid,
    host,
    port,
    healthUrl,
    logPath,
    startedAt: new Date().toISOString()
  };

  writeFileSync(pidPath, `${JSON.stringify(runtime, null, 2)}\n`);

  try {
    await waitForHealthy(runtime);
    await printStatus(runtime);
  } catch (error) {
    await stopProcessGroup(child.pid).catch(() => undefined);
    rmSync(pidPath, { force: true });
    console.error(error instanceof Error ? error.message : String(error));
    const tail = tailLog();
    if (tail) {
      console.error("\nRecent server log:");
      console.error(tail);
    }
    process.exit(1);
  }
}

async function stop(options = {}) {
  const runtime = readPidFile();
  if (!runtime) {
    if (!options.quietIfMissing) console.log(JSON.stringify({ ok: true, running: false, detail: "No PID file." }, null, 2));
    return;
  }

  if (!isProcessAlive(runtime.pid)) {
    rmSync(pidPath, { force: true });
    if (!options.quietIfMissing) console.log(JSON.stringify({ ok: true, running: false, detail: "Removed stale PID file." }, null, 2));
    return;
  }

  await stopProcessGroup(runtime.pid);
  rmSync(pidPath, { force: true });
  console.log(JSON.stringify({ ok: true, running: false, stoppedPid: runtime.pid }, null, 2));
}

async function ensure() {
  const runtime = readPidFile();
  if (!runtime) {
    await start();
    return;
  }

  if (!isProcessAlive(runtime.pid)) {
    rmSync(pidPath, { force: true });
    await start();
    return;
  }

  const health = await fetchHealth(runtime.healthUrl);
  if (health.ok && health.body?.ok === true) {
    await printStatus(runtime);
    return;
  }

  console.error(`Managed SnapHood server PID ${runtime.pid} is unhealthy. Restarting.`);
  await stop({ quietIfMissing: true });
  await start();
}

async function status() {
  const runtime = readPidFile();
  if (!runtime) {
    console.log(JSON.stringify({ ok: true, running: false, detail: "No PID file." }, null, 2));
    return;
  }

  if (!isProcessAlive(runtime.pid)) {
    console.log(JSON.stringify({ ok: false, running: false, stalePid: runtime.pid, detail: "PID file exists but process is not running." }, null, 2));
    process.exitCode = 1;
    return;
  }

  await printStatus(runtime);
}

async function printStatus(runtime) {
  const health = await fetchHealth(runtime.healthUrl);
  const ok = health.ok && health.body?.ok === true;

  console.log(
    JSON.stringify(
      {
        ok,
        running: true,
        pid: runtime.pid,
        host: runtime.host,
        port: runtime.port,
        healthUrl: runtime.healthUrl,
        healthStatus: health.status,
        appOk: health.body?.ok ?? false,
        readiness: health.body?.readiness ?? null,
        logPath: runtime.logPath,
        startedAt: runtime.startedAt
      },
      null,
      2
    )
  );

  if (!ok) process.exitCode = 1;
}

async function ensureBuildExists() {
  try {
    await access(path.join(root, ".next", "BUILD_ID"));
  } catch {
    throw new Error("Production build missing. Run `npm run build` before `npm run prod:start`.");
  }
}

async function waitForHealthy(runtime) {
  const started = Date.now();
  let lastHealth = null;

  while (Date.now() - started < 20_000) {
    if (!isProcessAlive(runtime.pid)) {
      throw new Error(`Production server exited before becoming healthy. PID ${runtime.pid}.`);
    }

    lastHealth = await fetchHealth(runtime.healthUrl);
    if (lastHealth.ok && lastHealth.body?.ok) return;
    await delay(500);
  }

  throw new Error(`Production server did not become healthy within 20 seconds. Last health status: ${lastHealth?.status ?? "unreachable"}.`);
}

async function fetchHealth(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: "unreachable", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function stopProcessGroup(pid) {
  process.kill(-pid, "SIGTERM");

  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (!isProcessAlive(pid)) return;
    await delay(250);
  }

  process.kill(-pid, "SIGKILL");
}

function readPidFile() {
  if (!existsSync(pidPath)) return null;

  try {
    const runtime = JSON.parse(readFileSync(pidPath, "utf8"));
    return Number.isInteger(runtime.pid) ? runtime : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tailLog() {
  if (!existsSync(logPath)) return "";
  const lines = readFileSync(logPath, "utf8").trimEnd().split(/\r?\n/);
  return lines.slice(-30).join("\n");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
