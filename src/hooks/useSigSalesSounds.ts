"use client";

import { useEffect, useMemo } from "react";
import { Howl } from "howler";
import { SPIN_SOUND_PATHS } from "@/lib/sig-roulette";

export function useSigSalesSounds(volume: number, muted: boolean) {
  const sounds = useMemo(
    () => ({
      tick: new Howl({ src: [SPIN_SOUND_PATHS.tick], preload: true, volume, mute: muted, loop: true }),
      final: new Howl({ src: [SPIN_SOUND_PATHS.final], preload: true, volume, mute: muted }),
      success: new Howl({ src: [SPIN_SOUND_PATHS.success], preload: true, volume, mute: muted }),
      oneShot: new Howl({ src: [SPIN_SOUND_PATHS.oneShot], preload: true, volume, mute: muted }),
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
