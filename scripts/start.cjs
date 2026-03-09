const { spawn } = require("node:child_process");

const nextBin = require.resolve("next/dist/bin/next");
const rawPort = process.env.PORT;
const port = rawPort && /^\d+$/.test(rawPort) ? rawPort : "3000";
const host = process.env.HOST || "0.0.0.0";

const args = [nextBin, "start", "-p", port, "-H", host];

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
