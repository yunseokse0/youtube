"use client";

import { OBS_TEXT_EFFECT_STYLES_CSS } from "@/lib/obs-text-effects";

/** OBS·관리자 미리보기 공통 — keyframes 1회 주입 */
export function ObsTextEffectStyles() {
  return <style dangerouslySetInnerHTML={{ __html: OBS_TEXT_EFFECT_STYLES_CSS }} />;
}
