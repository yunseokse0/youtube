import { rmSync } from "fs";
import { execSync, spawn } from "child_process";

const PORT = process.env.PORT || "3000";
const EXTRA_PORTS = (process.env.DEV_CLEAN_PORTS || "3001")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

for (const dir of [".next", "node_modules/.cache"]) {
  try {
    rmSync(dir, { recursive: true, force: true });
    console.log(`[dev:clean] removed ${dir}`);
  } catch {
    /* ignore */
  }
}

function killPortWindows(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        console.log(`[dev:clean] stopped PID ${pid} on :${port}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no listener */
  }
}

function killPortUnix(port) {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: "utf8" });
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`[dev:clean] stopped PID ${pid} on :${port}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no listener */
  }
}

function killPort(port) {
  if (process.platform === "win32") killPortWindows(port);
  else killPortUnix(port);
}

const ports = new Set([PORT, ...EXTRA_PORTS]);
for (const p of ports) killPort(p);

console.log(`[dev:clean] starting next dev on :${PORT} (webpack dev cache = memory)`);

const child = spawn("npx", ["next", "dev", "-p", PORT], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
