const BASE = process.argv[2] || "http://127.0.0.1:3001";
const HS_U = "hs-qa";
const DONOR_U = "hs-qa";
const results = [];

function note(name, ok, detail) {
  results.push({ name, ok, detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
function tenths(n) {
  return Math.round(Number(n) * 10);
}
function occupied(state) {
  return Object.values(state.members || {}).reduce((s, m) => s + tenths(m.cm), 0);
}
async function req(path, opts) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

function roster(n, total) {
  const names = ["박자키", "갓정은", "왓컴퍼니", "꽃돼지", "멤버5", "멤버6"];
  const colors = ["#ff007f", "#00f3ff", "#ffdf00", "#b700ff", "#00ff88", "#ff6b00"];
  const members = {};
  const activeOrder = [];
  const eachT = Math.floor((total * 10) / n);
  let extra = total * 10 - eachT * n;
  for (let i = 0; i < n; i++) {
    const id = String.fromCharCode(65 + i);
    activeOrder.push(id);
    const add = extra > 0 ? 1 : 0;
    extra -= add;
    members[id] = { name: names[i], color: colors[i], cm: (eachT + add) / 10 };
  }
  return { mode: "individual", activeOrder, members, stealFx: "slide", stealSeq: 0, stealDemo: false, boardTotalCm: total, grantLog: [] };
}

(async () => {
  const health = await req("/api/health");
  note("health", health.status === 200, `status=${health.status}`);

  const admin = await req("/admin.html");
  note("admin.html", admin.status === 200 && String(admin.json.raw || "").includes("상류사회") === false ? admin.status === 200 : admin.status === 200, `status=${admin.status}`);
  const overlay = await req("/overlay.html");
  note("overlay.html", overlay.status === 200, `status=${overlay.status}`);

  for (const n of [6, 5, 4]) {
    const total = 480;
    const state = roster(n, total);
    const put = await req(`/api/shangliu?u=${HS_U}`, { method: "PUT", body: JSON.stringify({ state }) });
    const persisted = Boolean(put.json && put.json.ok);
    const get = await req(`/api/shangliu?u=${HS_U}`);
    const s = get.json && get.json.state;
    const sumT = s ? occupied(s) : -1;
    const count = s ? Object.keys(s.members).length : 0;
    const each = n === 6 ? 80 : n === 5 ? 96 : 120;
    const first = s && s.members.A ? s.members.A.cm : null;
    note(`HS ${n}명 PUT/GET`, persisted && get.json.ok && count === n && sumT === total * 10, `count=${count} sumT=${sumT} expect=${total * 10} A=${first} (균등≈${each})`);
  }

  // 6명 480 후 중간 양분 5 = 2.5 를 서버에 반영한 상태 검증 (클라 계산 결과 저장)
  const six = roster(6, 480);
  six.members.B.cm = 77.5;
  six.members.C.cm = 85;
  six.members.D.cm = 77.5;
  const putSplit = await req(`/api/shangliu?u=${HS_U}`, { method: "PUT", body: JSON.stringify({ state: six }) });
  const getSplit = await req(`/api/shangliu?u=${HS_U}`);
  const ss = getSplit.json.state;
  const sumSplit = occupied(ss);
  note("6명 2.5 양분 저장 총합 480", putSplit.json.ok && sumSplit === 4800 && ss.members.C.cm === 85 && ss.members.B.cm === 77.5 && ss.members.D.cm === 77.5, `sumT=${sumSplit} B=${ss.members.B.cm} C=${ss.members.C.cm} D=${ss.members.D.cm}`);

  const beforeDonors = await req(`/api/state?u=${DONOR_U}`);
  const shBefore = await req(`/api/shangliu?u=${HS_U}`);
  const shBeforeStr = JSON.stringify(shBefore.json.state && { members: shBefore.json.state.members, activeOrder: shBefore.json.state.activeOrder });
  const donorCountBefore = Array.isArray(beforeDonors.json && beforeDonors.json.donors) ? beforeDonors.json.donors.length : (beforeDonors.json && beforeDonors.json.state && Array.isArray(beforeDonors.json.state.donors) ? beforeDonors.json.state.donors.length : -1);

  const apply = await req(`/api/donations/apply?u=${DONOR_U}`, {
    method: "POST",
    body: JSON.stringify({
      donorName: `qa-hs-${Date.now()}`,
      amount: 1000,
      memberId: "m1",
      target: "account",
      message: "hs-qa donation",
      id: `qa_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    }),
  });
  const applyOk = apply.status === 200 && apply.json && (apply.json.ok === true || apply.json.applied > 0 || !apply.json.error);
  note("후원 apply", apply.status === 200 && !apply.json.error, `status=${apply.status} body=${JSON.stringify(apply.json).slice(0, 240)}`);

  const shAfter = await req(`/api/shangliu?u=${HS_U}`);
  const shAfterStr = JSON.stringify(shAfter.json.state && { members: shAfter.json.state.members, activeOrder: shAfter.json.state.activeOrder });
  note("후원 후 상류사회 영토 불변", shBeforeStr === shAfterStr, shBeforeStr === shAfterStr ? "동일" : "변경됨");

  const hsPut = await req(`/api/shangliu?u=${HS_U}`, { method: "PUT", body: JSON.stringify({ state: roster(4, 400) }) });
  const afterHsDonors = await req(`/api/state?u=${DONOR_U}`);
  const donorCountAfter = Array.isArray(afterHsDonors.json && afterHsDonors.json.donors) ? afterHsDonors.json.donors.length : (afterHsDonors.json && afterHsDonors.json.state && Array.isArray(afterHsDonors.json.state.donors) ? afterHsDonors.json.state.donors.length : -1);
  note("상류사회 PUT 후 후원 목록 유지", hsPut.json.ok && donorCountAfter >= donorCountBefore && donorCountAfter !== -1, `donors ${donorCountBefore} → ${donorCountAfter} applyStatus=${apply.status}`);

  const din = await req("/api/state?u=din");
  const dinDonors = din.json && (din.json.donors || (din.json.state && din.json.state.donors));
  const dinN = Array.isArray(dinDonors) ? dinDonors.length : -1;
  note("din 후원 상태 로드", din.status === 200 && dinN >= 0, `status=${din.status} donors=${dinN}`);

  const hsDin = await req("/api/shangliu?u=din");
  note("din 상류사회 키 분리 GET", hsDin.status === 200, `ok=${hsDin.json && hsDin.json.ok} hasState=${Boolean(hsDin.json && hsDin.json.state)}`);

  const fail = results.filter((r) => !r.ok);
  console.log("\n--- summary ---");
  console.log(`pass=${results.filter((r) => r.ok).length} fail=${fail.length} total=${results.length}`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
