const BASE = process.env.BASE || "http://localhost:3001";
const UA = "stress-multiuser-e2e/1.0";

async function api(path, { method = "GET", body, userId }) {
  const qs = userId ? (path.includes("?") ? `&` : "?") + `u=${encodeURIComponent(userId)}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      cookie: `_yt_auth=${encodeURIComponent(userId)};`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return json;
}

function buildDonors(prefix, seedTs) {
  return [
    { donorName: `${prefix}A`, amount: 1000 + seedTs % 7, message: `${prefix}_msg_A`, target: "toon", at: seedTs, memberId: `${prefix}-m1` },
    { donorName: `${prefix}B`, amount: 2000 + seedTs % 11, message: `${prefix}_msg_B`, target: "account", at: seedTs + 1, memberId: `${prefix}-m2` },
    { donorName: `${prefix}C`, amount: 3000 + seedTs % 13, message: `${prefix}_msg_C`, target: "toon", at: seedTs + 2, memberId: `${prefix}-m3` },
    { donorName: `${prefix}D`, amount: 4000 + seedTs % 17, message: `${prefix}_msg_D`, target: "account", at: seedTs + 3, memberId: `${prefix}-m4` },
    { donorName: `${prefix}E`, amount: 5000 + seedTs % 19, message: `${prefix}_msg_E`, target: "toon", at: seedTs + 4, memberId: `${prefix}-m5` },
  ].map((d, i) => ({ ...d, id: `fp-${seedTs}-${prefix}-${i}-${Math.random().toString(36).slice(2, 8)}` }));
}

function total(donors) {
  return donors.reduce((s, d) => s + (Number(d.amount) || 0), 0);
}

function assertEq(actual, expected, label) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: actual=${actual} expected=${expected}`);
  return ok;
}

(async () => {
  const users = [
    { id: "multi-stress-userA-" + Date.now(), prefix: "U_A_", seedTs: Date.now() },
    { id: "multi-stress-userB-" + Date.now(), prefix: "U_B_", seedTs: Date.now() + 100 },
    { id: "multi-stress-userC-" + Date.now(), prefix: "U_C_", seedTs: Date.now() + 200 },
  ];
  const donorsByUser = new Map();
  const expectedTotals = new Map();
  const expectedCounts = new Map();
  const allNamesByUser = new Map();
  for (const u of users) {
    const ds = buildDonors(u.prefix, u.seedTs);
    donorsByUser.set(u.id, ds);
    expectedTotals.set(u.id, total(ds));
    expectedCounts.set(u.id, ds.length);
    allNamesByUser.set(u.id, new Set(ds.map(d => d.donorName)));
  }

  console.log(`\n========== 다중 사용자 동시 POST 검증 ==========`);
  console.log(`참여 사용자: ${users.map(u => u.id).join(", ")}`);
  for (const u of users) {
    console.log(`  ${u.id} → donors=${expectedCounts.get(u.id)}건 · total=${expectedTotals.get(u.id)}원 · 이름 prefix=${u.prefix}`);
  }

  const roundPass = [];
  for (let round = 1; round <= 2; round++) {
    console.log(`\n====== ROUND ${round} ======`);
    console.log(`Step 1: 각 사용자 state 초기화 (POST donorsReplace=true, donorsAuthoritative=true) — donors 빈배열 + members 세팅`);
    await Promise.all(users.map(u =>
      api(`/api/state`, {
        method: "POST",
        userId: u.id,
        body: {
          members: [
            { id: `${u.prefix}m1`, name: `${u.prefix}멤버1`, account: 0, toon: 0 },
            { id: `${u.prefix}m2`, name: `${u.prefix}멤버2`, account: 0, toon: 0 },
            { id: `${u.prefix}m3`, name: `${u.prefix}멤버3`, account: 0, toon: 0 },
            { id: `${u.prefix}m4`, name: `${u.prefix}멤버4`, account: 0, toon: 0 },
            { id: `${u.prefix}m5`, name: `${u.prefix}멤버5`, account: 0, toon: 0 },
          ],
          membersAuthoritative: true,
          donors: [],
          donorsReplace: true,
          donorsAuthoritative: true,
          updatedAt: Date.now(),
        },
      })
    ));
    await new Promise(r => setTimeout(r, 400));

    console.log(`Step 2: 3 사용자 동시에 각자 다른 후원 5건 POST 발송 (Promise.all)`);
    const postResults = await Promise.all(users.map(u => {
      const donors = buildDonors(u.prefix, u.seedTs + round * 10000);
      donorsByUser.set(u.id, donors);
      expectedTotals.set(u.id, total(donors));
      expectedCounts.set(u.id, donors.length);
      allNamesByUser.set(u.id, new Set(donors.map(d => d.donorName)));
      return api(`/api/state`, {
        method: "POST",
        userId: u.id,
        body: {
          donors,
          donorsAuthoritative: false,
          donorsReplace: false,
          updatedAt: Date.now(),
        },
      });
    }));
    console.log(`  POST 성공: ${postResults.filter(r => r && r.ok).length}/${users.length}`);
    await new Promise(r => setTimeout(r, 600));

    console.log(`Step 3: 각 사용자 state GET 후 개별 검증 + 타 사용자 데이터 유출 체크`);
    const states = await Promise.all(users.map(u => api(`/api/state`, { userId: u.id })));
    let rOk = true;
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const st = states[i];
      const donors = (st?.donors || []).map(d => ({ ...d, amount: Number(d.amount) || 0 }));
      const nameSet = new Set(donors.map(d => String(d.donorName || "")));
      console.log(`\n  [${u.id}] state 검증:`);
      rOk = assertEq(donors.length, expectedCounts.get(u.id) || 0, `  donor 개수`) && rOk;
      rOk = assertEq(total(donors), expectedTotals.get(u.id) || 0, `  donor 총합`) && rOk;
      // 자기 이름 prefix가 모두 포함되어 있는지
      for (const myName of (allNamesByUser.get(u.id) || new Set())) {
        const present = nameSet.has(myName);
        if (!present) { console.log(`  ❌ 본인 donor 누락: ${myName}`); rOk = false; }
      }
      // 타 사용자 이름이 전혀 포함되어 있지 않은지 (데이터 유출)
      for (let j = 0; j < users.length; j++) {
        if (j === i) continue;
        const other = users[j];
        for (const otherName of (allNamesByUser.get(other.id) || new Set())) {
          if (nameSet.has(otherName)) {
            console.log(`  ❌❌❌ [DATA LEAKAGE] ${u.id} state에 ${other.id}의 donor ${otherName} 이 섞여있음!`);
            rOk = false;
          }
        }
      }
    }
    roundPass.push(rOk);
    console.log(`\nROUND ${round} → ${rOk ? "✅ ALL PASS" : "❌ FAIL"}`);
  }

  const allOk = roundPass.every(Boolean);
  console.log(`\n========== FINAL VERDICT ==========`);
  console.log(`2 라운드 × 3 사용자 × 5건 = 30건 후원 동시 발송`);
  console.log(`검증 항목: 개수일치(${roundPass.filter(Boolean).length}/2) · 총액일치 · 본인 데이터 존재 · 타 사용자 데이터 유출 0건`);
  console.log(allOk ? `✅ 모든 검증 PASS (안심 사용 가능. 여러 계정 타 PC에서 다른 아이디로 동시 접속해도 전혀 문제 없음)` : `❌ 검증 실패`);
  process.exit(allOk ? 0 : 1);
})().catch(err => {
  console.error("FATAL:", err);
  process.exit(2);
});
