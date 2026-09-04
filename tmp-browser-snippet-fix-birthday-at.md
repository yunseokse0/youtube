# 자키생일 정산 — 후원시각만 엑셀 기준으로 정상화하는 브라우저 패치

## 실행 전 준비
1. 반드시 크롬 브라우저에서 http://3.37.127.90/settlements/st_1788427816662_qknue (자키생일 정산 편집 화면) 페이지에 **관리자 로그인** 상태로 진입하세요.
2. F12 → Console 탭을 열고, 아래 코드 전체를 복사 붙여넣기 + 엔터.
3. 화면 중앙에 나타난 [JSON 파일 선택] 버튼을 누르고 → `C:\Users\DIN-STUDIO\Projects\youtube\tmp-birthday-at-map.json` 을 선택하세요.
4. 패치가 자동 실행된 뒤 콘솔에 `✅ DONE` 로그가 뜨면 → 정산 화면에서 [저장] / [비율 적용·재계산] 버튼을 눌러 최종 확정하세요.
5. 저장 후 엑셀(CSV) 내보내기 → 랜덤 10건 spot check.

---

```js
/* ========== 브라우저 콘솔에 붙여넣기 시작 ========== */
(async function patchSettlementBirthdayAtOnly() {
  const SETTLEMENT_ID = "st_1788427816662_qknue"; // 자키생일 정산
  const POLLUTED_AT = 1788513635000; // 2026-09-03 17:40:35 KST (오염된 획일값 — ms 단위 추정, 필요시 아래 확인 로직 재측정)

  function pad(n, l = 2) { return String(n).padStart(l, "0"); }
  function formatKst(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "(invalid)";
    const d = new Date(ms);
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d);
    const pick = (t) => p.find((x) => x.type === t)?.value ?? "";
    return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
  }
  function normName(n) { return String(n || "무명").replace(/\s+/g, "").trim() || "무명"; }
  function donorKey(d) {
    return `${normName(d.name)}\u0001${Math.max(0, Math.round(Number(d.amount) || 0))}\u0001${String(d.message || "").trim()}`;
  }
  function looseKey(d) {
    return `${normName(d.name)}\u0001${Math.max(0, Math.round(Number(d.amount) || 0))}`;
  }

  // ---- 1. 파일 선택 UI 삽입 ----
  let resolveFile;
  const filePromise = new Promise((r) => (resolveFile = r));
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999999;background:#111;border:2px solid #f59e0b;color:#fff;padding:14px 20px;border-radius:12px;font-family:ui-monospace,Consolas,monospace;font-size:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);";
  wrap.innerHTML = `
    <div style="margin-bottom:8px;font-weight:700;color:#fbbf24;">▶ 자키생일 정산 · 후원시각만 복구 패치</div>
    <div style="margin-bottom:10px;font-size:12px;opacity:.85;">1. <b>tmp-birthday-at-map.json</b> 파일을 선택하세요 → 2. 자동으로 복구 실행 → 3. 최종저장은 화면 [저장] 버튼 클릭!</div>
    <input type="file" id="bd-at-json" accept="application/json" style="color:#fff;" />
    <div id="bd-at-status" style="margin-top:10px;font-size:12px;color:#94a3b8;">대기 중…</div>
  `;
  document.body.appendChild(wrap);
  const statusEl = wrap.querySelector("#bd-at-status");
  const input = wrap.querySelector("#bd-at-json");
  input.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { resolveFile(JSON.parse(reader.result)); }
      catch (err) { statusEl.textContent = "❌ JSON 파싱 실패: " + err.message; }
    };
    reader.readAsText(f, "utf-8");
  });
  statusEl.textContent = "👉 JSON 파일을 선택해 주세요 (엑셀 → tmp-birthday-at-map.json)";

  const dump = await filePromise;
  const AT_MAP = dump?.atMap || {};
  const totalEntries = Object.keys(AT_MAP).length;
  statusEl.textContent = `✅ 로드 완료 · map ${totalEntries}건 · 정산 ID=${SETTLEMENT_ID}`;

  // ---- 2. /api/state GET 원격 state 가져오기 ----
  statusEl.textContent = "🔄 /api/state GET 원격 state 로드 중…";
  const stateRes = await fetch("/api/state", { credentials: "include" });
  if (!stateRes.ok) throw new Error("state GET 실패: " + stateRes.status);
  const state = await stateRes.json();
  const records = state.excelBroadcastSettlementRecords || state.settlementRecords || [];
  const record = records.find((r) => r && String(r.id) === SETTLEMENT_ID);
  if (!record) {
    statusEl.textContent = "❌ settlement 레코드 못찾음. id=" + SETTLEMENT_ID + " · records=" + records.length;
    return;
  }
  const donors = Array.isArray(record.donors) ? record.donors : [];
  console.log(`[1/5] state 로드 OK · donors=${donors.length}건, record.createdAt=${record.createdAt} (${formatKst(record.createdAt)})`);

  // 오염 기준값 (17:40:35) 자동 감지
  const bucket = new Map();
  for (const d of donors) bucket.set(d.at, (bucket.get(d.at) || 0) + 1);
  let pollutedAt = POLLUTED_AT;
  let maxCount = 0;
  for (const [at, c] of bucket.entries()) if (c > maxCount && Number.isFinite(at)) { maxCount = c; pollutedAt = at; }
  console.log(`[2/5] 가장 많은 at(획일값 후보): at=${pollutedAt} count=${maxCount}/${donors.length} (${formatKst(pollutedAt)})`);

  // ---- 3. 엑셀 map: key 1건 = 1 atMs, 중복 행은 이름+금액 별로 큐로 재구성 ----
  // 우선 strict key로 매칭하고, 매칭 실패한 행에 대해서 loose key(name|amount)별 queue를 돌린다.
  const looseQueue = new Map();
  for (const [k, v] of Object.entries(AT_MAP)) {
    const [n, a] = k.split("\u0001");
    const lk = `${n}\u0001${a}`;
    if (!looseQueue.has(lk)) looseQueue.set(lk, []);
    looseQueue.get(lk).push(Number(v.atMs));
  }
  // 각 loose 큐는 오름차순 정렬 → 정산 donors에서 같은 loose키 행이 출현 순서대로 분배
  for (const q of looseQueue.values()) q.sort((a, b) => a - b);

  const newDonors = donors.map((d) => ({ ...d })); // 복사 — at 외 다른 필드 100% 보존
  const stats = { strictHit: 0, looseHit: 0, unchanged: 0, unmatched: [], pollutedRemaining: 0 };

  for (let i = 0; i < newDonors.length; i++) {
    const d = newDonors[i];
    const k = donorKey(d);
    const lk = looseKey(d);
    let chosen = null;
    // ① strict (이름|금액|메시지 정확일치)
    if (AT_MAP[k] && Number.isFinite(AT_MAP[k].atMs) && AT_MAP[k].atMs > 0) {
      chosen = Number(AT_MAP[k].atMs);
      stats.strictHit++;
    }
    // ② loose fallback — 같은 (이름+금액) 그룹의 큐 head 를 shift
    if (chosen === null && looseQueue.get(lk)?.length) {
      chosen = looseQueue.get(lk).shift();
      stats.looseHit++;
    }
    if (chosen !== null) {
      d.at = chosen;
    } else {
      if (d.at === pollutedAt) {
        stats.pollutedRemaining++;
        stats.unmatched.push({ i, id: d.id, name: normName(d.name), amount: d.amount, msg: (d.message || "").slice(0, 24) });
      } else {
        stats.unchanged++;
      }
    }
  }

  console.log(`[3/5] 매칭 완료 · strict=${stats.strictHit} loose=${stats.looseHit} 기존유지=${stats.unchanged} 오염잔존=${stats.pollutedRemaining}`);
  if (stats.unmatched.length) {
    console.warn("  [엑셀 매칭 실패 잔여 목록 (최대 20건)]", stats.unmatched.slice(0, 20));
  }

  // ---- 4. 원격 donors만 교체 → /api/state POST 저장 ----
  const patchRecord = { ...record, donors: newDonors };
  const newRecords = records.map((r) => (r && String(r.id) === SETTLEMENT_ID ? patchRecord : r));
  const key = Array.isArray(state.excelBroadcastSettlementRecords) ? "excelBroadcastSettlementRecords" : "settlementRecords";
  const payload = { [key]: newRecords };

  console.log(`[4/5] POST /api/state 저장 직전 — 동결 시각 17:40:35인 행 수: ${newDonors.filter((d) => d.at === pollutedAt).length}`);
  console.log("  ↓ 저장 전 랜덤 10건 spot check");
  const idxs = [];
  while (idxs.length < Math.min(10, newDonors.length)) {
    const r = Math.floor(Math.random() * newDonors.length);
    if (!idxs.includes(r)) idxs.push(r);
  }
  for (const i of idxs) {
    const d = newDonors[i];
    console.log(`    [${pad(i, 3)}] ${formatKst(d.at)}  ${normName(d.name).padEnd(10)} ${pad(d.amount, 8)}원  ${(d.message || "").slice(0, 28)}`);
  }

  statusEl.textContent = "💾 /api/state POST 중… (브라우저 경고창 떠도 OK)";
  const postRes = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!postRes.ok) throw new Error("POST 실패: HTTP " + postRes.status + " → 로그인 상태 & 관리자 권한 확인");
  const postJson = await postRes.json().catch(() => ({}));
  console.log("[5/5] POST 완료. 응답 ok:", postJson.ok ?? "n/a", "invalidations:", postJson.invalidatedKeys?.length ?? 0);

  // ---- 5. 종료 로그 + UI 정리 ----
  statusEl.innerHTML = `🎉 완료 · strict=<b style="color:#22c55e">${stats.strictHit}</b> loose=<b style="color:#3b82f6">${stats.looseHit}</b> 잔여오염=<b style="color:${stats.pollutedRemaining ? '#ef4444' : '#22c55e'}">${stats.pollutedRemaining}</b>건 · 이제 <b>정산 화면 [저장] 버튼</b>을 클릭해 최종 확정 + F5 후 2차 확인하세요.`;
  setTimeout(() => { try { document.body.removeChild(wrap); } catch {} }, 25000);
  console.log("✅ DONE");
})();
/* ========== 브라우저 콘솔에 붙여넣기 끝 ========== */
```
