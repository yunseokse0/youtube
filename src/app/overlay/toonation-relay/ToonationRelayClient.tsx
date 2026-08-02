"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  userId: string;
  linkKey: string;
  ownerName: string;
};

type RelayStatus = "connecting" | "connected" | "error" | "idle";

export default function ToonationRelayClient({ userId, linkKey, ownerName }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<RelayStatus>("idle");
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string>("");

  useEffect(() => {
    if (!userId || !linkKey) {
      setStatus("error");
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const forwardRaw = async (raw: string) => {
      try {
        const res = await fetch(`/api/donations/toonation/ingest?u=${encodeURIComponent(userId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw, ownerName: ownerName || undefined }),
        });
        const data = (await res.json().catch(() => null)) as {
          result?: { outcome?: string; reason?: string };
        } | null;
        if (!res.ok) return;
        setLastAt(Date.now());
        const outcome = data?.result && "outcome" in data.result ? data.result.outcome : data?.result?.reason;
        if (outcome) setLastOutcome(String(outcome));
      } catch {
        /* noop */
      }
    };

    const connect = async () => {
      if (cancelled) return;
      setStatus("connecting");
      try {
        const payloadRes = await fetch(
          `/api/donations/toonation/ws-payload?key=${encodeURIComponent(linkKey)}`,
          { cache: "no-store" }
        );
        const payloadJson = (await payloadRes.json().catch(() => null)) as { payload?: string; error?: string } | null;
        if (!payloadRes.ok || !payloadJson?.payload) {
          setStatus("error");
          reconnectTimer = setTimeout(connect, 10_000);
          return;
        }

        const ws = new WebSocket(`wss://ws.toon.at/${payloadJson.payload}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setStatus("connected");
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
          if (cancelled) return;
          setStatus("error");
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
  }, [userId, linkKey, ownerName]);

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
      <div>투네 릴레이 · {status}</div>
      <div>계정: {userId}</div>
      {ownerName ? <div>주인: {ownerName}</div> : null}
      {lastAt ? <div>마지막 전달: {new Date(lastAt).toLocaleTimeString()}</div> : null}
      {lastOutcome ? <div>결과: {lastOutcome}</div> : null}
      <div style={{ marginTop: 6, opacity: 0.7 }}>
        OBS 1×1 소스로 두면 알림과 별도로 엑셀표에 반영됩니다.
      </div>
    </div>
  );
}
