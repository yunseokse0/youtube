/**
 * 멤버별 정산 비율 테스트 스크립트
 * 실행: npx tsx tests/test-settlement-ratio.mjs
 *
 * 또는 npm run dev 후 http://localhost:3000/test-settlement 접속
 */

async function runTest() {
  const { computeSettlement } = await import("../src/lib/settlement.ts");

  const members = [
    { id: "m1", name: "멤버1", account: 100000, toon: 50000, operating: false },
    { id: "m2", name: "멤버2", account: 80000, toon: 40000, operating: false },
    { id: "m3", name: "멤버3", account: 60000, toon: 30000, operating: false },
    { id: "m4", name: "운영비", account: 20000, toon: 10000, operating: true },
  ];

  const overrides = {
    m1: { accountRatio: 0.7, toonRatio: 0.6 },
    m2: { accountRatio: 0.8, toonRatio: 0.5 },
    m3: { accountRatio: 0.6, toonRatio: 0.7 },
  };

  const result = computeSettlement(members, 0.7, 0.6, 0.033, overrides);

  console.log("=== 멤버별 정산 비율 테스트 ===\n");

  let allPass = true;

  for (const m of result.members) {
    const isOperating = /운영비/i.test(m.name);
    const expectedGross = isOperating
      ? m.account + m.toon
      : Math.round(m.account * (overrides[m.memberId]?.accountRatio ?? 0.7)) +
        Math.round(m.toon * (overrides[m.memberId]?.toonRatio ?? 0.6));
    const expectedFee = isOperating ? 0 : Math.round(expectedGross * 0.033);
    const expectedNet = expectedGross - expectedFee;

    const grossOk = m.gross === expectedGross;
    const feeOk = m.fee === expectedFee;
    const netOk = m.net === expectedNet;

    if (!grossOk || !feeOk || !netOk) allPass = false;

    console.log(`${m.name}:`);
    console.log(`  계좌 ${m.account.toLocaleString()} × ${(m.accountRatio * 100).toFixed(0)}% = ${m.accountApplied.toLocaleString()}`);
    console.log(`  투네 ${m.toon.toLocaleString()} × ${(m.toonRatio * 100).toFixed(0)}% = ${m.toonApplied.toLocaleString()}`);
    console.log(`  매출: ${m.gross.toLocaleString()} | 세금: ${m.fee.toLocaleString()} | 정산: ${m.net.toLocaleString()}`);
    console.log(`  ${grossOk && feeOk && netOk ? "OK" : "FAIL"}\n`);
  }

  console.log(`총 매출: ${result.totalGross.toLocaleString()}`);
  console.log(`총 세금: ${result.totalFee.toLocaleString()}`);
  console.log(`총 정산: ${result.totalNet.toLocaleString()}`);

  const sumNet = result.members.reduce((s, m) => s + m.net, 0);
  const sumOk = sumNet === result.totalNet;
  console.log(`\n합계 검증: ${sumOk ? "OK" : "FAIL"} (멤버 net 합계 = ${sumNet.toLocaleString()})`);

  process.exit(allPass && sumOk ? 0 : 1);
}

runTest().catch((e) => {
  console.error(e);
  process.exit(1);
});

