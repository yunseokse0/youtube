import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const Board = require("../../public/shangliu-board.js");

type Member = { name: string; color: string; cm: number };
type BoardState = {
  boardTotalCm: number;
  activeOrder: string[];
  members: Record<string, Member>;
};

function board(partial: {
  total?: number;
  order: string[];
  members: Record<string, number | Member>;
}): BoardState {
  const members: Record<string, Member> = {};
  for (const [id, row] of Object.entries(partial.members)) {
    members[id] = typeof row === "number"
      ? { name: id, color: "#888888", cm: row }
      : { ...row };
  }
  return {
    boardTotalCm: partial.total ?? 480,
    activeOrder: partial.order.slice(),
    members,
  };
}

function cmOf(state: BoardState) {
  return Object.fromEntries(Object.entries(state.members).map(([id, m]) => [m.name || id, m.cm]));
}

describe("상류사회 영토", () => {
  it("차감 기록은 빼기 부호를 남긴다", () => {
    expect(Board.formatSignedCm(-6)).toBe("-6");
    expect(Board.formatSignedCm(10.25)).toBe("+10.3");
    expect(Board.formatSignedCm(0)).toBe("0");
    expect(Board.formatCm(-6)).toBe("0");
  });

  it("0.1cm 단위로만 저장한다", () => {
    const state = board({ order: ["A"], members: { A: 10 } });
    Board.setMemberCm(state, "A", 10.24);
    expect(state.members.A.cm).toBe(10.2);
    Board.setMemberCm(state, "A", 10.25);
    expect(state.members.A.cm).toBe(10.3);
    expect(Board.fromTenths(Board.toTenths(7.5))).toBe(7.5);
  });

  it("대기 보유 cm 를 줄여도 앉아 있는 땅은 그대로다", () => {
    const state = board({
      order: ["A"],
      members: { A: { name: "수린", color: "#00f3ff", cm: 480 }, B: { name: "자키", color: "#ff007f", cm: 15 } },
    });
    const actual = Board.shiftMemberCm(state, "B", Board.toTenths(-6));
    Board.enforceBoardTotal(state);
    expect(actual).toBe(-6);
    expect(state.members.B.cm).toBe(9);
    expect(state.members.A.cm).toBe(480);
    expect(state.activeOrder).toEqual(["A"]);
  });

  it("대기 멤버에게 부여해도 앉아 있는 땅은 깎지 않는다", () => {
    const state = board({
      order: ["F", "B"],
      members: {
        F: { name: "방승연", color: "#ff6b00", cm: 10 },
        B: { name: "수린", color: "#00f3ff", cm: 470 },
        D: { name: "열음", color: "#b700ff", cm: 0 },
      },
    });
    const actual = Board.shiftMemberCm(state, "D", Board.toTenths(10));
    Board.enforceBoardTotal(state);
    expect(actual).toBe(10);
    expect(cmOf(state)).toMatchObject({ 방승연: 10, 수린: 470, 열음: 10 });
    expect(state.activeOrder).toEqual(["F", "B"]);
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("자리에 앉은 사람에게 부여하면 다른 자리만 깎고 대기는 그대로다", () => {
    const state = board({
      order: ["C", "B"],
      members: {
        C: { name: "신연서", color: "#ffdf00", cm: 80 },
        B: { name: "수린", color: "#00f3ff", cm: 400 },
        A: { name: "자키", color: "#ff007f", cm: 15 },
      },
    });
    Board.shiftMemberCm(state, "C", Board.toTenths(10));
    Board.enforceBoardTotal(state);
    expect(state.members.C.cm).toBe(90);
    expect(state.members.B.cm).toBe(390);
    expect(state.members.A.cm).toBe(15);
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("0cm 인 사람은 벽을 고르기 전에는 자리에 없다", () => {
    const state = board({
      order: ["B", "A"],
      members: { B: 100, A: 0, C: 0 },
    });
    state.activeOrder = ["B", "A", "C"];
    expect(Board.seatIds(state)).toEqual(["B"]);
  });

  it("전원 1/N 은 대기 멤버도 같은 몫으로 오른쪽 끝에 앉힌다", () => {
    const state = board({
      order: ["E", "B", "F", "D"],
      members: {
        E: { name: "백고은", color: "#ffffff", cm: 140 },
        B: { name: "수린", color: "#22d3ee", cm: 200 },
        F: { name: "방승연", color: "#f97316", cm: 90 },
        D: { name: "열음", color: "#a855f7", cm: 50 },
        A: { name: "자키", color: "#ec4899", cm: 0 },
        C: { name: "신연서", color: "#eab308", cm: 0 },
      },
    });
    const joined = Board.applyEqualToState(state);
    expect(joined).toEqual(["A", "C"]);
    expect(state.activeOrder).toEqual(["E", "B", "F", "D", "A", "C"]);
    for (const id of state.activeOrder) expect(state.members[id].cm).toBe(80);
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("균등 분배의 0.1cm 나머지는 앞사람에게 준다", () => {
    const state = board({
      total: 100,
      order: ["A", "B", "C"],
      members: { A: 10, B: 20, C: 70 },
    });
    Board.applyEqualToState(state);
    expect(state.members.A.cm).toBe(33.4);
    expect(state.members.B.cm).toBe(33.3);
    expect(state.members.C.cm).toBe(33.3);
    expect(Board.seatedSumCm(state)).toBe(100);
  });

  it("끝에서 뺏으면 안쪽으로 이어지고 자리는 그대로다", () => {
    const state = board({
      order: ["B", "A", "C"],
      members: {
        B: { name: "수린", color: "#00f3ff", cm: 312.5 },
        A: { name: "자키", color: "#ff007f", cm: 100 },
        C: { name: "신연서", color: "#ffdf00", cm: 67.5 },
      },
    });
    const result = Board.steal(state, "B", 168);
    expect(result).toMatchObject({ ok: true, takenCm: 167.5 });
    expect(state.activeOrder).toEqual(["B"]);
    expect(cmOf(state)).toMatchObject({ 수린: 480, 자키: 0, 신연서: 0 });
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("두 명일 때는 상대 한 명의 땅만 뺏는다", () => {
    const state = board({
      order: ["B", "C"],
      members: {
        B: { name: "수린", color: "#00f3ff", cm: 400 },
        C: { name: "신연서", color: "#ffdf00", cm: 80 },
      },
    });
    const result = Board.steal(state, "B", 100);
    expect(result.takenCm).toBe(80);
    expect(state.activeOrder).toEqual(["B"]);
    expect(state.members.B.cm).toBe(480);
  });

  it("가운데 뺏기는 좌우 반반이고 모자란 쪽은 그 방향으로만 이어진다", () => {
    const state = board({
      total: 220,
      order: ["A", "B", "C", "D", "E"],
      members: { A: 10, B: 50, C: 100, D: 40, E: 20 },
    });
    const result = Board.steal(state, "C", 120);
    expect(result.takenCm).toBe(120);
    expect(state.members.C.cm).toBe(220);
    expect(state.activeOrder).toEqual(["C"]);
  });

  it("가운데 반쪽에서 모자라더라도 반대편 땅을 대신 뺏지 않는다", () => {
    const state = board({
      total: 175,
      order: ["A", "B", "C"],
      members: {
        A: { name: "백고은", color: "#ffffff", cm: 10 },
        B: { name: "수린", color: "#00f3ff", cm: 97.5 },
        C: { name: "신연서", color: "#ffdf00", cm: 67.5 },
      },
    });
    const result = Board.steal(state, "B", 77.5);
    expect(result.takenCm).toBe(48.8);
    expect(state.members.A.cm).toBe(0);
    expect(state.members.C.cm).toBe(28.7);
    expect(state.members.B.cm).toBe(146.3);
    expect(Board.seatedSumCm(state)).toBe(175);
  });

  it("0.1cm 가운데 뺏기는 오른쪽 0.1만 가져간다", () => {
    const state = board({
      total: 30,
      order: ["A", "B", "C"],
      members: { A: 10, B: 10, C: 10 },
    });
    const result = Board.steal(state, "B", 0.1);
    expect(result.takenCm).toBe(0.1);
    expect(state.members.A.cm).toBe(10);
    expect(state.members.C.cm).toBe(9.9);
    expect(state.members.B.cm).toBe(10.1);
  });

  it("땅이 없으면 뺏지 않고 기록할 양도 생기지 않는다", () => {
    const state = board({
      order: ["A", "B"],
      members: { A: 480, B: 0 },
    });
    state.activeOrder = ["A"];
    expect(Board.steal(state, "A", 10)).toMatchObject({ ok: false, takenCm: 0 });
    expect(state.members.A.cm).toBe(480);
  });

  it("수린 15 부여 후 우측 진입은 끝 10과 그 안쪽 5를 함께 가져간다", () => {
    const state = board({
      order: ["C", "E", "D"],
      members: {
        C: { name: "신연서", color: "#ffdf00", cm: 10 },
        E: { name: "백고은", color: "#39ff14", cm: 460 },
        D: { name: "열음", color: "#b700ff", cm: 10 },
        B: { name: "수린", color: "#00f3ff", cm: 0 },
      },
    });
    expect(Board.shiftMemberCm(state, "B", Board.toTenths(15))).toBe(15);
    expect(state.members.E.cm).toBe(460);
    const result = Board.revive(state, "B", "right", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.takenCm).toBe(15);
    expect(result.note).toBe("수린 우측 벽 진입 · 열음 10cm · 백고은 5cm");
    expect(state.activeOrder).toEqual(["C", "E", "B"]);
    expect(cmOf(state)).toMatchObject({ 신연서: 10, 백고은: 455, 열음: 0, 수린: 15 });
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("좌측 진입도 끝이 모자라면 오른쪽으로 이어진다", () => {
    const state = board({
      total: 110,
      order: ["A", "B"],
      members: {
        A: { name: "가", color: "#111111", cm: 10 },
        B: { name: "나", color: "#222222", cm: 100 },
        C: { name: "다", color: "#333333", cm: 25 },
      },
    });
    const result = Board.revive(state, "C", "left", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toBe("다 좌측 벽 진입 · 가 10cm · 나 15cm");
    expect(state.activeOrder).toEqual(["C", "B"]);
    expect(state.members.C.cm).toBe(25);
    expect(state.members.B.cm).toBe(85);
    expect(Board.seatedSumCm(state)).toBe(110);
  });

  it("빈 보드에 들어오면 부여한 cm 를 그대로 들고 앉는다", () => {
    const state = board({
      total: 8,
      order: [],
      members: { D: { name: "라", color: "#444444", cm: 8 } },
    });
    const result = Board.revive(state, "D", "right", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toBe("라 우측 벽 진입");
    expect(state.activeOrder).toEqual(["D"]);
    expect(state.members.D.cm).toBe(8);
  });

  it("추가 뺏기 cm 도 같은 방향으로 이어 가져간다", () => {
    const state = board({
      order: ["A", "B"],
      members: {
        A: { name: "안", color: "#111111", cm: 470 },
        B: { name: "끝", color: "#222222", cm: 10 },
        C: { name: "새", color: "#333333", cm: 15 },
      },
    });
    const result = Board.revive(state, "C", "right", 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.takenCm).toBe(20);
    expect(state.members.B.cm).toBe(0);
    expect(state.members.A.cm).toBe(460);
    expect(state.members.C.cm).toBe(20);
    expect(state.activeOrder).toEqual(["A", "C"]);
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("보드 전체가 모자라면 실제로 가져온 cm 만 들고 나머지는 버린다", () => {
    const state = board({
      total: 7,
      order: ["A", "B"],
      members: {
        A: { name: "가", color: "#111111", cm: 3 },
        B: { name: "나", color: "#222222", cm: 4 },
        C: { name: "다", color: "#333333", cm: 20 },
      },
    });
    const result = Board.revive(state, "C", "right", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.takenCm).toBe(7);
    expect(state.activeOrder).toEqual(["C"]);
    expect(state.members.C.cm).toBe(7);
  });

  it("땅이 없거나 이미 앉아 있으면 벽을 열지 않는다", () => {
    const state = board({
      order: ["A"],
      members: { A: 480, B: 0 },
    });
    expect(Board.revive(state, "B", "left", 0)).toMatchObject({ ok: false, reason: "empty" });
    expect(Board.revive(state, "A", "right", 0)).toMatchObject({ ok: false, reason: "seated" });
    expect(state.activeOrder).toEqual(["A"]);
  });

  it("땅 교환은 자리와 cm 를 맞바꾼다", () => {
    const state = board({
      order: ["A", "B", "C"],
      members: {
        A: { name: "자키", color: "#ff007f", cm: 60 },
        B: { name: "수린", color: "#00f3ff", cm: 100 },
        C: { name: "신연서", color: "#ffdf00", cm: 320 },
      },
    });
    const result = Board.swap(state, "A", "C");
    expect(result.ok).toBe(true);
    expect(state.activeOrder).toEqual(["C", "B", "A"]);
    expect(state.members.A.cm).toBe(320);
    expect(state.members.C.cm).toBe(60);
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("이름과 색만 바꿔도 cm 와 자리는 유지된다", () => {
    const state = board({
      order: ["A", "B"],
      members: {
        A: { name: "자키", color: "#111111", cm: 80 },
        B: { name: "수린", color: "#222222", cm: 400 },
      },
    });
    expect(Board.patchMember(state, "A", "name", "백고은")).toBe(true);
    expect(Board.patchMember(state, "A", "color", "#ffffff")).toBe(true);
    expect(Board.patchMember(state, "A", "color", "white")).toBe(false);
    expect(state.members.A.name).toBe("백고은");
    expect(state.members.A.color).toBe("#ffffff");
    expect(state.members.A.cm).toBe(80);
    expect(state.activeOrder).toEqual(["A", "B"]);
  });

  it("혼자 앉은 땅을 줄여도 대기 멤버에게 복사되지 않고 보드 합은 유지된다", () => {
    const state = board({
      order: ["A"],
      members: {
        A: { name: "수린", color: "#00f3ff", cm: 480 },
        B: { name: "자키", color: "#ff007f", cm: 0 },
      },
    });
    const actual = Board.shiftMemberCm(state, "A", Board.toTenths(-80));
    Board.enforceBoardTotal(state);
    expect(actual).toBe(0);
    expect(state.members.A.cm).toBe(480);
    expect(state.members.B.cm).toBe(0);
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("앉아 있는 사람을 줄이면 다른 자리로만 넘어가고 대기는 그대로다", () => {
    const state = board({
      order: ["A", "B"],
      members: {
        A: { name: "수린", color: "#00f3ff", cm: 400 },
        B: { name: "신연서", color: "#ffdf00", cm: 80 },
        C: { name: "자키", color: "#ff007f", cm: 0 },
      },
    });
    Board.shiftMemberCm(state, "A", Board.toTenths(-50));
    Board.enforceBoardTotal(state);
    expect(state.members.A.cm).toBe(350);
    expect(state.members.B.cm).toBe(130);
    expect(state.members.C.cm).toBe(0);
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("자리 합은 대기 보유 cm 를 세지 않는다", () => {
    const state = board({
      order: ["A", "B"],
      members: { A: 200, B: 280, C: 15 },
    });
    expect(Board.seatedSumCm(state)).toBe(480);
  });

  it("관리 화면은 이 계산 파일을 벽 진입과 뺏기에 쓴다", () => {
    const html = readFileSync(path.join(process.cwd(), "public/admin.html"), "utf8");
    expect(html).toContain("/shangliu-board.js");
    expect(html).toContain("ShangliuBoard.steal");
    expect(html).toContain("ShangliuBoard.revive");
    expect(html).toContain("ShangliuBoard.applyEqualToState");
    expect(html).not.toContain("function drainChain");
    expect(html).not.toContain("function takeChain");
  });
});
