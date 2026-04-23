"use client";

import { useCallback, useEffect, useRef } from "react";

type UseAudioOptions = {
  loop?: boolean;
  volume?: number;
};

export function useAudio(src: string, opts?: UseAudioOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);

  useEffect(() => {
    const audio = new Audio(src);
    audio.loop = Boolean(opts?.loop);
    audio.volume = typeof opts?.volume === "number" ? Math.max(0, Math.min(1, opts.volume)) : 1;
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [src, opts?.loop, opts?.volume]);

  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    const onFirstInteraction = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      const prevMuted = audio.muted;
      audio.muted = true;
      void audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = prevMuted;
      }).catch(() => {
        audio.muted = prevMuted;
      });
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
    };
    window.addEventListener("pointerdown", onFirstInteraction, { once: true });
    window.addEventListener("keydown", onFirstInteraction, { once: true });
  }, []);

  const play = useCallback((restart = false) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (restart) audio.currentTime = 0;
    void audio.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  return { play, pause, stop, unlock };
}

