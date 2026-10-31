"use strict";

function nick(d) {
  return String(d.displayNickname || d.nickname || d.name || d.donorName || "").trim();
}
function amt(d) {
  return Math.round(Number(d.amount) || 0);
}
function atMs(d) {
  const v = d.createdAt || d.at || d.ts || d.time || d.timestamp;
  const n = typeof v === "number" ? v : Date.parse(v || "");
  return Number.isFinite(n) ? n : 0;
}
function ident(d) {
  return String(d.id || d.externalId || d.donorKey || "")
    .trim()
    .replace(/^(bank:sms:|bank:din:|bank:push:|toonation:din:|toonation:)/i, "");
}

function kst(ms) {
  if (!ms) return "";
  return new Date(ms + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

(async () => {
  const r = await fetch("http://3.37.127.90/api/state?u=paeza", { signal: AbortSignal.timeout(25000) });
  const j = await r.json();
  const donors = Array.isArray(j.donors) ? j.donors : [];
  const times = donors.map(atMs).filter(Boolean).sort((a, b) => a - b);
  const ids = donors.map(ident);
  const idCounts = {};
  for (const id of ids) {
    if (!id) continue;
    idCounts[id] = (idCounts[id] || 0) + 1;
  }
  const dupIds = Object.entries(idCounts).filter(([, n]) => n > 1);

  const groups = {
    kimIdem: donors.filter((d) => nick(d) === "김멱등"),
    parkIdem: donors.filter((d) => nick(d) === "박멱등"),
    kimSamsung: donors.filter((d) => nick(d) === "김삼성"),
    parkJaki: donors.filter((d) => nick(d) === "박자키"),
    burstSame: donors.filter((d) => nick(d).startsWith("버스트-동일인")),
    tnBurst: donors.filter((d) => nick(d).startsWith("N_") || /TNBURST/.test(String(d.id || ""))),
    crossA: donors.filter((d) => nick(d).startsWith("A-N_") || nick(d).startsWith("TN-N_")),
    preflight: donors.filter((d) => /PREFLIGHT/i.test(nick(d))),
    realIsh: donors.filter((d) => /서윤석|이민수|^패자/.test(nick(d))),
    amt1: donors.filter((d) => amt(d) === 1),
    amt10000: donors.filter((d) => amt(d) === 10000),
  };

  const byNick = {};
  for (const d of donors) {
    const n = nick(d) || "(empty)";
    byNick[n] = (byNick[n] || 0) + 1;
  }
  const topNicks = Object.entries(byNick)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  const hourBuckets = {};
  for (const t of times) {
    const k = kst(t).slice(0, 13);
    hourBuckets[k] = (hourBuckets[k] || 0) + 1;
  }

  const unnamed = donors.filter((d) => !nick(d)).length;
  const noId = donors.filter((d) => !ident(d)).length;

  console.log(
    JSON.stringify(
      {
        http: r.status,
        count: donors.length,
        uniqueIds: Object.keys(idCounts).length,
        emptyIds: noId,
        duplicateIds: dupIds.length,
        dupSample: dupIds.slice(0, 5).map(([id, n]) => ({ id: id.slice(0, 12), n })),
        timeMin: kst(times[0]),
        timeMax: kst(times[times.length - 1]),
        hourBuckets,
        groups: Object.fromEntries(
          Object.entries(groups).map(([k, v]) => [
            k,
            {
              n: v.length,
              amounts: [...new Set(v.map(amt))].slice(0, 8),
              tMin: kst(v.map(atMs).filter(Boolean).sort()[0]),
            },
          ])
        ),
        topNicks,
        unnamed,
        amountSum: donors.reduce((s, d) => s + amt(d), 0),
      },
      null,
      2
    )
  );
})();
