"use strict";
function nick(d) {
  return String(d.displayNickname || d.nickname || d.name || d.donorName || "").trim();
}
function ident(d) {
  return String(d.id || d.externalId || "").trim();
}
(async () => {
  const j = await (await fetch("http://3.37.127.90/api/state?u=paeza")).json();
  const donors = j.donors || [];
  const buckets = {
    burstDisplay: 0,
    tnBurstN: 0,
    nickA: 0,
    tnN: 0,
    parkJaki: 0,
    kimSamsung: 0,
    parkIdem: 0,
    kimIdem: 0,
    preflight: 0,
    sigBurst: 0,
    sigCatalog: 0,
    real: 0,
    other: [],
  };
  for (const d of donors) {
    const n = nick(d);
    if (n === "버스트") buckets.burstDisplay++;
    else if (n.startsWith("N_")) buckets.tnBurstN++;
    else if (n === "A") buckets.nickA++;
    else if (n.startsWith("TN-N_")) buckets.tnN++;
    else if (n === "박자키") buckets.parkJaki++;
    else if (n === "김삼성") buckets.kimSamsung++;
    else if (n === "박멱등") buckets.parkIdem++;
    else if (n === "김멱등") buckets.kimIdem++;
    else if (/PREFLIGHT/i.test(n)) buckets.preflight++;
    else if (n.startsWith("시그버스트")) buckets.sigBurst++;
    else if (n.startsWith("시그") || n.startsWith("시그카탈로그") || /시그스트레스|sigcat|시그테스트/.test(n))
      buckets.sigCatalog++;
    else if (/서윤석|이민수|^패자/.test(n)) buckets.real++;
    else buckets.other.push(n);
  }
  const otherCounts = {};
  for (const n of buckets.other) otherCounts[n] = (otherCounts[n] || 0) + 1;
  const classified =
    buckets.burstDisplay +
    buckets.tnBurstN +
    buckets.nickA +
    buckets.tnN +
    buckets.parkJaki +
    buckets.kimSamsung +
    buckets.parkIdem +
    buckets.kimIdem +
    buckets.preflight +
    buckets.sigBurst +
    buckets.sigCatalog +
    buckets.real;
  console.log(
    JSON.stringify(
      {
        total: donors.length,
        classified,
        leftover: donors.length - classified,
        buckets: { ...buckets, other: undefined },
        otherUnique: Object.keys(otherCounts).length,
        otherTop: Object.entries(otherCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 40),
        uniqueIds: new Set(donors.map(ident)).size,
      },
      null,
      2
    )
  );
})();
