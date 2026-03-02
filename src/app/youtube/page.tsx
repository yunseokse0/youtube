"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getSavedVideoUrl,
  setYoutubeVideoUrl,
  getPreferredLiveChatId,
  getPreferredApiKey,
  setPreferredApiKey,
  clearPreferredApiKey,
  startYoutubePolling,
  OnForbidden,
  parseVideoIdFromUrl,
  startViewersPolling,
  startChatPolling,
  HAS_ENV_API_KEY,
  getCacheStats,
} from "@/lib/youtube";
import {
  requestNotificationPermission,
  getNotificationPermission,
  showForbidWordAlert,
  showViewerSpikeAlert,
  loadNotificationSettings,
  saveNotificationSettings,
  NotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
} from "@/lib/push-notification";
import { FORBID_EVENTS_KEY, appendForbidEvent, loadForbidEvents } from "@/lib/state";

type Point = { t: number; v: number | null };

export default function YoutubePage() {
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [liveChatId, setLiveChatId] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [alert, setAlert] = useState<string | null>(null);
  const [words, setWords] = useState<string>("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<Array<{ at: number; author: string; message: string; word: string }>>([]);
  const [chat, setChat] = useState<Array<{ id: string; at: number; author: string; message: string; owner: boolean; moderator: boolean; sponsor: boolean; verified: boolean }>>([]);
  const [viewerIntervalSec, setViewerIntervalSec] = useState(60); // 10초 → 60초로 증가
  const [viewerKeep, setViewerKeep] = useState(180);
  const [chatIntervalSec, setChatIntervalSec] = useState(30); // 10초 → 30초로 증가
  const [chatKeep, setChatKeep] = useState(300);
  const [latestOnTop, setLatestOnTop] = useState(true);
  const [autoKeep, setAutoKeep] = useState(true);
  const [authorFilter, setAuthorFilter] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [lastViewOk, setLastViewOk] = useState<number | null>(null);
  const [lastChatOk, setLastChatOk] = useState<number | null>(null);
  const [cacheStats, setCacheStats] = useState({ viewers: 0, livechat: 0 });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [lastViewerCount, setLastViewerCount] = useState<number | null>(null);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setUrl(getSavedVideoUrl() || "");
    setApiKey(getPreferredApiKey() || "");
    setLiveChatId(getPreferredLiveChatId());
    setEvents(loadForbidEvents());
    
    // 푸시 알림 설정 초기화
    const permission = getNotificationPermission();
    setNotificationPermission(permission);
    const settings = loadNotificationSettings();
    setNotificationSettings(settings);
    
    // 캐시 통계 주기적 업데이트
    const updateCacheStats = () => {
      const stats = getCacheStats();
      setCacheStats(stats);
    };
    
    updateCacheStats();
    const interval = setInterval(updateCacheStats, 5000); // 5초마다 업데이트
    
    return () => clearInterval(interval);
  }, []);

  // prominent alert: listen storage and also run polling for chat
  useEffect(() => {
    const stop = startYoutubePolling(words.split(/\r?\n/).map(w=>w.trim()).filter(Boolean), async ({word, author, message}: Parameters<OnForbidden>[0]) => {
      const text = `금칙어(${word}) - ${author}: ${message}`;
      const ev = { at: Date.now(), word, author, message };
      appendForbidEvent(ev);
      setEvents((prev)=>[ev, ...prev].slice(0,200));
      setAlert(text);
      
      // 푸시 알림 표시 (설정이 활성화된 경우)
      if (notificationSettings.forbidWord && notificationPermission === 'granted') {
        try {
          await showForbidWordAlert(word, author, message);
        } catch (error) {
          console.error('[Push Notification] 금칙어 알림 표시 실패:', error);
        }
      }
      
      // beep
      try {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        const ctx = audioCtxRef.current!;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "square";
        o.frequency.value = 880;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        o.start();
        o.stop(ctx.currentTime + 0.36);
      } catch {}
      const t = setTimeout(() => setAlert(null), 4000);
      return () => clearTimeout(t);
    });
    const handler = (e: StorageEvent) => {
      if (e.key === FORBID_EVENTS_KEY && e.newValue) {
        const arr = JSON.parse(e.newValue);
        setEvents(arr);
        const last = arr[0];
        if (last) setAlert(`금칙어(${last.word}) - ${last.author}: ${last.message}`);
      }
    };
    window.addEventListener("storage", handler);
    return () => {
      stop && stop();
      window.removeEventListener("storage", handler);
    };
  }, [words, notificationSettings, notificationPermission]);

  // viewers polling
  useEffect(() => {
    const id = parseVideoIdFromUrl(url || "");
    console.log(`[YouTube Viewers] 시청자 수 폴링 시작 - VideoId: ${id}`);
    if (!id) {
      console.log("[YouTube Viewers] 유효하지 않은 URL");
      return;
    }
    const stop = startViewersPolling(id, async (n) => {
      console.log(`[YouTube Viewers] 시청자 수 수신: ${n}`);
      
      // 시청자 수 급증 감지
      if (lastViewerCount !== null && n !== null && notificationSettings.viewerSpike && notificationPermission === 'granted') {
        const increase = n - lastViewerCount;
        if (increase >= notificationSettings.viewerSpikeThreshold) {
          try {
            await showViewerSpikeAlert(n, increase);
          } catch (error) {
            console.error('[Push Notification] 시청자 수 급증 알림 표시 실패:', error);
          }
        }
      }
      
      setLastViewerCount(n);
      setPoints((prev) => {
        const next = [...prev, { t: Date.now(), v: n }].slice(-viewerKeep);
        return next;
      });
      setLastViewOk(Date.now());
    });
    setConnected(true);
    return () => stop && stop();
  }, [url, viewerIntervalSec, viewerKeep, notificationSettings, notificationPermission, lastViewerCount]);

  // chat polling
  useEffect(() => {
    console.log(`[YouTube Chat] 채팅 폴링 설정 - URL: ${url}, LiveChatId: ${liveChatId}, API Key: ${!!apiKey}`);
    const stop = startChatPolling((msg) => {
      console.log(`[YouTube Chat] 채팅 메시지 수신: ${msg.author} - ${msg.message}`);
      setChat((prev) => {
        if (prev.some(p=>p.id===msg.id)) return prev;
        const next = [...prev, msg].slice(-chatKeep);
        return next;
      });
      setLastChatOk(Date.now());
    }, { intervalMs: chatIntervalSec * 1000, initialLimit: Math.min(1000, chatKeep), maxResults: 200 });
    console.log(`[YouTube Chat] 채팅 폴링 시작됨`);
    return () => stop && stop();
  }, [url, liveChatId, apiKey, chatIntervalSec, chatKeep]);

  useEffect(() => {
    const el = chatBoxRef.current;
    if (!el) return;
    if (latestOnTop) el.scrollTop = 0;
    else el.scrollTop = el.scrollHeight;
  }, [chat, latestOnTop, authorFilter, keywordFilter]);

  useEffect(() => {
    if (!autoKeep) return;
    const now = Date.now();
    const recent = chat.filter(m => m.at >= now - 60_000).length;
    let target = 300;
    if (recent > 50) target = 1000;
    if (recent > 200) target = 2000;
    if (target !== chatKeep) setChatKeep(target);
  }, [chat, autoKeep]);

  const connect = async () => {
    console.log(`[YouTube Connect] 연결 시도: ${url}`);
    const { liveChatId: id, videoId } = await setYoutubeVideoUrl(url.trim());
    console.log(`[YouTube Connect] 연결 결과 - LiveChatId: ${id}, VideoId: ${videoId}`);
    setLiveChatId(id);
  };
  const saveKey = () => {
    setPreferredApiKey(apiKey.trim());
    setApiKey(getPreferredApiKey() || "");
  };
  const clearKey = () => {
    clearPreferredApiKey();
    setApiKey(getPreferredApiKey() || "");
  };

  const current = points.length ? points[points.length - 1].v : null;
  const maxY = useMemo(() => {
    const nums = points.map(p => p.v || 0);
    const max = Math.max(10, ...nums);
    return Math.ceil(max / 10) * 10;
  }, [points]);

  const graph = useMemo(() => {
    const w = 600, h = 160;
    if (!points.length) return { d: "", ticks: [] as Array<{ x: number; label: string }> };
    const minT = points[0].t;
    const maxT = points[points.length - 1].t;
    const span = Math.max(1, maxT - minT);
    const scaleX = (t: number) => ((t - minT) / span) * w;
    const scaleY = (v: number) => h - (v / maxY) * h;
    let d = "";
    points.forEach((p, i) => {
      const x = scaleX(p.t);
      const y = scaleY((p.v || 0));
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    // 6등분 시간 눈금
    const ticks: Array<{ x: number; label: string }> = [];
    const parts = 6;
    for (let i = 0; i <= parts; i++) {
      const t = minT + (span * i) / parts;
      const x = scaleX(t);
      const d = new Date(t);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      const label = `${hh}:${mm}:${ss}`;
      ticks.push({ x, label });
    }
    return { d, ticks };
  }, [points, maxY]);

  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const highlightMsg = (s: string) => {
    let r = escapeHtml(s);
    const kf = keywordFilter.split(",").map(x=>x.trim()).filter(Boolean);
    kf.forEach((k) => {
      const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      r = r.replace(re, (m) => `<mark class="bg-red-600/60">${escapeHtml(m)}</mark>`);
    });
    return r;
  };

  const playBeep = () => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current!;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      o.start();
      o.stop(ctx.currentTime + 0.36);
    } catch {}
  };

  const triggerTestAlert = () => {
    const firstWord = words.split(/\r?\n/).map(w=>w.trim()).filter(Boolean)[0] || "TEST";
    const ev = { at: Date.now(), word: firstWord, author: "테스트봇", message: `이 메시지에 ${firstWord} 가 포함되었습니다.` };
    appendForbidEvent(ev);
    setEvents((prev)=>[ev, ...prev].slice(0,200));
    setAlert(`금칙어(${ev.word}) - ${ev.author}: ${ev.message}`);
    playBeep();
    const t = setTimeout(()=>setAlert(null), 4000);
    return () => clearTimeout(t);
  };

  // 푸시 알림 권한 요청
  const requestPushPermission = async () => {
    try {
      const permission = await requestNotificationPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        console.log('[Push Notification] 푸시 알림 권한 획득 성공');
      } else {
        console.log('[Push Notification] 푸시 알림 권한 거부됨');
      }
    } catch (error) {
      console.error('[Push Notification] 권한 요청 중 오류:', error);
    }
  };

  // 푸시 알림 설정 변경
  const updateNotificationSettings = (key: keyof NotificationSettings, value: any) => {
    const newSettings = { ...notificationSettings, [key]: value };
    setNotificationSettings(newSettings);
    saveNotificationSettings(newSettings);
    console.log(`[Push Notification] 설정 업데이트: ${key} = ${value}`);
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">유튜브 방송 모니터</h1>

        <section className="glass p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-3">연결</h2>
          <div className="flex flex-wrap gap-2">
            <input className="flex-1 px-3 py-2 rounded bg-neutral-900/80 border border-white/10" placeholder="유튜브 방송 URL" value={url} onChange={(e)=>setUrl(e.target.value)} />
            <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={connect}>연결</button>
          </div>
          <div className="text-xs text-neutral-400 mt-2">liveChatId: <span className="text-neutral-300">{liveChatId ?? "미설정"}</span></div>
          <div className="flex flex-wrap gap-2 mt-2 text-xs">
            <span className={`px-2 py-1 rounded ${apiKey ? "bg-emerald-700/60" : "bg-red-700/60"}`}>API키 {apiKey ? "있음" : "없음"}</span>
            <span className={`px-2 py-1 rounded ${liveChatId ? "bg-emerald-700/60" : "bg-red-700/60"}`}>liveChatId {liveChatId ? "설정" : "미설정"}</span>
            <span className="px-2 py-1 rounded bg-neutral-800/80">시청자 폴링 {lastViewOk ? <ClientTime ts={lastViewOk} /> : "대기"}</span>
            <span className="px-2 py-1 rounded bg-neutral-800/80">채팅 폴링 {lastChatOk ? <ClientTime ts={lastChatOk} /> : "대기"}</span>
          </div>
          <div className="h-px my-4 bg-white/10" />
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
              type="password"
              placeholder={HAS_ENV_API_KEY ? "Vercel 환경에서 키가 고정되어 있습니다" : "YouTube Data API 키 (로컬 저장)"}
              value={apiKey}
              onChange={(e)=>setApiKey(e.target.value)}
              readOnly={HAS_ENV_API_KEY}
            />
            {!HAS_ENV_API_KEY && (
              <>
                <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={saveKey}>키 저장</button>
                <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={clearKey}>키 삭제</button>
              </>
            )}
          </div>
          <div className="text-xs text-neutral-400 mt-2">
            {HAS_ENV_API_KEY ? "배포 환경에서 제공된 키가 사용되며, 페이지에서 수정할 수 없습니다." : "키는 브라우저 localStorage에만 저장됩니다."}
          </div>
        </section>

        <section className="glass p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-3">푸시 알림 설정</h2>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm text-neutral-300">푸시 알림 권한:</span>
              <span className={`px-2 py-1 rounded text-xs ${
                notificationPermission === 'granted' ? 'bg-emerald-700/60 text-emerald-300' :
                notificationPermission === 'denied' ? 'bg-red-700/60 text-red-300' :
                'bg-yellow-700/60 text-yellow-300'
              }`}>
                {notificationPermission === 'granted' ? '허용됨' :
                 notificationPermission === 'denied' ? '거부됨' :
                 '미확인'}
              </span>
              {notificationPermission !== 'granted' && (
                <button 
                  onClick={requestPushPermission}
                  className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white text-xs"
                >
                  권한 요청
                </button>
              )}
            </div>
            
            {notificationPermission === 'granted' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="forbidWord"
                    checked={notificationSettings.forbidWord}
                    onChange={(e) => updateNotificationSettings('forbidWord', e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="forbidWord" className="text-sm text-neutral-300">금칙어 감지 시 푸시 알림</label>
                </div>
                
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="viewerSpike"
                    checked={notificationSettings.viewerSpike}
                    onChange={(e) => updateNotificationSettings('viewerSpike', e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="viewerSpike" className="text-sm text-neutral-300">시청자 수 급증 시 푸시 알림</label>
                </div>
                
                {notificationSettings.viewerSpike && (
                  <div className="flex items-center gap-2 ml-6">
                    <label className="text-xs text-neutral-400">급증 기준:</label>
                    <input 
                      type="number" 
                      value={notificationSettings.viewerSpikeThreshold}
                      onChange={(e) => updateNotificationSettings('viewerSpikeThreshold', parseInt(e.target.value) || 1000)}
                      className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                      min="100"
                    />
                    <span className="text-xs text-neutral-400">명 이상 증가 시</span>
                  </div>
                )}
                
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="liveStart"
                    checked={notificationSettings.liveStart}
                    onChange={(e) => updateNotificationSettings('liveStart', e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="liveStart" className="text-sm text-neutral-300">라이브 방송 시작 시 푸시 알림</label>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="glass p-4 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">실시간 시청자수</h2>
            <div className="text-xl font-bold">{current == null ? "-" : current.toLocaleString()}</div>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <label className="text-xs text-neutral-400 self-center">폴링(초)</label>
            <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={viewerIntervalSec} onChange={(e)=>setViewerIntervalSec(Math.max(2, parseInt(e.target.value||"10",10)))} />
            <label className="text-xs text-neutral-400 self-center">표본 유지</label>
            <input className="w-24 px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={viewerKeep} onChange={(e)=>setViewerKeep(Math.max(30, parseInt(e.target.value||"180",10)))} />
          </div>
          <div className="relative w-full">
            <svg viewBox="0 0 600 190" className="w-full h-[200px] rounded bg-neutral-900/60 border border-white/10">
              <g transform="translate(0,10)">
                <line x1="0" y1="160" x2="600" y2="160" stroke="#ffffff22" />
                {graph.ticks.map((t, i) => (
                  <g key={i}>
                    <line x1={t.x} y1="0" x2={t.x} y2="160" stroke="#ffffff10" />
                    <text x={t.x} y="175" textAnchor="middle" fontSize="10" fill="#9ca3af">{t.label}</text>
                  </g>
                ))}
                <path d={graph.d} fill="none" stroke="#22c55e" strokeWidth="2" />
                {(() => {
                  const vals = points.map(p=>p.v||0);
                  if (!vals.length) return null;
                  const max = Math.max(...vals);
                  const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
                  const scaleY = (v: number) => 160 - (v / maxY) * 160;
                  return (
                    <>
                      <line x1="0" y1={scaleY(max)} x2="600" y2={scaleY(max)} stroke="#f59e0b" strokeDasharray="4 3" />
                      <text x="596" y={scaleY(max)-4} textAnchor="end" fontSize="10" fill="#f59e0b">max {max.toLocaleString()}</text>
                      <line x1="0" y1={scaleY(avg)} x2="600" y2={scaleY(avg)} stroke="#60a5fa" strokeDasharray="4 3" />
                      <text x="596" y={scaleY(avg)-4} textAnchor="end" fontSize="10" fill="#60a5fa">avg {Math.round(avg).toLocaleString()}</text>
                    </>
                  );
                })()}
              </g>
            </svg>
            <div className="text-xs text-neutral-400 mt-1">
            10초 간격 샘플 · 최근 {points.length}개 · 좌→우 시간 흐름 · y축 최대 {maxY}
          </div>
          <div className="text-xs text-neutral-400 mt-2 flex flex-wrap gap-4">
            <span>캐시: 시청자 {cacheStats.viewers}개 | 라이브챗 {cacheStats.livechat}개</span>
            <span>할당량 절약: API 호출 전 캐시 확인 및 웹 스크래핑 대체</span>
          </div>
          </div>
        </section>

        <section className="glass p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-3">실시간 채팅</h2>
          <div className="flex flex-wrap gap-2 mb-2">
            <label className="text-xs text-neutral-400 self-center">폴링(초)</label>
            <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={chatIntervalSec} onChange={(e)=>setChatIntervalSec(Math.max(2, parseInt(e.target.value||"10",10)))} />
            <label className="text-xs text-neutral-400 self-center">유지 개수</label>
            <input className="w-24 px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={chatKeep} onChange={(e)=>setChatKeep(Math.max(50, parseInt(e.target.value||"300",10)))} />
            <button className={`px-2 py-1 rounded border ${latestOnTop ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-300"}`} onClick={()=>setLatestOnTop(!latestOnTop)}>
              최신 {latestOnTop ? "상단" : "하단"}
            </button>
            <button className={`px-2 py-1 rounded border ${autoKeep ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-300"}`} onClick={()=>setAutoKeep(!autoKeep)}>
              자동 유지 {autoKeep ? "켜짐" : "꺼짐"}
            </button>
            <label className="text-xs text-neutral-400 self-center">작성자 필터</label>
            <input className="w-40 px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={authorFilter} onChange={(e)=>setAuthorFilter(e.target.value)} placeholder="쉼표로 다중 입력" />
            <label className="text-xs text-neutral-400 self-center">키워드 필터</label>
            <input className="w-56 px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={keywordFilter} onChange={(e)=>setKeywordFilter(e.target.value)} placeholder="쉼표로 다중 입력" />
          </div>
          <div ref={chatBoxRef} className="rounded border border-white/10 bg-neutral-900/60 max-h-[320px] overflow-auto">
            {chat.length === 0 && <div className="p-3 text-sm text-neutral-400">아직 수신된 채팅이 없습니다.</div>}
            {(latestOnTop ? [...chat].sort((a,b)=>b.at-a.at) : [...chat].sort((a,b)=>a.at-b.at))
              .filter((m) => {
                const af = authorFilter.split(",").map(s=>s.trim()).filter(Boolean);
                const kf = keywordFilter.split(",").map(s=>s.trim()).filter(Boolean);
                const authorOk = af.length ? af.some(a=>m.author.toLowerCase().includes(a.toLowerCase())) : true;
                const keywordOk = kf.length ? kf.some(k=>m.message.toLowerCase().includes(k.toLowerCase())) : true;
                return authorOk && keywordOk;
              })
              .map((m, i) => {
                const highlight = highlightMsg(m.message);
                const authorHit = authorFilter && authorFilter.split(",").some(a=>a.trim() && m.author.toLowerCase().includes(a.trim().toLowerCase()));
                return (
                  <div key={m.id} className="p-2 border-b border-white/5">
                    <ClientTime ts={m.at} className="text-xs text-neutral-400 mr-2" />
                    {m.owner && <span className="px-1.5 py-0.5 mr-1 rounded text-xs bg-fuchsia-700/70">owner</span>}
                    {m.moderator && <span className="px-1.5 py-0.5 mr-1 rounded text-xs bg-sky-700/70">mod</span>}
                    {m.sponsor && <span className="px-1.5 py-0.5 mr-1 rounded text-xs bg-emerald-700/70">sponsor</span>}
                    {m.verified && <span className="px-1.5 py-0.5 mr-1 rounded text-xs bg-yellow-700/70">verified</span>}
                    <span className={`font-semibold mr-2 ${authorHit ? "text-yellow-300" : "text-emerald-300"}`}>{m.author}</span>
                    <span className="text-neutral-200" dangerouslySetInnerHTML={{ __html: highlight }} />
                  </div>
                );
              })}
          </div>
        </section>

        <section className="glass p-4 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">금지어 알림</h2>
            <div className="flex gap-2">
              <button onClick={triggerTestAlert} className="px-3 py-1.5 rounded bg-red-700/70 hover:bg-red-600/70 text-white text-sm border border-white/10">
                테스트 알림
              </button>
              {notificationPermission === 'granted' && (
                <button 
                  onClick={async () => {
                    try {
                      await showForbidWordAlert('TEST', '테스트봇', '이것은 푸시 알림 테스트입니다.');
                      console.log('[Push Notification] 금칙어 푸시 알림 테스트 완료');
                    } catch (error) {
                      console.error('[Push Notification] 푸시 알림 테스트 실패:', error);
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-blue-700/70 hover:bg-blue-600/70 text-white text-sm border border-white/10"
                >
                  푸시 테스트
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3">
            <div className="space-y-2">
              <div className="rounded border border-red-500/70 bg-gradient-to-br from-red-900/80 to-yellow-800/60 text-white px-3 py-2">
                <div className="text-sm font-semibold">{alert ? alert : "최근 감지된 금지어가 여기에 표시됩니다."}</div>
              </div>
              <div className="rounded border border-white/10 bg-neutral-900/60 max-h-[280px] overflow-auto">
                {events.length === 0 && <div className="p-3 text-sm text-neutral-400">로그가 없습니다.</div>}
                {events.map((ev, i) => (
                  <div key={i} className="p-3 border-b border-white/5">
                    <ClientTime ts={ev.at} className="text-xs text-neutral-400" />
                    <div className="text-red-300 font-semibold">[{ev.word}]</div>
                    <div className="text-sm"><span className="text-emerald-300">{ev.author}</span>: {ev.message}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-neutral-400">한 줄에 하나씩 입력</div>
              <textarea className="w-full h-[260px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10 font-mono"
                value={words}
                onChange={(e)=>setWords(e.target.value)}
                placeholder={"금지어 목록"}
              />
            </div>
          </div>
        </section>

        <section className="glass p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-3">금지어 감지 설정</h2>
          <textarea className="w-full h-[160px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10 font-mono"
            value={words}
            onChange={(e)=>setWords(e.target.value)}
            placeholder={"한 줄에 하나씩 금지어를 입력하세요.\n이 페이지에서 바로 감지/알림합니다."}
          />
        </section>
      </div>

      {alert && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="px-4 py-3 rounded-lg border border-red-500/70 bg-red-900/80 text-white font-semibold drop-shadow animate-pulse">
            {alert}
          </div>
        </div>
      )}
    </main>
  );
}

function ClientTime({ ts, className }: { ts: number; className?: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Date(ts).toLocaleTimeString());
  }, [ts]);
  return <span suppressHydrationWarning className={className}>{text}</span>;
}
