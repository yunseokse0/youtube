export const DONOR_PAGE_SIZES = [50, 100, 300] as const;
export type DonorPageSize = (typeof DONOR_PAGE_SIZES)[number];

export const DONOR_LIST_MIN_PAGE_SIZE: DonorPageSize = 50;

export type DonorListPageSlice<T> = {
  totalPages: number;
  pageIdx: number;
  pageStart: number;
  pageEnd: number;
  visible: T[];
};

/** 후원자 리스트 창과 동일한 페이지 자르기. 페이지 번호는 새 후원으로 리셋하지 않는다. */
export function sliceDonorListPage<T>(
  rows: T[],
  page: number,
  pageSize: number
): DonorListPageSlice<T> {
  const size = Math.max(DONOR_LIST_MIN_PAGE_SIZE, Number(pageSize) || DONOR_LIST_MIN_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / size) || 1);
  const pageIdx = Math.min(Math.max(1, page), totalPages);
  let pageStart = (pageIdx - 1) * size;
  /** 맨 뒤는 나머지 몇 건이 아니라, 끝에서 페이지 크기만큼 채워 보여 준다. */
  if (pageIdx === totalPages && rows.length > size) {
    pageStart = rows.length - size;
  }
  const pageEnd = pageStart + size;
  return {
    totalPages,
    pageIdx,
    pageStart,
    pageEnd,
    visible: rows.slice(pageStart, pageEnd),
  };
}

export type DonorListPageItem = number | "ellipsis";

/** 하단 중앙 페이지 번호. 양끝·현재 근처만 보여 46페이지여도 한 줄에 맞춘다. */
export function buildDonorListPageItems(
  page: number,
  totalPages: number
): DonorListPageItem[] {
  const total = Math.max(1, Math.floor(Number(totalPages) || 1));
  const current = Math.min(Math.max(1, Math.floor(Number(page) || 1)), total);
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const siblings = 2;
  const left = Math.max(2, current - siblings);
  const right = Math.min(total - 1, current + siblings);
  const items: DonorListPageItem[] = [1];
  if (left > 2) items.push("ellipsis");
  for (let i = left; i <= right; i += 1) items.push(i);
  if (right < total - 1) items.push("ellipsis");
  items.push(total);
  return items;
}

export function sortDonorsNewestFirst<T extends { at?: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}

export type DonorMemberOption = { value: string; label: string };

/** 로스터에 없는 '미지정' 멤버는 넣지 않는다. 배정된 id가 로스터에 없으면 그 id만 임시 표시. */
export function donorMemberSelectOptions(
  memberId: string | undefined,
  members: Array<{ id: string; name: string }>
): DonorMemberOption[] {
  const id = String(memberId || "").trim();
  const roster = Array.isArray(members) ? members : [];
  const opts: DonorMemberOption[] = [];
  if (!id) opts.push({ value: "", label: "배치 선택" });
  else if (!roster.some((m) => m.id === id)) opts.push({ value: id, label: id });
  for (const m of roster) {
    if (!m?.id) continue;
    opts.push({ value: m.id, label: m.name || m.id });
  }
  return opts;
}
