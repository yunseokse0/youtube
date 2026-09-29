import { describe, expect, it } from "vitest";
import {
  DONOR_LIST_MIN_PAGE_SIZE,
  DONOR_PAGE_SIZES,
  buildDonorListPageItems,
  donorMemberSelectOptions,
  sliceDonorListPage,
  sortDonorsNewestFirst,
} from "@/lib/donor-list-pagination";

type Row = { id: string; at: number; name: string };

function rows(n: number, startAt = 1_000): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `d${i + 1}`,
    at: startAt + i,
    name: `n${i + 1}`,
  }));
}

describe("후원자 리스트 페이지네이션 · 수신 중 누락/흔들림", () => {
  it("페이지당은 50·100·300만 있고 최소는 50이다", () => {
    expect(DONOR_PAGE_SIZES).toEqual([50, 100, 300]);
    expect(DONOR_LIST_MIN_PAGE_SIZE).toBe(50);
    expect(sliceDonorListPage(rows(10), 1, 20).visible).toHaveLength(10);
    expect(sliceDonorListPage(rows(80), 1, 20).visible).toHaveLength(50);
  });

  it("새 후원이 들어와도 보고 있던 페이지 번호는 유지되고, 새 건은 전체 목록에 남는다", () => {
    const page = 2;
    const before = sortDonorsNewestFirst(rows(120));
    const watching = sliceDonorListPage(before, page, 50);
    expect(watching.pageIdx).toBe(2);
    expect(watching.visible).toHaveLength(50);

    const incoming: Row[] = [
      { id: "new-a", at: 9_000, name: "신규A" },
      { id: "new-b", at: 9_001, name: "신규B" },
      { id: "new-c", at: 9_002, name: "신규C" },
    ];
    const after = sortDonorsNewestFirst([...before, ...incoming]);
    const stillPage2 = sliceDonorListPage(after, page, 50);

    expect(after.map((d) => d.id)).toEqual(expect.arrayContaining(["new-a", "new-b", "new-c"]));
    expect(after).toHaveLength(123);
    expect(stillPage2.pageIdx).toBe(2);
    expect(stillPage2.totalPages).toBe(3);
    expect(stillPage2.visible.some((d) => d.id.startsWith("new-"))).toBe(false);

    const page1 = sliceDonorListPage(after, 1, 50);
    expect(page1.visible.map((d) => d.id).slice(0, 3)).toEqual(["new-c", "new-b", "new-a"]);
  });

  it("2페이지를 보고 있으면 새 후원만큼 행이 밀려 같은 번호라도 다른 줄이 보인다", () => {
    const before = sortDonorsNewestFirst(rows(120));
    const page2Before = sliceDonorListPage(before, 2, 50).visible.map((d) => d.id);
    const incoming: Row[] = [{ id: "new-1", at: 50_000, name: "신규" }];
    const after = sortDonorsNewestFirst([...before, ...incoming]);
    const page2After = sliceDonorListPage(after, 2, 50).visible.map((d) => d.id);

    expect(page2After).not.toEqual(page2Before);
    const page1BeforeLast = sliceDonorListPage(before, 1, 50).visible.at(-1)?.id;
    expect(page2After[0]).toBe(page1BeforeLast);
    expect(page2After.slice(1)).toEqual(page2Before.slice(0, 49));
  });

  it("브라우저 새로고침처럼 page=1로 돌아가면 방금 들어온 후원이 맨 위에 있다", () => {
    const before = sortDonorsNewestFirst(rows(120));
    const after = sortDonorsNewestFirst([...before, { id: "fresh", at: 99_999, name: "방금" }]);
    const refreshed = sliceDonorListPage(after, 1, 50);
    expect(refreshed.pageIdx).toBe(1);
    expect(refreshed.visible[0]?.id).toBe("fresh");
  });

  it("페이지당 크기를 바꾸면 1페이지부터 다시 본다(검색·필터와 동일)", () => {
    const list = sortDonorsNewestFirst(rows(200));
    const onPage3 = sliceDonorListPage(list, 3, 50);
    expect(onPage3.pageIdx).toBe(3);
    const afterSizeChange = sliceDonorListPage(list, 1, 100);
    expect(afterSizeChange.pageIdx).toBe(1);
    expect(afterSizeChange.visible).toHaveLength(100);
  });

  it("하단 페이지 번호는 양끝과 현재 근처만 보여 준다", () => {
    expect(buildDonorListPageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(buildDonorListPageItems(1, 46)).toEqual([1, 2, 3, "ellipsis", 46]);
    expect(buildDonorListPageItems(20, 46)).toEqual([1, "ellipsis", 18, 19, 20, 21, 22, "ellipsis", 46]);
    expect(buildDonorListPageItems(46, 46)).toEqual([1, "ellipsis", 44, 45, 46]);
  });
});

describe("후원자 리스트 멤버 선택", () => {
  it("로스터에 미지정 멤버를 만들지 않고, 배정된 멤버 이름을 보여 준다", () => {
    const members = [
      { id: "jaki", name: "자기" },
      { id: "oh", name: "오학진" },
    ];
    const opts = donorMemberSelectOptions("jaki", members);
    expect(opts.map((o) => o.label)).toEqual(["자기", "오학진"]);
    expect(opts.some((o) => o.label.includes("미지정"))).toBe(false);
  });

  it("배정 id가 로스터에 없어도 미지정으로 바꾸지 않고 그 id를 유지한다", () => {
    const opts = donorMemberSelectOptions("ghost", [{ id: "jaki", name: "자기" }]);
    expect(opts[0]).toEqual({ value: "ghost", label: "ghost" });
    expect(opts.some((o) => o.label.includes("미지정"))).toBe(false);
  });
});
