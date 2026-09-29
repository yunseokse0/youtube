import { createModuleLogger } from "@/lib/logger";

const log = createModuleLogger("PerUserMutex");

const DEFAULT_TIMEOUT_MS = 30_000;
const WARN_QUEUE_DEPTH = 5;
const HIGH_CONTENTION_DEPTH = 10;

type QueuedTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  createdAt: number;
  timeoutMs: number;
};

type UserQueue = {
  tasks: QueuedTask<unknown>[];
  running: boolean;
  drainScheduled: boolean;
};

const PER_USER_MUTEX_GLOBAL_KEY = "__YOUTUBE_HARMONY_PER_USER_MUTEX_QUEUES_V1__";

type GlobalMutexStore = Map<string, UserQueue>;

function getGlobalQueueStore(): GlobalMutexStore {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[PER_USER_MUTEX_GLOBAL_KEY]) {
    g[PER_USER_MUTEX_GLOBAL_KEY] = new Map<string, UserQueue>();
    log.info("initialized per-user mutex singleton store on globalThis (Next.js HMR safe)");
  }
  return g[PER_USER_MUTEX_GLOBAL_KEY] as GlobalMutexStore;
}

function getOrCreateQueue(userId: string): UserQueue {
  const userQueues = getGlobalQueueStore();
  let q = userQueues.get(userId);
  if (!q) {
    q = { tasks: [], running: false, drainScheduled: false };
    userQueues.set(userId, q);
  }
  return q;
}

function gcQueueIfEmpty(userId: string, q: UserQueue) {
  if (q.tasks.length === 0 && !q.running) {
    const userQueues = getGlobalQueueStore();
    userQueues.delete(userId);
  }
}

async function runWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  userId: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  let timedOut = false;
  const work = fn();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const err = new Error(
        `PerUserMutex timed out after ${timeoutMs}ms (userId=${userId})`
      );
      err.name = "MutexTimeoutError";
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeoutPromise]);
  } catch (err) {
    if (!timedOut) throw err;
    /**
     * 타임아웃은 대기자에게만 알리고 작업은 취소하지 않는다.
     * 여기서 락을 풀면 다음 저장이 아직 쓰는 스냅샷을 읽어 한 건이 덮인다.
     * 작업이 끝날 때까지 락을 유지하고, 끝나면 그 결과를 그대로 반환한다.
     */
    log.warn(
      `mutex timeout userId=${userId} after ${timeoutMs}ms — holding lock until in-flight work finishes`
    );
    return await work;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function drainQueue(userId: string) {
  const store = getGlobalQueueStore();
  const q = store.get(userId);
  if (!q || q.drainScheduled) return;
  q.drainScheduled = true;

  while (true) {
    const store2 = getGlobalQueueStore();
    const current = store2.get(userId);
    if (!current) break;
    const task = current.tasks.shift();
    if (!task) {
      current.drainScheduled = false;
      gcQueueIfEmpty(userId, current);
      break;
    }
    current.running = true;
    const waitMs = Date.now() - task.createdAt;
    const depth = current.tasks.length;
    if (depth >= WARN_QUEUE_DEPTH) {
      log[depth >= HIGH_CONTENTION_DEPTH ? "error" : "warn"](
        `mutex high contention userId=${userId} queueDepth=${depth} waitMs=${waitMs}`
      );
    }
    try {
      const result = await runWithTimeout(task.fn, task.timeoutMs, userId);
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      current.running = false;
    }
  }
}

export function getMutexQueueDepth(userId: string): number {
  return getGlobalQueueStore().get(userId)?.tasks.length ?? 0;
}

export function getMutexActiveUserCount(): number {
  return getGlobalQueueStore().size;
}

export function getUserMutexStats() {
  const entries = Array.from(getGlobalQueueStore().entries()).map(([userId, q]) => ({
    userId,
    depth: q.tasks.length,
    running: q.running,
  }));
  return {
    activeUsers: entries.length,
    totalQueued: entries.reduce((s, e) => s + e.depth, 0),
    entries,
  };
}

export async function runExclusivePerUser<T>(
  userId: string,
  fn: () => Promise<T>,
  options: { timeoutMs?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const q = getOrCreateQueue(userId);
  const task: QueuedTask<T> = {
    fn,
    resolve: null as unknown as (value: T) => void,
    reject: null as unknown as (reason: unknown) => void,
    createdAt: Date.now(),
    timeoutMs,
  };
  const promise = new Promise<T>((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });
  q.tasks.push(task as QueuedTask<unknown>);
  void drainQueue(userId);
  return promise;
}
