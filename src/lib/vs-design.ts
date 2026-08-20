/** 시그·대전 게이지 중앙 VS 외형 */
export type VsDesignId = "gradient" | "glow-gold" | "glow-blue" | "glow-copper";

export const VS_GLOW_SPARKS_SPRITE_URL = "/assets/versus-vs/glow-sparks-sprite.jpg";

export const VS_DESIGN_OPTIONS: { id: VsDesignId; label: string; description: string }[] = [
  { id: "gradient", label: "기본 · 그라데이션", description: "빨강·검정·파랑 VS 텍스트" },
  { id: "glow-gold", label: "글로우 · 골드", description: "금색 스파크 VS (첨부 에셋)" },
  { id: "glow-blue", label: "글로우 · 블루", description: "청·보라 스파크 VS" },
  { id: "glow-copper", label: "글로우 · 코퍼", description: "주황·적갈색 스파크 VS" },
];

export function normalizeVsDesign(raw: unknown): VsDesignId {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (v === "glow-gold" || v === "gold" || v === "glow-golden") return "glow-gold";
  if (v === "glow-blue" || v === "blue" || v === "glow-purple") return "glow-blue";
  if (v === "glow-copper" || v === "copper" || v === "orange" || v === "glow-orange") {
    return "glow-copper";
  }
  if (v === "glow" || v === "glow-sparks" || v === "sprite") return "glow-gold";
  return "gradient";
}

/** 3열 스프라이트 시트에서 보여줄 가로 위치(%) */
export function vsDesignSpriteBackgroundPosition(design: VsDesignId): string | null {
  switch (design) {
    case "glow-gold":
      return "0% 50%";
    case "glow-blue":
      return "50% 50%";
    case "glow-copper":
      return "100% 50%";
    default:
      return null;
  }
}

export function isGlowVsDesign(design: VsDesignId): boolean {
  return design !== "gradient";
}
