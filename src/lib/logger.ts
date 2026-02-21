// 로그 레벨 설정
export const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
} as const;

type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];

// 환경 변수에서 로그 레벨 읽기 (기본값: INFO)
const getLogLevel = (): LogLevel => {
  const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL?.toUpperCase();
  switch (envLevel) {
    case 'ERROR': return LOG_LEVELS.ERROR;
    case 'WARN': return LOG_LEVELS.WARN;
    case 'DEBUG': return LOG_LEVELS.DEBUG;
    default: return LOG_LEVELS.INFO;
  }
};

const CURRENT_LOG_LEVEL = getLogLevel();

// 로그 함수들
export const logger = {
  error: (message: string, ...args: any[]) => {
    if (CURRENT_LOG_LEVEL >= LOG_LEVELS.ERROR) {
      console.error(`[${new Date().toISOString()}] ERROR:`, message, ...args);
    }
  },
  
  warn: (message: string, ...args: any[]) => {
    if (CURRENT_LOG_LEVEL >= LOG_LEVELS.WARN) {
      console.warn(`[${new Date().toISOString()}] WARN:`, message, ...args);
    }
  },
  
  info: (message: string, ...args: any[]) => {
    if (CURRENT_LOG_LEVEL >= LOG_LEVELS.INFO) {
      console.log(`[${new Date().toISOString()}] INFO:`, message, ...args);
    }
  },
  
  debug: (message: string, ...args: any[]) => {
    if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEBUG) {
      console.log(`[${new Date().toISOString()}] DEBUG:`, message, ...args);
    }
  },
};

// 특정 모듈용 로거
export const createModuleLogger = (moduleName: string) => ({
  error: (message: string, ...args: any[]) => {
    logger.error(`[${moduleName}] ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    logger.warn(`[${moduleName}] ${message}`, ...args);
  },
  info: (message: string, ...args: any[]) => {
    logger.info(`[${moduleName}] ${message}`, ...args);
  },
  debug: (message: string, ...args: any[]) => {
    logger.debug(`[${moduleName}] ${message}`, ...args);
  },
});