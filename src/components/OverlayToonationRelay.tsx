"use client";

import ToonationBrowserRelay from "@/components/ToonationBrowserRelay";

type Props = {
  userId: string;
  /** URL `key=` 등 — 있으면 relay-config API 생략 */
  linkKey?: string;
  ownerName?: string;
};

/** 엑셀표 OBS — relay-config 또는 URL key 기반 자동 릴레이(항상 ON) */
export default function OverlayToonationRelay({ userId, linkKey, ownerName }: Props) {
  return (
    <ToonationBrowserRelay
      userId={userId}
      linkKey={linkKey}
      ownerName={ownerName}
      enabled
      deferToServerListener
      hidden
    />
  );
}
