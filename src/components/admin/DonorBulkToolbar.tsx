"use client";

import React, { useState } from "react";

type DonorBulkToolbarProps = {
  visibleCount: number;
  selectedCount: number;
  hasAnySelection: boolean;
  onSelectAllVisible: () => void;
  onClearAll: () => void;
  onBulkDelete: () => Promise<void> | void;
};

export default function DonorBulkToolbar({
  visibleCount,
  selectedCount,
  hasAnySelection,
  onSelectAllVisible,
  onClearAll,
  onBulkDelete,
}: DonorBulkToolbarProps) {
  const [deleting, setDeleting] = useState(false);

  const confirmDialog = (title: string, desc: string, onConfirm: () => void) => {
    if (typeof window === "undefined") return;
    const text = desc ? `${title}\n\n${desc}` : title;
    if (window.confirm(text)) onConfirm();
  };

  const handleBulkDelete = () => {
    if (deleting || !hasAnySelection) return;
    confirmDialog(
      `정말 선택된 ${selectedCount}건의 후원을 삭제하시겠습니까?`,
      "이 작업은 되돌릴 수 없으며, 각 멤버의 기여도 합계에서 해당 금액만큼 자동으로 차감됩니다.",
      async () => {
        try {
          setDeleting(true);
          await onBulkDelete();
        } finally {
          setDeleting(false);
        }
      }
    );
  };

  const btnStyle = (disabled: boolean, isDelete = false) => ({
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: isDelete ? 600 : 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    border: `1px solid ${isDelete ? "#7f1d1d" : "#555"}`,
    background: isDelete ? "rgba(127, 29, 29, 0.6)" : "#3a3a3a",
    color: isDelete ? "#fecaca" : "#e5e5e5",
  });

  const applyHover = (e: React.MouseEvent<HTMLButtonElement>, disabled: boolean, isDelete = false) => {
    if (!disabled) e.currentTarget.style.background = isDelete ? "rgba(153, 27, 27, 0.85)" : "#4a4a4a";
  };

  const applyLeave = (e: React.MouseEvent<HTMLButtonElement>, disabled: boolean, isDelete = false) => {
    e.currentTarget.style.background = disabled
      ? (isDelete ? "rgba(127, 29, 29, 0.3)" : "#3a3a3a")
      : (isDelete ? "rgba(127, 29, 29, 0.6)" : "#3a3a3a");
  };

  const allDisabled = visibleCount === 0 || deleting;
  const clearDisabled = !hasAnySelection || deleting;
  const deleteDisabled = !hasAnySelection || deleting;

  return (
    <div style={{
      background: "#2b2b2b", border: "1px solid #444", padding: 10, borderRadius: 6,
      display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 13, color: "#e5e5e5", fontWeight: 500 }}>
        🗂️ {selectedCount}건 선택됨 · 전체 {visibleCount}건 중
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button
          type="button" onClick={onSelectAllVisible} disabled={allDisabled}
          style={btnStyle(allDisabled)}
          onMouseOver={(e) => applyHover(e, allDisabled)}
          onMouseOut={(e) => applyLeave(e, allDisabled)}
        >전체선택</button>
        <button
          type="button" onClick={onClearAll} disabled={clearDisabled}
          style={btnStyle(clearDisabled)}
          onMouseOver={(e) => applyHover(e, clearDisabled)}
          onMouseOut={(e) => applyLeave(e, clearDisabled)}
        >선택 모두 해제</button>
        <button
          type="button" onClick={handleBulkDelete} disabled={deleteDisabled}
          style={btnStyle(deleteDisabled, true)}
          onMouseOver={(e) => applyHover(e, deleteDisabled, true)}
          onMouseOut={(e) => applyLeave(e, deleteDisabled, true)}
        >{deleting ? "삭제중..." : `선택 ${selectedCount}건 삭제`}</button>
      </div>
    </div>
  );
}
