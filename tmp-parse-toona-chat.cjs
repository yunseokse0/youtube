const fs = require("fs");
const p =
  "C:\\Users\\USER20240716\\.cursor\\projects\\c-toona\\agent-transcripts\\7ae93a11-4d2e-4657-b213-ca414283bbbb\\7ae93a11-4d2e-4657-b213-ca414283bbbb.jsonl";
const lines = fs.readFileSync(p, "utf8").split(/\n/).filter(Boolean);
function texts(o) {
  const out = [];
  const walk = (v) => {
    if (!v) return;
    if (typeof v === "string") {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === "object") {
      if (v.type === "text" && typeof v.text === "string") out.push(v.text);
      else Object.values(v).forEach(walk);
    }
  };
  walk(o);
  return out.join("\n");
}
let start = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("라이브 서버 후원 테스트 해보고 싶어")) start = i;
}
console.log("total", lines.length, "start", start);
for (let i = start; i < lines.length; i++) {
  let o;
  try {
    o = JSON.parse(lines[i]);
  } catch {
    continue;
  }
  const t = texts(o);
  const role = o.role || "";
  if (role === "user") {
    const idx = t.indexOf("<user_query>");
    const q = idx >= 0 ? t.slice(idx, idx + 180) : t.slice(0, 180);
    console.log("\nUSER", i, q.replace(/\s+/g, " "));
  } else if (role === "assistant") {
    const plain = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (plain.length > 30) console.log("\nASST", i, plain.slice(0, 700));
  }
}
