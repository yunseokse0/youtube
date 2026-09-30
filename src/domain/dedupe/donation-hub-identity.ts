/**
 * 후원 1건의 허브 id 본문.
 * bank:sms:<id>, bank:din:<id>, toonation:din:<id> 는 같은 본문이다.
 */
export function donationHubIdentity(id: string): string {
  let base = String(id || "").trim();
  if (!base) return "";
  base = base.replace(/^(ingest|toona|account|din|hub|din|poll|dinpush|poll|push|din_ingest|din_hub):/i, "");
  base = base.replace(/::[a-z]+$/i, "");
  base = base.replace(/^(toonation|bank|other|toon|투네|toona):/i, "");
  base = base.replace(/^(din|hub|self|sms):/i, "");
  return base;
}
