"use client";

import { useEffect } from "react";

function silenceMedia(el: HTMLMediaElement) {
  el.muted = true;
  el.volume = 0;
  el.setAttribute("muted", "");
  try {
    void el.pause();
  } catch {
    // noop
  }
}

/** 투네 대기 팝업 — 투네이션·기타 페이지 내 사운드 재생 차단 */
export default function PlayerAlertMuteAudio({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.querySelectorAll("audio, video").forEach((node) => {
      if (node instanceof HTMLMediaElement) silenceMedia(node);
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        Array.from(mutation.addedNodes).forEach((node) => {
          if (node instanceof HTMLMediaElement) {
            silenceMedia(node);
            return;
          }
          if (node instanceof Element) {
            node.querySelectorAll("audio, video").forEach((el) => {
              if (el instanceof HTMLMediaElement) silenceMedia(el);
            });
          }
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function playSilenced(this: HTMLMediaElement, ...args) {
      silenceMedia(this);
      return nativePlay.apply(this, args).catch(() => undefined);
    };

    const onMediaPlay = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLMediaElement) silenceMedia(target);
    };
    document.addEventListener("play", onMediaPlay, true);
    document.addEventListener("playing", onMediaPlay, true);

    return () => {
      observer.disconnect();
      HTMLMediaElement.prototype.play = nativePlay;
      document.removeEventListener("play", onMediaPlay, true);
      document.removeEventListener("playing", onMediaPlay, true);
    };
  }, []);

  return <>{children}</>;
}
