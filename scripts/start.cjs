const { spawn } = require("node:child_process");

const nextBin = require.resolve("next/dist/bin/next");
const rawPort = process.env.PORT;
const port = rawPort && /^\d+$/.test(rawPort) ? rawPort : "3000";

const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
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
