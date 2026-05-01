"use client";

import { decompressFrames, parseGIF } from "gifuct-js";
import type { ParsedFrame } from "gifuct-js";
import { useEffect, useRef } from "react";

type SigSlowGifProps = {
  src: string;
  alt: string;
  className?: string;
  /** 1 = 원본 속도, 기본 3.5 ≈ 프레임 유지 약 3.5배 */
  delayMultiplier?: number;
  onLoadError?: () => void;
  /** 첫 프레임 렌더 직후 (프리로드 UI 등) */
  onReady?: () => void;
};

export default function SigSlowGif({
  src,
  alt,
  className = "",
  delayMultiplier = 3.5,
  onLoadError,
  onReady,
}: SigSlowGifProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyCalledRef = useRef(false);
  const onReadyRef = useRef(onReady);
  const onLoadErrorRef = useRef(onLoadError);
  onReadyRef.current = onReady;
  onLoadErrorRef.current = onLoadError;

  useEffect(() => {
    readyCalledRef.current = false;
    if (!canvasRef.current || !src) return;

    let cancelled = false;
    const tempCanvas = document.createElement("canvas");
    const patchCtxRaw = tempCanvas.getContext("2d");
    if (!patchCtxRaw) return;
    const patchCtx: CanvasRenderingContext2D = patchCtxRaw;

    let frameImageData: ImageData | null = null;

    function drawPatch(frame: ParsedFrame, target: CanvasRenderingContext2D) {
      const dims = frame.dims;
      if (
        !frameImageData ||
        dims.width !== frameImageData.width ||
        dims.height !== frameImageData.height
      ) {
        tempCanvas.width = dims.width;
        tempCanvas.height = dims.height;
        frameImageData = patchCtx.createImageData(dims.width, dims.height);
      }
      frameImageData.data.set(frame.patch);
      patchCtx.putImageData(frameImageData, 0, 0);
      target.drawImage(tempCanvas, dims.left, dims.top);
    }

    let loadedFrames: ParsedFrame[] = [];
    let frameIndex = 0;

    function renderFrame() {
      if (cancelled || loadedFrames.length === 0) return;
      const display = canvasRef.current;
      if (!display) return;
      const displayCtx = display.getContext("2d");
      if (!displayCtx) return;

      const frame = loadedFrames[frameIndex];
      const start = performance.now();

      if (frame.disposalType === 2) {
        displayCtx.clearRect(0, 0, display.width, display.height);
      }

      drawPatch(frame, displayCtx);

      if (!readyCalledRef.current) {
        readyCalledRef.current = true;
        onReadyRef.current?.();
      }

      const delayMsRaw = Math.max(34, frame.delay * delayMultiplier);
      frameIndex = (frameIndex + 1) % loadedFrames.length;
      const elapsed = performance.now() - start;
      const wait = Math.max(0, Math.floor(delayMsRaw - elapsed));

      timerRef.current = setTimeout(renderFrame, wait);
    }

    async function load() {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`gif fetch ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;

        const gif = parseGIF(buf);
        const frames = decompressFrames(gif, true);
        if (frames.length === 0) throw new Error("empty gif");

        loadedFrames = frames;
        frameIndex = 0;

        const display = canvasRef.current;
        if (!display || cancelled) return;

        const w = gif.lsd.width;
        const h = gif.lsd.height;
        display.width = w;
        display.height = h;

        renderFrame();
      } catch {
        if (!cancelled) onLoadErrorRef.current?.();
      }
    }

    load();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [src, delayMultiplier]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={alt}
      className={`absolute inset-0 h-full w-full ${className}`.trim()}
    />
  );
}
