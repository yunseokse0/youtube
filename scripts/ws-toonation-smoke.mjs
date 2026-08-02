/**
 * 투네 Alertbox WebSocket 연결 스모크 — 20초간 수신 메시지 로그
 * 사용: node scripts/ws-toonation-smoke.mjs [연동키|alertbox-url]
 */
import WebSocket from "ws";

const linkKey = process.argv[2] || "f28dc2204fbaf86fd9df74c12f435c73";
const alertUrl =
  linkKey.startsWith("http") ? linkKey : `https://toon.at/widget/alertbox/${linkKey}`;

const res = await fetch(alertUrl, {
  headers: { "User-Agent": "FinalEnt-Broadcast/1.0", Accept: "text/html" },
});
const html = await res.text();
const legacy = html.match(/"payload"\s*:\s*"([a-zA-Z0-9]+)"/);
const unicode = html.match(/payload\\u0022:\\u0022(eyJ[A-Za-z0-9+/=]+)/);
const wsPayload = unicode?.[1] || legacy?.[1];
if (!wsPayload) {
  console.error("payload not found in alertbox html");
  process.exit(1);
}

console.log("alertbox", alertUrl);
console.log("ws payload token len", wsPayload.length);

const ws = new WebSocket(`wss://ws.toon.at/${wsPayload}`);
ws.on("open", () => console.log("[ws] connected — 투네에서 후원 테스트를 보내세요 (20초)"));
ws.on("message", (data) => {
  const raw = data.toString("utf8");
  console.log("[ws] message", raw.slice(0, 800));
  try {
    const j = JSON.parse(raw);
    console.log("[ws] code", j.code, "has content", Boolean(j.content));
  } catch {
    /* noop */
  }
});
ws.on("error", (e) => console.error("[ws] error", e.message));
ws.on("close", () => console.log("[ws] closed"));

await new Promise((r) => setTimeout(r, 20_000));
ws.close();
console.log("done");
