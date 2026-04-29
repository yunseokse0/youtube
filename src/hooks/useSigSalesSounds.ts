"use client";

import { useEffect, useMemo } from "react";
import { Howl } from "howler";
import { SPIN_SOUND_PATHS } from "@/lib/sig-roulette";

export function useSigSalesSounds(volume: number, muted: boolean) {
  const sounds = useMemo(
    () => ({
      tick: new Howl({ src: [SPIN_SOUND_PATHS.tick], preload: true, loop: true }),
      final: new Howl({ src: [SPIN_SOUND_PATHS.final], preload: true }),
      success: new Howl({ src: [SPIN_SOUND_PATHS.success], preload: true }),
      oneShot: new Howl({ src: [SPIN_SOUND_PATHS.oneShot], preload: true }),
    }),
    []
  );

  useEffect(() => {
    Object.values(sounds).forEach((s) => {
      s.volume(volume);
      s.mute(muted);
    });
  }, [sounds, volume, muted]);

  useEffect(() => {
    return () => {
      Object.values(sounds).forEach((s) => s.unload());
    };
  }, [sounds]);

  return sounds;
}
