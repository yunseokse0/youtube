"use client";

import { useEffect, useRef, useState } from "react";

type RelayConfig = {
  enabled: boolean;
  linkKey?: string;
  ownerName?: string;
};

export type ToonationRelayForwarded = {
  at: number;
  outcome?: string;
  ok: boolean;
};

type Props = {
  userId: string;
  /** 직접 지정 시 relay-config API 생략(관리자 페이지) */
  linkKey?: string;
  ownerName?: string;
  enabled?: boolean;
  hidden?: boolean;
  onForwarded?: (info: ToonationRelayForwarded) => void;
};

/**
 * 브라우저에서 투네 WS 수신 → /api/donations/toonation/ingest 릴레이.
 * OBS 알림 소스만 켜져 있을 때 서버 WS가 후원을 못 받는 경우를 보완한다.
 */
export default function ToonationBrowserRelay({
  userId,
  linkKey: linkKeyProp,
  ownerName: ownerNameProp = "",
  enabled = true,
  hidden = true,
  onForwarded,
}: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const onForwardedRef = useRef(onForwarded);
  onForwardedRef.current = onForwarded;
  const [config, setConfig] = useState<RelayConfig | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [lastOutcome, setLastOutcome] = useState("");

  useEffect(() => {
    if (!enabled || !userId) {
      setConfig(null);
      return;
    }
    const directKey = String(linkKeyProp || "").trim();
    if (directKey) {
      setConfig({
        enabled: true,
        linkKey: directKey,
        ownerName: String(ownerNameProp || "").trim(),
      });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/donations/toonation/relay-config?u=${encodeURIComponent(userId)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as RelayConfig | null;
        const linkKey = String(data?.linkKey || "").trim();
        if (!cancelled && linkKey) {
          setConfig({
            enabled: true,
            linkKey,
            ownerName: String(data?.ownerName || ownerNameProp || "").trim(),
          });
        } else if (!cancelled) {
          setConfig(null);
        }
      } catch {
        if (!cancelled) setConfig(null);
      }
    };
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, linkKeyProp, ownerNameProp, userId]);

  useEffect(() => {
    if (!config?.enabled || !config.linkKey || !userId) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const forwardRaw = async (raw: string) => {
      try {
        const res = await fetch(`/api/donations/toonation/ingest?u=${encodeURIComponent(userId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw, ownerName: config.ownerName || undefined }),
        });
        const data = (await res.json().catch(() => null)) as {
          result?: { outcome?: string; reason?: string };
        } | null;
        const outcome =
          data?.result && "outcome" in data.result
            ? String(data.result.outcome)
            : data?.result?.reason
              ? String(data.result.reason)
              : undefined;
        const at = Date.now();
        if (res.ok) {
          setLastAt(at);
          if (outcome) setLastOutcome(outcome);
        }
        onForwardedRef.current?.({ at, outcome, ok: res.ok });
      } catch {
        /* noop */
      }
    };

    const connect = async () => {
      if (cancelled) return;
      setStatus("connecting");
      try {
        const payloadRes = await fetch(
          `/api/donations/toonation/ws-payload?key=${encodeURIComponent(config.linkKey!)}`,
          { cache: "no-store" }
        );
        const payloadJson = (await payloadRes.json().catch(() => null)) as { payload?: string } | null;
        if (!payloadRes.ok || !payloadJson?.payload) {
          setStatus("error");
          reconnectTimer = setTimeout(connect, 10_000);
          return;
        }

        const ws = new WebSocket(`wss://ws.toon.at/${payloadJson.payload}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!cancelled) setStatus("connected");
        };
        ws.onmessage = (ev) => {
          const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
          void forwardRaw(raw);
        };
        ws.onclose = () => {
          if (cancelled) return;
          setStatus("connecting");
          reconnectTimer = setTimeout(connect, 10_000);
        };
        ws.onerror = () => {
          if (!cancelled) setStatus("error");
        };
      } catch {
        setStatus("error");
        reconnectTimer = setTimeout(connect, 10_000);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* noop */
        }
        wsRef.current = null;
      }
    };
  }, [config?.enabled, config?.linkKey, config?.ownerName, userId]);

  if (hidden) return null;

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        color: "#a3a3a3",
        padding: 8,
        background: "rgba(0,0,0,0.85)",
        lineHeight: 1.4,
      }}
    >
      <div>투네 브라우저 릴레이 · {status}</div>
      <div>계정: {userId}</div>
      {config?.ownerName ? <div>주인: {config.ownerName}</div> : null}
      {lastAt ? <div>마지막 전달: {new Date(lastAt).toLocaleTimeString()}</div> : null}
      {lastOutcome ? <div>결과: {lastOutcome}</div> : null}
    </div>
  );
}
