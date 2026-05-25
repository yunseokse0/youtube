/** OBS·방송 프로덕션 vs 로컬 데모/관리자 미리보기 구분 */

export function isOverlayProductionBuild(): boolean {
  return process.env.NODE_ENV === "production";
}

export type OverlayDevHudFlags = {
  hubPreview?: boolean;
  sigPreview?: boolean;
  demo?: boolean;
};

/** SIG DUEL v16 안내·dev:clean 문구·DEMO 뱃지 등 — 프로덕션 빌드에서는 항상 false */
export function showOverlayDevHud(flags: OverlayDevHudFlags): boolean {
  if (isOverlayProductionBuild()) return false;
  return Boolean(flags.hubPreview || flags.sigPreview || flags.demo);
}

/** 데모 허브·관리자 iframe용 축소 레이아웃 (OBS URL은 hubPreview 없음 → 전체 크기) */
export function useOverlayHubCompactLayout(hubPreview: boolean): boolean {
  return hubPreview;
}
