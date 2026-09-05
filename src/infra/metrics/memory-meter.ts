export type MeterCounterName =
  | "pool_leak"
  | "dedup_tp"
  | "dedup_fp"
  | "fallback"
  | "io_success"
  | "io_failure"
  | "io_timeout";

export interface MeterSample {
  ts: number;
  value: number;
}

export interface LatencySample {
  ts: number;
  latencyMs: number;
}

export const METER_WINDOW_MS = 60_000;

export class MemoryMeter {
  private readonly counters = new Map<MeterCounterName, MeterSample[]>();
  private readonly latencies = new Map<string, LatencySample[]>();
  private static _instance: MemoryMeter | null = null;

  static get shared(): MemoryMeter {
    if (!MemoryMeter._instance) {
      MemoryMeter._instance = new MemoryMeter();
    }
    return MemoryMeter._instance;
  }

  private static nowMs(): number {
    return Date.now();
  }

  private prune<T extends { ts: number }>(samples: T[], windowMs: number): T[] {
    const cutoff = MemoryMeter.nowMs() - windowMs;
    const firstInside = samples.findIndex((s) => s.ts >= cutoff);
    if (firstInside <= 0) {
      return firstInside === 0 ? samples : [];
    }
    return samples.slice(firstInside);
  }

  incrementCounter(name: MeterCounterName, delta = 1): void {
    const arr = this.counters.get(name) ?? [];
    arr.push({ ts: MemoryMeter.nowMs(), value: delta });
    this.counters.set(name, this.prune(arr, METER_WINDOW_MS));
  }

  recordLatency(opName: string, latencyMs: number): void {
    const arr = this.latencies.get(opName) ?? [];
    arr.push({ ts: MemoryMeter.nowMs(), latencyMs });
    this.latencies.set(opName, this.prune(arr, METER_WINDOW_MS));
  }

  getCounterSum(name: MeterCounterName): number {
    const arr = this.prune(this.counters.get(name) ?? [], METER_WINDOW_MS);
    this.counters.set(name, arr);
    let sum = 0;
    for (const s of arr) sum += s.value;
    return sum;
  }

  getCounterRatePerMin(name: MeterCounterName): number {
    return this.getCounterSum(name);
  }

  getLatencyP95(opName: string): number | null {
    const arr = this.prune(this.latencies.get(opName) ?? [], METER_WINDOW_MS);
    this.latencies.set(opName, arr);
    if (arr.length === 0) return null;
    const sorted = Array.from(arr, (s) => s.latencyMs).sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, idx)];
  }

  getLatencyP50(opName: string): number | null {
    const arr = this.prune(this.latencies.get(opName) ?? [], METER_WINDOW_MS);
    this.latencies.set(opName, arr);
    if (arr.length === 0) return null;
    const sorted = Array.from(arr, (s) => s.latencyMs).sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.5);
    return sorted[idx];
  }

  getLatencyCount(opName: string): number {
    const arr = this.prune(this.latencies.get(opName) ?? [], METER_WINDOW_MS);
    this.latencies.set(opName, arr);
    return arr.length;
  }

  resetAll(): void {
    this.counters.clear();
    this.latencies.clear();
  }

  snapshot(): {
    counters: Record<string, number>;
    p95ByOp: Record<string, number | null>;
    p50ByOp: Record<string, number | null>;
  } {
    const counters: Record<string, number> = {};
    for (const name of Array.from(this.counters.keys())) {
      counters[name] = this.getCounterSum(name);
    }
    const p95ByOp: Record<string, number | null> = {};
    const p50ByOp: Record<string, number | null> = {};
    for (const name of Array.from(this.latencies.keys())) {
      p95ByOp[name] = this.getLatencyP95(name);
      p50ByOp[name] = this.getLatencyP50(name);
    }
    return { counters, p95ByOp, p50ByOp };
  }
}
