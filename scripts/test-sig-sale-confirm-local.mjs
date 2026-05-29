/**
 * 로컬 판매 확정(pending → finish) 스모크 테스트
 * 사용: node scripts/test-sig-sale-confirm-local.mjs
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const USER = process.env.USER_ID || "finalent";

function q(path) {
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE}${path}${sep}user=${encodeURIComponent(USER)}`;
}

async function request(label, path, init = {}) {
  const url = path.startsWith("http") ? path : q(path);
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  let body;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  const ok = res.ok;
  console.log(`${ok ? "✓" : "✗"} ${label} → ${res.status}`, typeof body === "object" ? JSON.stringify(body) : body);
  return { ok, status: res.status, body };
}

const sampleSigs = [
  { id: "sig_test_a", name: "테스트A", price: 50000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_test_b", name: "테스트B", price: 80000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_test_c", name: "테스트C", price: 120000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_test_d", name: "테스트D", price: 90000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_test_e", name: "테스트E", price: 110000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
];

async function main() {
  console.log(`\n=== 시그 판매 확정 로컬 테스트 (${BASE}, u=${USER}) ===\n`);

  const health = await request("dev 서버", "/api/state?pick=overlay");
  if (!health.ok) {
    console.error("\ndev 서버가 응답하지 않습니다. npm run dev 후 다시 실행하세요.");
    process.exit(1);
  }

  await request("stamp.png", "/images/sigs/stamp.png", { method: "GET" });

  const sessionId = `manual_test_${Date.now()}`;
  const oneShot = { id: "sig_one_shot", name: "한방 시그", price: 450000 };

  const getState = await request("GET state", "/api/state");
  const base = getState.body && typeof getState.body === "object" ? getState.body : {};
  const inventory = Array.isArray(base.sigInventory) ? [...base.sigInventory] : [];
  for (const s of sampleSigs) {
    if (!inventory.some((r) => r.id === s.id)) inventory.push(s);
  }

  const landedAt = Date.now();
  const landedPatch = {
    sigInventory: inventory,
    rouletteState: {
      ...(base.rouletteState || {}),
      phase: "LANDED",
      isRolling: false,
      sessionId,
      startedAt: landedAt,
      selectedSigs: sampleSigs,
      results: sampleSigs,
      result: sampleSigs[4],
      oneShotResult: oneShot,
    },
    updatedAt: landedAt,
  };

  const saveLanded = await request("POST LANDED 상태", "/api/state", {
    method: "POST",
    body: JSON.stringify(landedPatch),
  });
  if (!saveLanded.ok) process.exit(1);

  const pending = await request("POST pending (확정 준비)", "/api/roulette/pending", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
  if (!pending.ok) process.exit(1);

  const finish = await request("POST finish (판매 확정)", "/api/roulette/finish", {
    method: "POST",
    body: JSON.stringify({
      mode: "cinematic5",
      sessionId,
      selectedSigs: sampleSigs,
      oneShotResult: oneShot,
      soldSigIds: ["sig_test_a", "sig_test_b"],
      oneShotInventorySold: false,
      finalPhase: "CONFIRMED",
    }),
  });
  if (!finish.ok) process.exit(1);

  const after = await request("GET state (확정 후)", "/api/state");
  const rs = after.body?.rouletteState;
  const soldA = (after.body?.sigInventory || []).find((x) => x.id === "sig_test_a");
  const soldC = (after.body?.sigInventory || []).find((x) => x.id === "sig_test_c");

  const phaseOk = rs?.phase === "CONFIRMED";
  const soldOk = soldA?.soldCount >= 1 && (soldC?.soldCount || 0) === 0;
  console.log(`\n${phaseOk ? "✓" : "✗"} phase=${rs?.phase} (기대 CONFIRMED)`);
  console.log(`${soldOk ? "✓" : "✗"} 재고: A sold=${soldA?.soldCount}, C sold=${soldC?.soldCount} (A만 판매)`);

  const overlay = await request("오버레이 수동 URL", "/overlay/sig-sales?mode=manual&hideSigBoard=1", { method: "GET" });
  const demo = await request("도장 데모", "/local/sig-stamp-demo", { method: "GET" });

  const allOk = phaseOk && soldOk && overlay.ok && demo.ok;
  console.log(allOk ? "\n=== 전체 통과 ===\n" : "\n=== 일부 실패 ===\n");
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
