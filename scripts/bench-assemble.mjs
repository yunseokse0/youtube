import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

// ============================================================
// Data Types (inline minimal definitions)
// ============================================================

/**
 * @typedef {Object} Member
 * @property {string} id
 * @property {string} name
 * @property {string} [realName]
 * @property {number} account
 * @property {number} toon
 * @property {number} [contribution]
 * @property {boolean} [operating]
 */

/**
 * @typedef {Object} Donor
 * @property {string} id
 * @property {string} name
 * @property {number} amount
 * @property {string} memberId
 * @property {number} at
 * @property {"account"|"toon"} [target]
 * @property {string} [message]
 * @property {boolean} [donationExcluded]
 * @property {number} [contributionPoints]
 */

/**
 * @typedef {Object} AppState
 * @property {Member[]} members
 * @property {Donor[]} donors
 * @property {import('./contribution-formula').ContributionFormula} [contributionFormula]
 * @property {any[]} [contributionLogs]
 * @property {any} [memberPositions]
 * @property {number} [rosterVersion]
 * @property {number} [updatedAt]
 */

// ============================================================
// Inline: Helper Functions (benchmark-safe copies)
// ============================================================

function donorAtEpochMs(donor) {
  const v = donor?.at;
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDonationEventId(rawId) {
  const s = String(rawId || "").trim();
  if (!s) return "";
  return s.toLowerCase().replace(/[:]+$/g, "");
}

function isDonorExcludedFromDonationTotals(donor) {
  if (!donor) return true;
  if (donor.donationExcluded === true) return true;
  if (donor.groupSplitSource === true) return true;
  return false;
}

function isWeakToonationDonorId(idStr) {
  const s = String(idStr || "").toLowerCase();
  if (!s.startsWith("toonation:")) return false;
  const rest = s.slice("toonation:".length).trim();
  return !rest || rest.includes("auto") || rest.length < 5;
}

function normalizeDonorNameKey(name) {
  const s = String(name || "").trim().toLowerCase();
  if (!s) return "";
  return s.replace(/\s+/g, "");
}

function donorInferSourceKind(donor) {
  if (!donor) return "other";
  const id = String(donor.id || donor.provider || "").toLowerCase();
  if (id.includes("toonation") || id.includes("toona")) return "toonation";
  if (id.includes("bank") || id.includes("din") || id.includes("account")) return "bank";
  return "other";
}

const DONATION_NEAR_DUP_WINDOW_MS = 10_000;

function shouldTreatAsDuplicateDonationContent(a, b) {
  const amountA = Math.max(0, Math.round(Number(a?.amount) || 0));
  const amountB = Math.max(0, Math.round(Number(b?.amount) || 0));
  if (amountA <= 0 || amountA !== amountB) return false;

  const atA = donorAtEpochMs(a);
  const atB = donorAtEpochMs(b);
  if (Math.abs(atA - atB) > DONATION_NEAR_DUP_WINDOW_MS) return false;

  const targetA = (a?.target === "toon") ? "toon" : "account";
  const targetB = (b?.target === "toon") ? "toon" : "account";
  if (targetA !== targetB) return false;

  const memA = String(a?.memberId || "").trim();
  const memB = String(b?.memberId || b?.manualAssignMemberId || "").trim();
  if (memA && memB && memA !== memB) return false;

  const msgA = String(a?.message || "").trim().toLowerCase();
  const msgB = String(b?.message || "").trim().toLowerCase();
  if (msgA && msgB && msgA === msgB) return true;

  const nameA = String(a?.name || a?.donorName || "").trim().toLowerCase();
  const nameB = String(b?.name || b?.donorName || "").trim().toLowerCase();
  if (msgA && nameB && msgA.includes(nameB)) return true;
  if (msgB && nameA && msgB.includes(nameA)) return true;

  if (!msgA && !msgB) {
    const isAnon = (n) => {
      const t = String(n || "").trim().toLowerCase();
      return t === "익명" || t === "anonymous" || t === "anon" || t === "unknown";
    };
    if (isAnon(nameA) || isAnon(nameB)) return true;
  }

  return false;
}

function donorRowDedupeKey(donor) {
  const rawId = String(donor?.id || "").trim();
  const baseId = normalizeDonationEventId(rawId);
  const isSplitPart = Boolean(donor?.groupSplit) || baseId.includes(":split:");
  const isSplitSource = Boolean(donor?.groupSplitSource);

  if (isSplitPart) {
    const memberId = String(donor?.memberId || "").trim() || "z";
    const amt = Math.max(0, Math.floor(Number(donor?.amount || 0)));
    return `split:${baseId}|${memberId}|${amt}`;
  }
  if (isSplitSource) return `src:${baseId}`;

  const toonationMatch = /^toonation:(.+)$/i.exec(baseId);
  if (toonationMatch) {
    const ext = toonationMatch[1].toLowerCase();
    if (!isWeakToonationDonorId(rawId)) return `toonation:${ext}`;
    const rawExt = String(donor?.externalId || "").trim();
    const seed = rawExt || String(donor?.rawHash || "").trim();
    if (seed) {
      let hash = 0x9e3779b9;
      for (let i = 0; i < seed.length; i++) {
        hash = ((hash * 31) ^ seed.charCodeAt(i)) | 0;
      }
      const seedHash = Math.abs(hash).toString(36).padStart(7, "0").slice(-7);
      return `id:${baseId}#${seedHash}`;
    }
    return `id:${baseId}`;
  }

  if (baseId) return `id:${baseId}`;

  const name = String(donor?.name || "").trim();
  const amount = Math.floor(Number(donor?.amount || 0));
  const rawFallbackExt = String(donor?.externalId || donor?.rawHash || "").trim();
  if (rawFallbackExt) {
    let hash = 0xdeadbeef;
    for (let i = 0; i < rawFallbackExt.length; i++) {
      hash = ((hash * 131) ^ rawFallbackExt.charCodeAt(i)) | 0;
    }
    const fallbackHash = Math.abs(hash).toString(36).padStart(6, "0").slice(-5);
    return `fallback:${name}|${donorAtEpochMs(donor)}|${amount}|${fallbackHash}`;
  }

  const seedParts = [name, String(donorAtEpochMs(donor)), String(amount)];
  if (rawId) seedParts.push(rawId);
  else seedParts.push(`${name}|${donorAtEpochMs(donor)}|${amount}|${String(donor?.message || "")}`);

  const lastResortSeed = seedParts.join("||");
  let lastHash = 0x9e3779b9;
  for (let i = 0; i < lastResortSeed.length; i++) {
    lastHash = ((lastHash * 257) ^ lastResortSeed.charCodeAt(i)) | 0;
  }
  const lastResortHash = Math.abs(lastHash).toString(36).padStart(6, "0").slice(-6);
  return `fallback:${name}|${donorAtEpochMs(donor)}|${amount}|${lastResortHash}`;
}

function mergeDonorRowFields(preferred, fallback) {
  if (!fallback) return preferred;
  const KIND_RELIABILITY = { toonation: 10, other: 5, bank: 1 };
  const kindPref = donorInferSourceKind(preferred);
  const kindFall = donorInferSourceKind(fallback);
  const relPref = KIND_RELIABILITY[kindPref] || 0;
  const relFall = KIND_RELIABILITY[kindFall] || 0;
  const usePrefForMeta = relPref > relFall
    ? true
    : relFall > relPref
      ? false
      : String(preferred?.name || preferred?.donorName || "").length >=
        String(fallback?.name || fallback?.donorName || "").length;

  const bestSrc = usePrefForMeta ? preferred : fallback;
  const mergedName = String(
    bestSrc?.name || bestSrc?.donorName || preferred?.name || preferred?.donorName ||
    fallback?.name || fallback?.donorName || ""
  ).trim() || preferred?.name;

  const rawPrefTarget = String(preferred?.target || "").trim();
  const rawFallTarget = String(fallback?.target || "").trim();
  const mergedTarget = rawPrefTarget || bestSrc?.target || rawFallTarget || preferred?.target;

  const msg = String(preferred?.message || "").trim();
  const fallbackMsg = String(fallback?.message || "").trim();

  const mergedAmount = Math.max(0, Math.round(Number(preferred?.amount ?? fallback?.amount) || 0));
  const merged = {
    ...preferred,
    name: mergedName ?? preferred?.name,
    target: mergedTarget ?? preferred?.target,
    amount: mergedAmount,
  };
  if (!msg && fallbackMsg) merged.message = fallbackMsg;
  if (preferred?.donationExcluded || fallback?.donationExcluded) merged.donationExcluded = true;
  if (preferred?.groupSplit || fallback?.groupSplit) merged.groupSplit = true;
  if (preferred?.groupSplitSource || fallback?.groupSplitSource) merged.groupSplitSource = true;
  return merged;
}

function dedupeDonorRows(donors) {
  if (!donors || donors.length === 0) return [];
  const map = new Map();
  for (const d of donors) {
    const key = donorRowDedupeKey(d);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, d);
      continue;
    }
    if (donorAtEpochMs(d) >= donorAtEpochMs(prev)) {
      map.set(key, mergeDonorRowFields(d, prev));
    } else {
      map.set(key, mergeDonorRowFields(prev, d));
    }
  }
  const pass1 = Array.from(map.values()).sort(
    (a, b) => donorAtEpochMs(b) - donorAtEpochMs(a)
  );

  const MAX_BUCKET_SCAN = 200;
  if (pass1.length <= MAX_BUCKET_SCAN) {
    const merged = [];
    for (const d of pass1) {
      const dupIdx = merged.findIndex((prev) =>
        shouldTreatAsDuplicateDonationContent(prev, {
          ...d,
          donorName: d.name,
          externalId: d.externalId,
          rawHash: d.rawHash,
        })
      );
      if (dupIdx < 0) {
        merged.push(d);
        continue;
      }
      const prev = merged[dupIdx];
      const aWeak = isWeakToonationDonorId(String(prev.id || ""));
      const bWeak = isWeakToonationDonorId(String(d.id || ""));
      const preferred =
        aWeak && !bWeak ? d : !aWeak && bWeak ? prev
          : donorAtEpochMs(d) >= donorAtEpochMs(prev) ? d : prev;
      const other = preferred === d ? prev : d;
      merged[dupIdx] = mergeDonorRowFields(preferred, other);
    }
    return merged;
  }

  const bucket = new Map();
  for (const d of pass1) {
    const name = normalizeDonorNameKey(d.name);
    const amt = Math.max(0, Math.round(Number(d.amount || 0)));
    const key = `${name ?? ""}\u0001${amt}`;
    const arr = bucket.get(key);
    if (arr) arr.push(d);
    else bucket.set(key, [d]);
  }

  const merged = [];
  for (const d of pass1) {
    const name = normalizeDonorNameKey(d.name);
    const amt = Math.max(0, Math.round(Number(d.amount || 0)));
    let dupIdx = -1;
    for (let i = 0; i < merged.length; i++) {
      const prev = merged[i];
      const pName = normalizeDonorNameKey(prev.name);
      const pAmt = Math.max(0, Math.round(Number(prev.amount || 0)));
      if (pName !== name || pAmt !== amt) continue;
      if (shouldTreatAsDuplicateDonationContent(prev, d)) {
        dupIdx = i;
        break;
      }
    }
    if (dupIdx < 0) {
      merged.push(d);
      continue;
    }
    const prev = merged[dupIdx];
    const aWeak = isWeakToonationDonorId(String(prev.id || ""));
    const bWeak = isWeakToonationDonorId(String(d.id || ""));
    const preferred =
      aWeak && !bWeak ? d : !aWeak && bWeak ? prev
        : donorAtEpochMs(d) >= donorAtEpochMs(prev) ? d : prev;
    const other = preferred === d ? prev : d;
    merged[dupIdx] = mergeDonorRowFields(preferred, other);
  }
  return merged;
}

function normalizeContributionFormula(formula) {
  const f = formula || {};
  const aw = Number(f.accountWeightPct);
  const tw = Number(f.toonWeightPct);
  return {
    accountWeightPct: Number.isFinite(aw) && aw >= 0 ? Math.min(200, aw) : 100,
    toonWeightPct: Number.isFinite(tw) && tw >= 0 ? Math.min(200, tw) : 100,
  };
}

function computeContributionPoints(amount, target, formula) {
  const amt = Math.max(0, Math.round(Number(amount) || 0));
  if (amt <= 0) return 0;
  const f = normalizeContributionFormula(formula);
  const weightPct = (target === "toon") ? f.toonWeightPct : f.accountWeightPct;
  return Math.round((amt * weightPct) / 100);
}

function aggregateContributionByMember(state, dedupedDonors) {
  const out = new Map();
  const formula = normalizeContributionFormula(state?.contributionFormula);
  for (const donor of dedupedDonors) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    const mid = String(donor.memberId || "").trim();
    if (!mid) continue;
    let bucket = out.get(mid);
    if (!bucket) {
      bucket = { donorPoints: 0, hasDonorSource: false };
      out.set(mid, bucket);
    }
    bucket.hasDonorSource = true;
    const stored = Number(donor.contributionPoints);
    if (Number.isFinite(stored) && stored >= 0) {
      bucket.donorPoints += Math.round(stored);
    } else {
      bucket.donorPoints += computeContributionPoints(
        donor.amount,
        donor.target || "account",
        formula
      );
    }
  }
  return out;
}

function aggregateContribLogsByMember(logs) {
  const out = new Map();
  if (!logs || logs.length === 0) return out;
  for (const log of logs) {
    const mid = String(log.memberId || "").trim();
    if (!mid) continue;
    const amt = Math.max(0, Math.floor(Number(log.amount) || 0));
    if (amt <= 0) continue;
    let bucket = out.get(mid);
    if (!bucket) {
      bucket = { deltaSum: 0, hasLogSource: false };
      out.set(mid, bucket);
    }
    bucket.hasLogSource = true;
    bucket.deltaSum += log.delta === -1 ? -amt : amt;
  }
  return out;
}

function isOperatingSettlementMember(member, positions) {
  if (!member) return false;
  if (member.operating === true) return true;
  return false;
}

function scoreRosterAgainstMatchCounts(members, matchCounts) {
  if (!members || !members.length) return 0;
  let score = 0;
  for (const m of members) {
    const c = matchCounts.get(String(m.id || "").trim()) || 0;
    if (c > 0) score += c;
  }
  return score;
}

function computeMemberTotalsAndScores(state) {
  const deduped = dedupeDonorRows(state.donors || []);
  const totals = new Map();
  const matchCounts = new Map();
  let countable = 0;
  for (const member of state.members || []) {
    totals.set(member.id, { account: 0, toon: 0 });
  }
  for (const donor of deduped) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    countable += 1;
    const memberId = String(donor.memberId || "").trim();
    if (memberId) {
      matchCounts.set(memberId, (matchCounts.get(memberId) || 0) + 1);
      if (totals.has(memberId)) {
        const bucket = totals.get(memberId);
        const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
        if ((donor.target || "account") === "toon") bucket.toon += amount;
        else bucket.account += amount;
      }
    }
  }
  const contribMap = aggregateContributionByMember(state, deduped);
  const logMap = aggregateContribLogsByMember(state.contributionLogs);
  return { deduped, totals, matchCounts, contribMap, logMap, countable };
}

function buildMembersFromTotals(baseState, members, totals, contribMap, logMap) {
  const positions = baseState.memberPositions || null;
  return (members || []).map((member) => {
    const bucket = totals.get(member.id) || { account: 0, toon: 0 };
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      positions
    );
    const hasDonorSrc = contribMap.get(member.id)?.hasDonorSource === true;
    const hasLogSrc = logMap.get(member.id)?.hasLogSource === true;
    const contribution =
      isOperating || !(hasDonorSrc || hasLogSrc)
        ? Math.max(0, Number(member.contribution) || 0)
        : Math.max(
            0,
            (contribMap.get(member.id)?.donorPoints || 0) +
              (logMap.get(member.id)?.deltaSum || 0)
          );
    return {
      ...member,
      account: bucket.account,
      toon: bucket.toon,
      contribution,
    };
  });
}

function memberRosterIdSignature(members) {
  return (members || [])
    .map((m) => String(m.id || ""))
    .filter(Boolean)
    .sort()
    .join("\u001e");
}

// ============================================================
// BASELINE: syncAndRepairMemberTotals (original 1-pass logic)
// ============================================================

export function syncAndRepairMemberTotals(state, ...fallbacks) {
  const calc = computeMemberTotalsAndScores(state);
  const { totals, matchCounts, contribMap, logMap, countable } = calc;

  if (countable <= 0) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    return { ...state, members };
  }

  const currentScore = scoreRosterAgainstMatchCounts(state.members, matchCounts);
  if (currentScore >= countable * 0.99 && fallbacks.length === 0) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    return { ...state, members };
  }

  const bumpedRoster = Number(state.rosterVersion || 0);
  if (bumpedRoster > 0) {
    const maxFbRoster = fallbacks.reduce(
      (m, fb) => Math.max(m, Number(fb?.rosterVersion || 0)),
      0
    );
    if (bumpedRoster > maxFbRoster) {
      const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
      return { ...state, members };
    }
  }

  if (fallbacks.length === 0) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    return { ...state, members };
  }

  const stateIdSig = memberRosterIdSignature(state.members);
  const stateUpdatedAt = Number(state.updatedAt || 0);
  let bestMembers = state.members;
  let bestScore = currentScore;
  for (const fb of fallbacks) {
    if (!fb?.members?.length) continue;
    const fbIdSig = memberRosterIdSignature(fb.members);
    if (stateIdSig && fbIdSig && stateIdSig !== fbIdSig && stateUpdatedAt >= Number(fb.updatedAt || 0)) {
      continue;
    }
    const score = scoreRosterAgainstMatchCounts(fb.members, matchCounts);
    if (score > bestScore) {
      bestScore = score;
      bestMembers = fb.members;
    }
  }
  if (bestScore <= 0) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    return { ...state, members };
  }
  if (bestMembers === state.members || bestScore === currentScore) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    return { ...state, members };
  }
  const members = buildMembersFromTotals(state, bestMembers, totals, contribMap, logMap);
  return { ...state, members };
}

// ============================================================
// NEW: shell assembler applyRepairPipeline (4-step sequential)
// ============================================================

function syncMemberTotalsFromDonorsInline(state) {
  const deduped = dedupeDonorRows(state.donors || []);
  const totals = new Map();
  for (const member of state.members || []) {
    totals.set(member.id, { account: 0, toon: 0 });
  }
  for (const donor of deduped) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    const memberId = String(donor.memberId || "").trim();
    if (!memberId || !totals.has(memberId)) continue;
    const bucket = totals.get(memberId);
    const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
    if ((donor.target || "account") === "toon") bucket.toon += amount;
    else bucket.account += amount;
  }
  const contribMap = aggregateContributionByMember(state, deduped);
  const logMap = aggregateContribLogsByMember(state.contributionLogs);
  const positions = state.memberPositions || null;
  const members = (state.members || []).map((member) => {
    const bucket = totals.get(member.id) || { account: 0, toon: 0 };
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      positions
    );
    const hasDonorSrc = contribMap.get(member.id)?.hasDonorSource === true;
    const hasLogSrc = logMap.get(member.id)?.hasLogSource === true;
    const contribution =
      isOperating || !(hasDonorSrc || hasLogSrc)
        ? Math.max(0, Number(member.contribution) || 0)
        : Math.max(
            0,
            (contribMap.get(member.id)?.donorPoints || 0) +
              (logMap.get(member.id)?.deltaSum || 0)
          );
    return {
      ...member,
      account: bucket.account,
      toon: bucket.toon,
      contribution,
    };
  });
  return { ...state, members };
}

function repairMemberTotalsForDonorRosterInline(state, ...fallbacks) {
  const donors = state.donors || [];
  const deduped = dedupeDonorRows(donors);
  let countable = 0;
  for (const d of deduped) {
    if (!isDonorExcludedFromDonationTotals(d)) {
      countable += Math.max(0, Math.round(Number(d.amount) || 0));
    }
  }
  if (countable <= 0) return state;

  const ids = new Set((state.members || []).map((m) => String(m.id || "").trim()).filter(Boolean));
  let currentScore = 0;
  for (const d of deduped) {
    if (isDonorExcludedFromDonationTotals(d)) continue;
    const mid = String(d.memberId || "").trim();
    if (!mid || !ids.has(mid)) continue;
    currentScore += Math.max(0, Math.round(Number(d.amount) || 0));
  }
  if (currentScore >= countable * 0.99) return state;

  const bumpedRoster = Number(state.rosterVersion || 0);
  if (bumpedRoster > 0) {
    const maxFbRoster = fallbacks.reduce(
      (m, fb) => Math.max(m, Number(fb?.rosterVersion || 0)),
      0
    );
    if (bumpedRoster > maxFbRoster) return state;
  }

  if (fallbacks.length === 0) {
    return syncMemberTotalsFromDonorsInline(state);
  }

  const stateIdSig = memberRosterIdSignature(state.members);
  const stateUpdatedAt = Number(state.updatedAt || 0);

  let bestMembers = state.members;
  let bestScore = currentScore;
  for (const fb of fallbacks) {
    if (!fb?.members?.length) continue;
    const fbIdSig = memberRosterIdSignature(fb.members);
    if (stateIdSig && fbIdSig && stateIdSig !== fbIdSig && stateUpdatedAt >= Number(fb.updatedAt || 0)) {
      continue;
    }
    const fbIds = new Set((fb.members || []).map((m) => String(m.id || "").trim()).filter(Boolean));
    let score = 0;
    for (const d of deduped) {
      if (isDonorExcludedFromDonationTotals(d)) continue;
      const mid = String(d.memberId || "").trim();
      if (!mid || !fbIds.has(mid)) continue;
      score += Math.max(0, Math.round(Number(d.amount) || 0));
    }
    if (score > bestScore) {
      bestScore = score;
      bestMembers = fb.members;
    }
  }
  if (bestScore <= 0) return state;
  if (bestMembers === state.members || bestScore === currentScore) return state;
  return syncMemberTotalsFromDonorsInline({ ...state, members: bestMembers });
}

function guardMemberTotalsAgainstAccidentalZeroWipeInline(state, baseline) {
  if (!baseline?.members?.length) return state;

  const ids = new Set((state.members || []).map((m) => String(m.id || "")).filter(Boolean));
  if (ids.size === 0) return state;

  const combinedTotal = (members, idSet) => {
    return (members || [])
      .filter((m) => idSet.has(m.id))
      .reduce(
        (sum, m) => sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)),
        0
      );
  };

  const baselineTotal = combinedTotal(baseline.members, ids);
  const stateTotal = combinedTotal(state.members, ids);
  if (baselineTotal <= 0) return state;
  if (stateTotal >= baselineTotal * 0.99) return state;

  const keepIds = new Set((state.members || []).map((m) => String(m.id || "").trim()).filter(Boolean));
  const rosterDonors = (state.donors || []).filter((d) => keepIds.has(String(d.memberId || "").trim()));

  const dedupedRoster = dedupeDonorRows(rosterDonors);
  let donorSupport = 0;
  for (const d of dedupedRoster) {
    if (isDonorExcludedFromDonationTotals(d)) continue;
    const mid = String(d.memberId || "").trim();
    if (!mid || !ids.has(mid)) continue;
    donorSupport += Math.max(0, Math.round(Number(d.amount) || 0));
  }
  if (donorSupport < baselineTotal * 0.99) return state;

  const resynced = syncMemberTotalsFromDonorsInline({ ...state, donors: rosterDonors });
  const resyncedTotal = combinedTotal(resynced.members, ids);
  if (resyncedTotal >= baselineTotal * 0.99) return resynced;

  return state;
}

export function applyRepairPipeline(state, baseline) {
  // Step 1: syncAndRepair (repairMemberTotalsForDonorRoster)
  let s1 = repairMemberTotalsForDonorRosterInline(state, baseline);
  // Step 2: dedupeDonorRows on donors
  let s2 = { ...s1, donors: dedupeDonorRows(s1.donors || []) };
  // Step 3: syncMemberTotals
  let s3 = syncMemberTotalsFromDonorsInline(s2);
  // Step 4: zeroWipeGuard
  let s4 = guardMemberTotalsAgainstAccidentalZeroWipeInline(s3, baseline);
  return s4;
}

// ============================================================
// Data Generation
// ============================================================

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function generateMembers(M) {
  const members = [];
  for (let i = 0; i < M; i++) {
    members.push({
      id: String(i),
      name: `멤버${i}`,
      account: 0,
      toon: 0,
      contribution: 0,
      operating: i === 0,
    });
  }
  return members;
}

function generateDonors(D, M, F, seed = 42) {
  const rand = seededRandom(seed);
  const now = Date.now();
  const sources = ["din", "toonation"];
  const donors = [];

  for (let i = 0; i < D; i++) {
    const memberId = String(Math.floor(rand() * M));
    const amount = 1000 + Math.floor(rand() * 49001);
    const source = sources[Math.floor(rand() * 2)];
    const atOffset = Math.floor(rand() * 7 * 24 * 60 * 60 * 1000);
    const target = rand() > 0.5 ? "toon" : "account";
    donors.push({
      id: `${source}:donor_${i}_${Math.floor(rand() * 1_000_000)}`,
      name: `후원자${i}`,
      amount,
      memberId,
      at: now - atOffset,
      target,
      message: rand() > 0.7 ? `테스트 메시지 ${i}` : undefined,
      source,
    });
  }

  // F failures: corrupt last F donors
  for (let i = 1; i <= F; i++) {
    const idx = D - i;
    if (i % 2 === 1) {
      donors[idx].amount = NaN;
      donors[idx].message = "CORRUPT_AMOUNT_NaN";
    } else {
      delete donors[idx].memberId;
      donors[idx].message = "CORRUPT_MISSING_MEMBERID";
    }
  }

  return donors;
}

function buildState(members, donors) {
  return {
    members,
    donors,
    contributionFormula: { accountWeightPct: 100, toonWeightPct: 100 },
    contributionLogs: [],
    rosterVersion: 1,
    updatedAt: Date.now(),
  };
}

// ============================================================
// Benchmark Runner
// ============================================================

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.max(0, Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1));
  return sortedArr[idx];
}

function getRSSMB() {
  return process.memoryUsage().rss / (1024 * 1024);
}

function runBench(fn, state, baseline, warmup, iterations, label) {
  // Warmup
  for (let i = 0; i < warmup; i++) {
    fn(structuredClone(state), baseline ? structuredClone(baseline) : undefined);
  }

  // Force GC if available
  if (global.gc) {
    try { global.gc(); } catch {}
  }

  const times = [];
  const memBefore = getRSSMB();
  let memPeak = memBefore;

  for (let i = 0; i < iterations; i++) {
    const s = structuredClone(state);
    const b = baseline ? structuredClone(baseline) : undefined;

    const memStart = getRSSMB();
    const t0 = performance.now();
    fn(s, b);
    const t1 = performance.now();
    const memEnd = getRSSMB();

    times.push(t1 - t0);
    if (memEnd > memPeak) memPeak = memEnd;
  }

  if (global.gc) {
    try { global.gc(); } catch {}
  }
  const memAfter = getRSSMB();

  const sorted = [...times].sort((a, b) => a - b);
  const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const rssAvg = memPeak - memBefore;
  const rssDelta = memAfter - memBefore;

  return {
    label,
    samples: iterations,
    avgMs: avg,
    medianMs: median,
    p95Ms: p95,
    minMs: min,
    maxMs: max,
    rssPeakMB: memPeak,
    rssStartMB: memBefore,
    rssDeltaMB: rssDelta,
  };
}

function runMTTR(fn, stateWithFailures, baseline, label) {
  const s = structuredClone(stateWithFailures);
  const b = baseline ? structuredClone(baseline) : undefined;
  const t0 = performance.now();
  const repaired = fn(s, b);
  const t1 = performance.now();

  let corruptedFixed = 0;
  const donors = repaired.donors || [];
  for (const d of donors) {
    if (d.message === "CORRUPT_AMOUNT_NaN") {
      const amt = Number(d.amount);
      if (!Number.isNaN(amt) && Number.isFinite(amt)) corruptedFixed++;
    } else if (d.message === "CORRUPT_MISSING_MEMBERID") {
      if (d.memberId && String(d.memberId).trim() !== "") corruptedFixed++;
    }
  }

  const membersOk = (repaired.members || []).every((m) => {
    const acc = Number(m.account);
    const toon = Number(m.toon);
    const contrib = Number(m.contribution ?? 0);
    return Number.isFinite(acc) && acc >= 0 &&
           Number.isFinite(toon) && toon >= 0 &&
           Number.isFinite(contrib) && contrib >= 0;
  });

  return {
    label,
    mttrMs: t1 - t0,
    corruptedFixed,
    membersOk,
  };
}

// ============================================================
// Console Table Formatter
// ============================================================

function padRight(s, w) {
  const str = String(s ?? "");
  const len = [...str].length;
  if (len >= w) return str;
  return str + " ".repeat(w - len);
}

function padLeft(s, w) {
  const str = String(s ?? "");
  const len = [...str].length;
  if (len >= w) return str;
  return " ".repeat(w - len) + str;
}

function formatNum(n, digits = 3) {
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(digits);
}

function makeTable(headers, rows, colWidths) {
  const lines = [];
  const totalWidth = colWidths.reduce((s, w) => s + w + 3, 1);

  let sep = "+";
  for (const w of colWidths) sep += "-".repeat(w + 2) + "+";
  lines.push(sep);

  let header = "|";
  headers.forEach((h, i) => {
    header += " " + padRight(h, colWidths[i]) + " |";
  });
  lines.push(header);
  lines.push(sep);

  for (const row of rows) {
    let line = "|";
    row.forEach((cell, i) => {
      const isNum = typeof cell === "number" || /^[\d.,%]+$/.test(String(cell ?? ""));
      line += " " + (isNum ? padLeft(cell, colWidths[i]) : padRight(cell, colWidths[i])) + " |";
    });
    lines.push(line);
  }
  lines.push(sep);
  return lines.join("\n");
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("=".repeat(70));
  console.log("  Benchmark: syncAndRepairMemberTotals vs applyRepairPipeline");
  console.log("=".repeat(70));

  const D = 500;
  const M = 20;
  const F = 2;
  const WARMUP = 10;
  const ITER = 100;

  console.log(`\n[Setup] D=${D} donors, M=${M} members, F=${F} failures`);
  console.log(`        Warmup=${WARMUP}, Iterations=${ITER}`);
  console.log();

  // Generate datasets
  const members = generateMembers(M);
  const donors = generateDonors(D, M, F, 42);
  const state = buildState(members, donors);

  // Baseline for zero-wipe guard: state with populated member totals
  const baselineForGuard = (() => {
    const tmpMembers = members.map((m) => ({
      ...m,
      account: 1_000_000 + Math.floor(Math.random() * 5_000_000),
      toon: 500_000 + Math.floor(Math.random() * 3_000_000),
    }));
    return buildState(tmpMembers, donors);
  })();

  // Verify correctness first
  console.log("[Verify] Correctness check...");
  const baseResult = syncAndRepairMemberTotals(structuredClone(state));
  const newResult = applyRepairPipeline(structuredClone(state), baselineForGuard);

  let baseTotal = 0;
  for (const m of baseResult.members) baseTotal += (m.account || 0) + (m.toon || 0);
  let newTotal = 0;
  for (const m of newResult.members) newTotal += (m.account || 0) + (m.toon || 0);
  console.log(`  baseline total member amounts : ${baseTotal.toLocaleString()} won`);
  console.log(`  pipeline total member amounts : ${newTotal.toLocaleString()} won`);
  console.log(`  deduped donors (baseline)     : ${(baseResult.donors || []).length}`);
  console.log(`  deduped donors (pipeline)     : ${(newResult.donors || []).length}`);
  console.log();

  // Benchmarks
  console.log("[Bench] Running baseline syncAndRepairMemberTotals...");
  const benchBaseline = runBench(
    (s) => syncAndRepairMemberTotals(s),
    state,
    null,
    WARMUP,
    ITER,
    "baseline (syncAndRepairMemberTotals)"
  );

  console.log("[Bench] Running new applyRepairPipeline (4-step)...");
  const benchPipeline = runBench(
    (s, b) => applyRepairPipeline(s, b),
    state,
    baselineForGuard,
    WARMUP,
    ITER,
    "new (applyRepairPipeline 4-step)"
  );

  // MTTR (failure recovery)
  console.log("[MTTR] Measuring recovery time with F=2 corrupted donors...");
  const stateWithFailures = buildState(members, donors);
  const mttrBaseline = runMTTR(
    (s) => syncAndRepairMemberTotals(s),
    stateWithFailures,
    null,
    "baseline"
  );
  const mttrPipeline = runMTTR(
    (s, b) => applyRepairPipeline(s, b),
    stateWithFailures,
    baselineForGuard,
    "pipeline"
  );

  // Derived metrics
  const speedRatio = benchPipeline.avgMs / benchBaseline.avgMs;
  const memRatio = benchPipeline.rssPeakMB / benchBaseline.rssPeakMB;
  const ac5Pass = speedRatio <= 0.8;
  const ac6Pass = memRatio <= 0.85;

  // ======= Console Output: Tables =======
  console.log();
  console.log("=" .repeat(70));
  console.log("  PERFORMANCE RESULTS (100 iterations, warmup 10)");
  console.log("=".repeat(70));
  console.log();

  const perfHeaders = ["Metric", "Baseline (ms)", "Pipeline (ms)", "Ratio", "AC"];
  const perfWidths = [18, 18, 18, 10, 8];
  const perfRows = [
    ["Avg", formatNum(benchBaseline.avgMs), formatNum(benchPipeline.avgMs),
     `${(speedRatio * 100).toFixed(1)}%`, ac5Pass ? "PASS" : "FAIL"],
    ["Median", formatNum(benchBaseline.medianMs), formatNum(benchPipeline.medianMs),
     `${(benchPipeline.medianMs / benchBaseline.medianMs * 100).toFixed(1)}%`, ""],
    ["p95", formatNum(benchBaseline.p95Ms), formatNum(benchPipeline.p95Ms),
     `${(benchPipeline.p95Ms / benchBaseline.p95Ms * 100).toFixed(1)}%`, ""],
    ["Min", formatNum(benchBaseline.minMs), formatNum(benchPipeline.minMs), "", ""],
    ["Max", formatNum(benchBaseline.maxMs), formatNum(benchPipeline.maxMs), "", ""],
  ];
  console.log(makeTable(perfHeaders, perfRows, perfWidths));
  console.log();

  const memHeaders = ["Metric", "Baseline (MB)", "Pipeline (MB)", "Ratio", "AC"];
  const memWidths = [18, 18, 18, 10, 8];
  const memRows = [
    ["RSS Peak", formatNum(benchBaseline.rssPeakMB, 1), formatNum(benchPipeline.rssPeakMB, 1),
     `${(memRatio * 100).toFixed(1)}%`, ac6Pass ? "PASS" : "FAIL"],
    ["RSS Start", formatNum(benchBaseline.rssStartMB, 1), formatNum(benchPipeline.rssStartMB, 1), "", ""],
    ["RSS Delta", formatNum(benchBaseline.rssDeltaMB, 1), formatNum(benchPipeline.rssDeltaMB, 1), "", ""],
  ];
  console.log(makeTable(memHeaders, memRows, memWidths));
  console.log();

  const mttrHeaders = ["Target", "MTTR (ms)", "Fixed Failures", "Members Valid"];
  const mttrWidths = [18, 16, 18, 18];
  const mttrRows = [
    [mttrBaseline.label, formatNum(mttrBaseline.mttrMs),
     `${mttrBaseline.corruptedFixed} / ${F}`, mttrBaseline.membersOk ? "OK" : "FAIL"],
    [mttrPipeline.label, formatNum(mttrPipeline.mttrMs),
     `${mttrPipeline.corruptedFixed} / ${F}`, mttrPipeline.membersOk ? "OK" : "FAIL"],
  ];
  console.log(makeTable(mttrHeaders, mttrRows, mttrWidths));
  console.log();

  // Summary
  console.log("=".repeat(70));
  console.log("  ACCEPTANCE CRITERIA SUMMARY");
  console.log("=".repeat(70));
  console.log();
  console.log(`  AC-5 (Speed  ≥ 20% faster): new/baseline avg = ${(speedRatio * 100).toFixed(2)}% → ${ac5Pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  AC-6 (Memory ≤ 85% RSS) : new/baseline RSS = ${(memRatio * 100).toFixed(2)}% → ${ac6Pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log();

  // ======= Save to file =======
  const resultDir = join(PROJECT_ROOT, "result");
  await mkdir(resultDir, { recursive: true });
  const outPath = join(resultDir, "bench-assemble-result.txt");

  const outLines = [];
  const timestamp = new Date().toISOString();
  outLines.push("=" .repeat(72));
  outLines.push("  BENCHMARK RESULT: syncAndRepairMemberTotals vs applyRepairPipeline");
  outLines.push(`  Generated: ${timestamp}`);
  outLines.push("=".repeat(72));
  outLines.push("");
  outLines.push(`[Setup]`);
  outLines.push(`  Donors (D)        : ${D}`);
  outLines.push(`  Members (M)       : ${M}`);
  outLines.push(`  Failures (F)      : ${F}`);
  outLines.push(`  Warmup iterations : ${WARMUP}`);
  outLines.push(`  Run iterations    : ${ITER}`);
  outLines.push("");
  outLines.push(`[Correctness]`);
  outLines.push(`  baseline total member amounts : ${baseTotal.toLocaleString()} won`);
  outLines.push(`  pipeline total member amounts : ${newTotal.toLocaleString()} won`);
  outLines.push(`  baseline deduped donor count  : ${(baseResult.donors || []).length}`);
  outLines.push(`  pipeline deduped donor count  : ${(newResult.donors || []).length}`);
  outLines.push("");
  outLines.push("=".repeat(72));
  outLines.push("  PERFORMANCE (Latency)");
  outLines.push("=".repeat(72));
  outLines.push("");
  outLines.push(makeTable(perfHeaders, perfRows, perfWidths));
  outLines.push("");
  outLines.push("=".repeat(72));
  outLines.push("  MEMORY (RSS)");
  outLines.push("=".repeat(72));
  outLines.push("");
  outLines.push(makeTable(memHeaders, memRows, memWidths));
  outLines.push("");
  outLines.push("=".repeat(72));
  outLines.push("  MTTR (Mean Time To Repair — F=2 failures)");
  outLines.push("=".repeat(72));
  outLines.push("");
  outLines.push(makeTable(mttrHeaders, mttrRows, mttrWidths));
  outLines.push("");
  outLines.push("=".repeat(72));
  outLines.push("  ACCEPTANCE CRITERIA");
  outLines.push("=".repeat(72));
  outLines.push("");
  outLines.push(`  AC-5 (Speed ≥ 20% faster)`);
  outLines.push(`    condition : (pipeline.avgMs / baseline.avgMs) <= 0.80`);
  outLines.push(`    actual    : ${speedRatio.toFixed(4)} (${(speedRatio*100).toFixed(2)}%)`);
  outLines.push(`    result    : ${ac5Pass ? "PASS" : "FAIL"}`);
  outLines.push("");
  outLines.push(`  AC-6 (Memory <= 85% baseline RSS)`);
  outLines.push(`    condition : (pipeline.RSSpeak / baseline.RSSpeak) <= 0.85`);
  outLines.push(`    actual    : ${memRatio.toFixed(4)} (${(memRatio*100).toFixed(2)}%)`);
  outLines.push(`    result    : ${ac6Pass ? "PASS" : "FAIL"}`);
  outLines.push("");
  outLines.push("=".repeat(72));
  outLines.push("  Raw Metrics");
  outLines.push("=".repeat(72));
  outLines.push("");
  outLines.push(`baseline_avg_ms=${benchBaseline.avgMs.toFixed(4)}`);
  outLines.push(`baseline_median_ms=${benchBaseline.medianMs.toFixed(4)}`);
  outLines.push(`baseline_p95_ms=${benchBaseline.p95Ms.toFixed(4)}`);
  outLines.push(`baseline_min_ms=${benchBaseline.minMs.toFixed(4)}`);
  outLines.push(`baseline_max_ms=${benchBaseline.maxMs.toFixed(4)}`);
  outLines.push(`baseline_rss_peak_mb=${benchBaseline.rssPeakMB.toFixed(3)}`);
  outLines.push(`baseline_rss_start_mb=${benchBaseline.rssStartMB.toFixed(3)}`);
  outLines.push(`baseline_rss_delta_mb=${benchBaseline.rssDeltaMB.toFixed(3)}`);
  outLines.push("");
  outLines.push(`pipeline_avg_ms=${benchPipeline.avgMs.toFixed(4)}`);
  outLines.push(`pipeline_median_ms=${benchPipeline.medianMs.toFixed(4)}`);
  outLines.push(`pipeline_p95_ms=${benchPipeline.p95Ms.toFixed(4)}`);
  outLines.push(`pipeline_min_ms=${benchPipeline.minMs.toFixed(4)}`);
  outLines.push(`pipeline_max_ms=${benchPipeline.maxMs.toFixed(4)}`);
  outLines.push(`pipeline_rss_peak_mb=${benchPipeline.rssPeakMB.toFixed(3)}`);
  outLines.push(`pipeline_rss_start_mb=${benchPipeline.rssStartMB.toFixed(3)}`);
  outLines.push(`pipeline_rss_delta_mb=${benchPipeline.rssDeltaMB.toFixed(3)}`);
  outLines.push("");
  outLines.push(`speed_ratio_pipeline_vs_baseline=${speedRatio.toFixed(4)}`);
  outLines.push(`memory_ratio_pipeline_vs_baseline=${memRatio.toFixed(4)}`);
  outLines.push(`ac5_pass=${ac5Pass}`);
  outLines.push(`ac6_pass=${ac6Pass}`);
  outLines.push("");
  outLines.push(`mttr_baseline_ms=${mttrBaseline.mttrMs.toFixed(4)}`);
  outLines.push(`mttr_baseline_corrupted_fixed=${mttrBaseline.corruptedFixed}/${F}`);
  outLines.push(`mttr_baseline_members_valid=${mttrBaseline.membersOk}`);
  outLines.push(`mttr_pipeline_ms=${mttrPipeline.mttrMs.toFixed(4)}`);
  outLines.push(`mttr_pipeline_corrupted_fixed=${mttrPipeline.corruptedFixed}/${F}`);
  outLines.push(`mttr_pipeline_members_valid=${mttrPipeline.membersOk}`);
  outLines.push("");

  await writeFile(outPath, outLines.join("\n"), "utf8");
  console.log(`[Output] Saved to: ${outPath}`);
  console.log();

  return {
    scriptCreated: true,
    loc: (new Error().stack?.split("\n").length) || 0,
    executed: true,
    baselineAvgMs: benchBaseline.avgMs,
    pipelineAvgMs: benchPipeline.avgMs,
    speedRatio,
    baselineRssMB: benchBaseline.rssPeakMB,
    pipelineRssMB: benchPipeline.rssPeakMB,
    memRatio,
    ac5Pass,
    ac6Pass,
  };
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
