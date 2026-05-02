/**
 * 회전판 전용 절차 오디오 — 외부 wav 없이 브라우저 합성만 사용 (방송용으로 차분한 톤).
 */

export function getOrCreateSpinAudioContext(existing: AudioContext | null): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    return existing ?? new Ctx();
  } catch {
    return null;
  }
}

/** 짧은 밴딩 패스 노이즈 틱 — 전통적인「삑」 대신 묵직한 메탈릭 클릭 느낌 */
export function playSpinMechanicalTick(ctx: AudioContext, masterVolume: number): void {
  const dur = 0.032;
  const n = Math.max(32, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    ch[i] = (Math.random() * 2 - 1) * (1 - t) * (1 - t);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400 + Math.random() * 400;
  bp.Q.value = 0.65;
  const g = ctx.createGain();
  const gain = Math.max(0.001, Math.min(0.055, 0.019 * masterVolume));
  const now = ctx.currentTime;
  g.gain.setValueAtTime(gain * 0.01, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(ctx.destination);
  src.start(now);
  src.stop(now + dur + 0.01);
}

/** 착지 — 짧은 펜타토닉 상행, 낮은 게인·부드러운 감쇠 */
export function playSpinLandShimmer(ctx: AudioContext, masterVolume: number): void {
  const base = [392.0, 493.88, 587.33, 659.25, 783.99] as const;
  const vol = Math.max(0.02, Math.min(0.55, 0.11 * masterVolume));
  const now = ctx.currentTime;
  base.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const t0 = now + i * 0.038;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol * (0.55 - i * 0.07), t0 + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  });
}
