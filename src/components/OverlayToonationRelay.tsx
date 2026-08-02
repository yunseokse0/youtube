"use client";

import ToonationBrowserRelay from "@/components/ToonationBrowserRelay";

type Props = {
  userId: string;
  disabled?: boolean;
  /** URL `key=` 등 — 있으면 relay-config API 생략 */
  linkKey?: string;
  ownerName?: string;
};

/** 엑셀표 OBS — relay-config 또는 URL key 기반 자동 릴레이(별도 relay 페이지 불필요) */
export default function OverlayToonationRelay({ userId, disabled, linkKey, ownerName }: Props) {
  return (
    <ToonationBrowserRelay
      userId={userId}
      linkKey={linkKey}
      ownerName={ownerName}
      enabled={!disabled}
      hidden
    />
  );
}