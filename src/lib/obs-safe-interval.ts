/**
 * OBS 브라우저 소스·백그라운드 탭에서 setInterval 이 크게 스로틀되어
 * 시그 롤링이 멈춘 것처럼 보이는 문제를 피하기 위한 워커 타이머.
 */
export function createObsSafeInterval(callback: () => void, ms: number): () => void {
  const delay = Math.max(250, Math.floor(Number(ms) || 1000));
  const cbRef = { current: callback };
  cbRef.current = callback;

  try {
    const src =
      "let i;onmessage=function(e){clearInterval(i);if(e.data==='stop')return;i=setInterval(function(){postMessage(0);},e.data);};";
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "application/javascript" })));
    worker.onmessage = () => {
      try {
        cbRef.current();
      } catch {
        /* ignore tick errors */
      }
    };
    worker.postMessage(delay);
    return () => {
      try {
        worker.postMessage("stop");
      } catch {
        /* ignore */
      }
      worker.terminate();
    };
  } catch {
    const id = globalThis.setInterval(() => {
      try {
        cbRef.current();
      } catch {
        /* ignore */
      }
    }, delay);
    return () => globalThis.clearInterval(id);
  }
}
