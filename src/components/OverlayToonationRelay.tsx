"use client";

import ToonationBrowserRelay from "@/components/ToonationBrowserRelay";

type Props = {
  userId: string;
  disabled?: boolean;
};

/** 엑셀표 OBS — relay-config 기반 자동 릴레이 */
export default function OverlayToonationRelay({ userId, disabled }: Props) {
  return <ToonationBrowserRelay userId={userId} enabled={!disabled} hidden />;
}
