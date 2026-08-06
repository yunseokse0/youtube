/**
 * OBS 브라우저 소스·백그라운드 탭에서 setInterval 이 크게 스로틀되어
 * 시그 롤링이 멈춘 것처럼 보이는 문제를 피하기 위한 타이머.
 *
 * - HTTP(비보안)·Worker 불가: nested setTimeout (blob Worker 회피)
 * - Worker 사용 시: 첫 tick 워치독 — 침묵 실패면 setTimeout 폴백
 */

function startNestedTimeoutLoop(
  cbRef: { current: () => void },
  delay: number
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const loop = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      if (stopped) return;
      try {
        cbRef.current();
      } catch {
        /* ignore tick errors */
      }
      loop();
    }, delay);
  };
  loop();
  return () => {
    stopped = true;
    if (timer != null) clearTimeout(timer);
  };
}

function shouldSkipBlobWorker(): boolean {
  if (typeof Worker === "undefined") return true;
  try {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      /** http://IP OBS — blob: Worker 가 생성만 되고 tick 이 안 오는 경우가 있음 */
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

export function createObsSafeInterval(callback: () => void, ms: number): () => void {
  const delay = Math.max(250, Math.floor(Number(ms) || 1000));
  const cbRef = { current: callback };

  if (shouldSkipBlobWorker()) {
    return startNestedTimeoutLoop(cbRef, delay);
  }

  try {
    const src =
      "let i;onmessage=function(e){clearInterval(i);if(e.data==='stop')return;i=setInterval(function(){postMessage(0);},e.data);};";
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "application/javascript" })));
    let stopped = false;
    let gotMessage = false;
    let fallbackStop: (() => void) | null = null;

    worker.onmessage = () => {
      gotMessage = true;
      try {
        cbRef.current();
      } catch {
        /* ignore tick errors */
      }
    };
    worker.postMessage(delay);

    const watchdogMs = Math.min(Math.max(delay + 1200, delay * 2), delay * 3);
    const watchdog = setTimeout(() => {
      if (stopped || gotMessage) return;
      try {
        worker.postMessage("stop");
        worker.terminate();
      } catch {
        /* ignore */
      }
      fallbackStop = startNestedTimeoutLoop(cbRef, delay);
    }, watchdogMs);

    return () => {
      stopped = true;
      clearTimeout(watchdog);
      if (fallbackStop) fallbackStop();
      try {
        worker.postMessage("stop");
      } catch {
        /* ignore */
      }
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return startNestedTimeoutLoop(cbRef, delay);
  }
}
