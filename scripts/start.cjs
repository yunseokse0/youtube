const { spawn } = require("node:child_process");

const nextBin = require.resolve("next/dist/bin/next");
const rawPort = process.env.PORT;
const port = rawPort && /^\d+$/.test(rawPort) ? rawPort : "3000";
const host = process.env.HOST || "0.0.0.0";

const args = [nextBin, "start", "-p", port, "-H", host];

/** pm2/셸에 남은 빌드용 env 가 next start 에서 .next-staging 을 찾게 하면 static 400 */
const env = { ...process.env };
delete env.NEXT_BUILD_DIR;
delete env.NEXT_USE_STAGING_DIST;

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
