/**
 * 상류사회 영토 보드 계산.
 * 화면 cm 이 정본이다. 후원 저장은 이 보드를 건드리지 않는다.
 * 0.1cm 단위. 자리에 앉은 합은 보드 총합과 같다.
 * 대기(보드 밖) 보유 cm 는 자리 합을 깎지 않는다.
 */
(function (root) {
  function toTenths(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * 10);
  }

  function fromTenths(t) {
    return Math.round(Number(t) || 0) / 10;
  }

  function formatCm(n) {
    const s = Math.max(0, Number(n) || 0).toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  }

  function formatSignedCm(n) {
    const v = fromTenths(toTenths(n));
    const body = formatCm(Math.abs(v));
    if (v > 0) return `+${body}`;
    if (v < 0) return `-${body}`;
    return "0";
  }

  function clampBoardTotal(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return 400;
    return Math.max(1, Math.min(1_000_000, v));
  }

  function boardTotal(state) {
    return clampBoardTotal(state && state.boardTotalCm);
  }

  function uniqueMemberIds(state) {
    return Object.keys((state && state.members) || {}).filter((id) => /^[A-Z]$/.test(id));
  }

  function isSeated(state, id) {
    return ((state && state.activeOrder) || []).includes(id);
  }

  function seatedIds(state) {
    return ((state && state.activeOrder) || []).filter((id) => state.members && state.members[id]);
  }

  function seatedSumCm(state) {
    return fromTenths(
      seatedIds(state).reduce((sum, id) => sum + toTenths(state.members[id].cm), 0)
    );
  }

  function setMemberCm(state, id, cm) {
    if (!state.members || !state.members[id]) return;
    state.members[id].cm = fromTenths(Math.max(0, toTenths(cm)));
  }

  function snapRosterCm(state) {
    Object.keys(state.members || {}).forEach((id) => setMemberCm(state, id, state.members[id].cm));
  }

  function splitTenths(ids, remainT, weights) {
    const n = ids.length;
    if (!n) return [];
    const need = Math.max(0, Math.round(Number(remainT) || 0));
    if (need <= 0) return ids.map(() => 0);
    let w = (weights || []).map((x) => Math.max(0, Math.round(Number(x) || 0)));
    let wsum = w.reduce((a, b) => a + b, 0);
    if (wsum <= 0) w = ids.map(() => 1);
    wsum = w.reduce((a, b) => a + b, 0);
    const raw = w.map((x) => (need * x) / wsum);
    const floors = raw.map((v) => Math.floor(v + 1e-9));
    let leftover = need - floors.reduce((a, b) => a + b, 0);
    const order = raw
      .map((v, i) => ({ i, frac: v - Math.floor(v + 1e-9) }))
      .sort((a, b) => b.frac - a.frac);
    const extra = new Array(n).fill(0);
    for (let k = 0; k < leftover; k += 1) extra[order[k % n].i] += 1;
    return floors.map((f, i) => f + extra[i]);
  }

  /** 자리에 앉은 사람에게서만 가져간다. 대기 보유분은 깎지 않는다. */
  function takeTenthsFromOthers(state, exceptId, needT) {
    let left = Math.max(0, needT);
    const ids = seatedIds(state).filter((id) => id !== exceptId);
    let guard = 0;
    while (left > 0 && guard < 20) {
      guard += 1;
      const holders = ids.filter((id) => toTenths(state.members[id].cm) > 0);
      if (!holders.length) break;
      const weights = holders.map((id) => toTenths(state.members[id].cm));
      const have = weights.reduce((a, b) => a + b, 0);
      const plan = splitTenths(holders, Math.min(left, have), weights);
      plan.forEach((t, i) => {
        const id = holders[i];
        const haveT = toTenths(state.members[id].cm);
        const take = Math.min(haveT, t);
        setMemberCm(state, id, fromTenths(haveT - take));
        left -= take;
      });
    }
    return needT - left;
  }

  function giveTenthsToOthers(state, exceptId, giveT) {
    const left = Math.max(0, giveT);
    if (!left) return 0;
    const targets = seatedIds(state).filter((id) => id !== exceptId);
    if (!targets.length) return 0;
    const weights = targets.map((id) => toTenths(state.members[id].cm));
    const plan = splitTenths(targets, left, weights);
    plan.forEach((t, i) => {
      const id = targets[i];
      setMemberCm(state, id, fromTenths(toTenths(state.members[id].cm) + t));
    });
    return left;
  }

  /**
   * 자리 안 부여·지정은 보드 합을 유지하고, 대기 부여는 그 사람 보유만 바꾼다.
   * 반환값은 실제로 변한 cm.
   */
  function shiftMemberCm(state, id, deltaT) {
    if (!state.members || !state.members[id] || !deltaT) return 0;
    const curT = toTenths(state.members[id].cm);
    if (!isSeated(state, id)) {
      const nextT = Math.max(0, curT + deltaT);
      setMemberCm(state, id, fromTenths(nextT));
      return fromTenths(nextT - curT);
    }
    const totalT = toTenths(boardTotal(state));
    const nextT = Math.max(0, Math.min(totalT, curT + deltaT));
    const actual = nextT - curT;
    if (actual < 0 && !seatedIds(state).some((sid) => sid !== id)) return 0;
    setMemberCm(state, id, fromTenths(nextT));
    if (actual > 0) takeTenthsFromOthers(state, id, actual);
    else if (actual < 0) giveTenthsToOthers(state, id, -actual);
    return fromTenths(actual);
  }

  function enforceBoardTotal(state) {
    snapRosterCm(state);
    const ids = seatedIds(state);
    if (!ids.length) return;
    const totalT = toTenths(boardTotal(state));
    let sumT = ids.reduce((s, id) => s + toTenths(state.members[id].cm), 0);
    let drift = totalT - sumT;
    if (drift === 0) return;
    const ranked = ids.slice().sort((a, b) => toTenths(state.members[b].cm) - toTenths(state.members[a].cm));
    let guard = 0;
    while (drift !== 0 && guard < 10000) {
      guard += 1;
      const step = drift > 0 ? 1 : -1;
      const pick = ranked.find((id) => {
        const t = toTenths(state.members[id].cm);
        if (step < 0 && t <= 0) return false;
        if (step > 0 && t >= totalT) return false;
        return true;
      });
      if (!pick) break;
      setMemberCm(state, pick, fromTenths(toTenths(state.members[pick].cm) + step));
      drift -= step;
    }
  }

  function applyEqualShares(state, ids, total) {
    const list = (ids || []).filter((id) => state.members && state.members[id]);
    const n = list.length;
    if (!n) return;
    const need = toTenths(total);
    const each = Math.floor(need / n);
    let extra = need - each * n;
    list.forEach((id) => {
      const add = extra > 0 ? 1 : 0;
      extra -= add;
      setMemberCm(state, id, fromTenths(each + add));
    });
  }

  /** 전원 1/N. 이미 앉은 순서는 유지하고, 대기 멤버는 오른쪽 끝에 붙인다. */
  function applyEqualToState(state) {
    if (!Array.isArray(state.activeOrder)) state.activeOrder = [];
    const ids = uniqueMemberIds(state);
    if (!ids.length) return [];
    const prev = state.activeOrder.filter((id) => state.members[id]);
    const waiting = ids.filter((id) => !prev.includes(id));
    applyEqualShares(state, ids, boardTotal(state));
    state.activeOrder = [...prev, ...waiting].filter((id, i, arr) => {
      return state.members[id] && arr.indexOf(id) === i && (Number(state.members[id].cm) || 0) > 0;
    });
    return waiting.filter((id) => state.activeOrder.includes(id));
  }

  function seatIds(state) {
    const members = state.members || {};
    const seen = new Set();
    const order = [];
    (Array.isArray(state.activeOrder) ? state.activeOrder : []).forEach((id) => {
      if (!members[id] || seen.has(id)) return;
      if ((Number(members[id].cm) || 0) <= 0) return;
      seen.add(id);
      order.push(id);
    });
    return order;
  }

  function takeFrom(state, victimId, attackerId, amount) {
    if (!state.members[victimId] || !state.members[attackerId]) return 0;
    const takeT = Math.min(toTenths(state.members[victimId].cm), toTenths(amount));
    setMemberCm(state, victimId, fromTenths(toTenths(state.members[victimId].cm) - takeT));
    setMemberCm(state, attackerId, fromTenths(toTenths(state.members[attackerId].cm) + takeT));
    return fromTenths(takeT);
  }

  function takeChain(state, ids, attackerId, needT) {
    let left = Math.max(0, Math.round(Number(needT) || 0));
    let taken = 0;
    (ids || []).forEach((id) => {
      if (left <= 0 || !state.members[id]) return;
      const gotT = toTenths(takeFrom(state, id, attackerId, fromTenths(left)));
      taken += gotT;
      left -= gotT;
    });
    return taken;
  }

  function checkElimination(state) {
    state.activeOrder = (state.activeOrder || []).filter((id) => {
      if (!state.members[id]) return false;
      if (state.members[id].cm <= 0) {
        state.members[id].cm = 0;
        return false;
      }
      return true;
    });
  }

  /**
   * 뺏기. 넣은 양만큼 가져가되, 남의 땅이 모자라면 있는 만큼만.
   * 보드 총합은 넘지 않는다.
   * 2명: 상대 한 명.
   * 끝: 안쪽으로 이어서.
   * 가운데: 먼저 좌우 반반, 한쪽이 모자라면 반대편에서 나머지를 채운다.
   */
  function steal(state, targetId, amountCm) {
    const amountT = toTenths(amountCm);
    if (!amountT) return { ok: false, reason: "empty", takenCm: 0 };
    const order = state.activeOrder || [];
    const idx = order.indexOf(targetId);
    if (idx === -1) return { ok: false, reason: "off-board", takenCm: 0 };
    let takenT = 0;
    if (order.length === 2) {
      const opponentId = order[idx === 0 ? 1 : 0];
      takenT = toTenths(takeFrom(state, opponentId, targetId, fromTenths(amountT)));
    } else if (idx === 0) {
      takenT = takeChain(state, order.slice(1), targetId, amountT);
    } else if (idx === order.length - 1) {
      takenT = takeChain(state, order.slice(0, idx).reverse(), targetId, amountT);
    } else {
      const leftIds = order.slice(0, idx).reverse();
      const rightIds = order.slice(idx + 1);
      const leftT = Math.floor(amountT / 2);
      const rightT = amountT - leftT;
      takenT = takeChain(state, leftIds, targetId, leftT)
        + takeChain(state, rightIds, targetId, rightT);
      if (takenT < amountT) {
        takenT += takeChain(state, leftIds, targetId, amountT - takenT);
      }
      if (takenT < amountT) {
        takenT += takeChain(state, rightIds, targetId, amountT - takenT);
      }
    }
    if (takenT <= 0) return { ok: false, reason: "short", takenCm: 0 };
    checkElimination(state);
    return { ok: true, takenCm: fromTenths(takenT) };
  }

  function drainChain(state, ids, needT) {
    let left = Math.max(0, Math.round(Number(needT) || 0));
    const parts = [];
    (ids || []).forEach((vid) => {
      if (left <= 0 || !state.members[vid]) return;
      const haveT = toTenths(state.members[vid].cm);
      const takeT = Math.min(haveT, left);
      if (takeT <= 0) return;
      setMemberCm(state, vid, fromTenths(haveT - takeT));
      parts.push({ id: vid, cm: fromTenths(takeT) });
      left -= takeT;
    });
    return parts;
  }

  /**
   * 벽 진입. 고른 쪽 끝부터 부여분(+추가)을 가져간다.
   * 끝이 모자라면 안쪽 사람에게 이어진다.
   * 보드가 비어 있으면 부여한 cm 를 그대로 들고 앉는다.
   */
  function revive(state, id, side, extraCm) {
    if (!state.members || !state.members[id]) return { ok: false, reason: "missing" };
    if ((state.activeOrder || []).includes(id)) return { ok: false, reason: "seated" };
    const pending = Math.max(0, Number(state.members[id].cm) || 0);
    if (pending <= 0) return { ok: false, reason: "empty" };
    const extraT = Number.isFinite(Number(extraCm)) && Number(extraCm) > 0 ? toTenths(extraCm) : 0;
    const order = Array.isArray(state.activeOrder) ? state.activeOrder.slice() : [];
    const sideLabel = side === "left" ? "좌측" : "우측";
    let parts = [];
    if (order.length) {
      const chain = side === "left" ? order : order.slice().reverse();
      parts = drainChain(state, chain, toTenths(state.members[id].cm) + extraT);
      setMemberCm(state, id, fromTenths(parts.reduce((sum, part) => sum + toTenths(part.cm), 0)));
    }
    if (!Array.isArray(state.activeOrder)) state.activeOrder = [];
    if (side === "left") state.activeOrder.unshift(id);
    else state.activeOrder.push(id);
    checkElimination(state);
    const takenCm = fromTenths(parts.reduce((sum, part) => sum + toTenths(part.cm), 0));
    const name = state.members[id].name || id;
    const detail = parts
      .map((part) => `${state.members[part.id]?.name || part.id} ${formatCm(part.cm)}cm`)
      .join(" · ");
    const note = detail
      ? `${name} ${sideLabel} 벽 진입 · ${detail}`
      : `${name} ${sideLabel} 벽 진입`;
    return { ok: true, takenCm, pending, parts, note };
  }

  function swap(state, id, otherId) {
    if (!id || !otherId || id === otherId) return { ok: false };
    const a = state.members && state.members[id];
    const b = state.members && state.members[otherId];
    if (!a || !b) return { ok: false };
    const order = Array.isArray(state.activeOrder) ? state.activeOrder : [];
    const ia = order.indexOf(id);
    const ib = order.indexOf(otherId);
    if (ia < 0 || ib < 0) return { ok: false };
    order[ia] = otherId;
    order[ib] = id;
    const cmA = fromTenths(toTenths(a.cm));
    const cmB = fromTenths(toTenths(b.cm));
    a.cm = cmB;
    b.cm = cmA;
    return { ok: true, cmA: b.cm, cmB: a.cm };
  }

  function patchMember(state, id, field, value) {
    if (!state.members || !state.members[id]) return false;
    if (field === "name") {
      state.members[id].name = String(value || "").slice(0, 40);
      return true;
    }
    if (field === "color") {
      const color = String(value || "");
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return false;
      state.members[id].color = color;
      return true;
    }
    return false;
  }

  const api = {
    toTenths,
    fromTenths,
    formatCm,
    formatSignedCm,
    clampBoardTotal,
    boardTotal,
    uniqueMemberIds,
    seatedSumCm,
    setMemberCm,
    shiftMemberCm,
    enforceBoardTotal,
    applyEqualToState,
    seatIds,
    steal,
    revive,
    swap,
    patchMember,
    checkElimination,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ShangliuBoard = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
