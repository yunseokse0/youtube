"use client";

/** 상류사회 영토 게이지는 제거됨. OBS 브라우저 소스가 오류 내지 않게 빈 화면만 둔다. */
export default function HighSocietyOverlayPage() {
  return (
    <main
      className="h-screen w-screen overflow-hidden bg-transparent"
      data-hs-overlay="removed"
    />
  );
}
