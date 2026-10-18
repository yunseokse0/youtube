export function formatSigSalesWon(value: number): string {
  const safe = Math.max(0, Math.floor(Number(value) || 0));
  return `₩ ${safe.toLocaleString("ko-KR")}`;
}

export function sigSalesPanelStatusLabel(phase: string | null | undefined): "대기 중" | "진행 중" | "판매 확정" {
  const p = String(phase || "").trim().toUpperCase();
  if (p === "CONFIRMED") return "판매 확정";
  if (p === "LANDED" || p === "CONFIRM_PENDING") return "진행 중";
  return "대기 중";
}
