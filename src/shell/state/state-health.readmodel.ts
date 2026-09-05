export const STATE_HEALTH_VERSION = 1;

export function buildStorageHealthReadModel(
  kvOk: boolean,
  mysqlOk: boolean,
  redisOk: boolean,
  lastErr: string | null
): { ok: boolean; storages: string[]; lastError: string | null } {
  const storages: string[] = [];
  if (kvOk) storages.push("kv");
  if (mysqlOk) storages.push("mysql");
  if (redisOk) storages.push("redis");
  const ok = storages.length > 0;
  return {
    ok,
    storages,
    lastError: lastErr,
  };
}
