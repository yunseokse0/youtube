"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "admin.sectionCollapse.v1";

type CollapseMap = Record<string, boolean>;

type AdminSectionCollapseContextValue = {
  isOpen: (id: string, defaultOpen?: boolean) => boolean;
  setOpen: (id: string, open: boolean) => void;
  toggle: (id: string, defaultOpen?: boolean) => void;
  expand: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  register: (id: string) => void;
};

const AdminSectionCollapseContext = createContext<AdminSectionCollapseContextValue | null>(null);

function readStoredMap(): CollapseMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CollapseMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function AdminSectionCollapseProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<CollapseMap>({});
  const [hydrated, setHydrated] = useState(false);
  const idsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMap(readStoredMap());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* ignore quota */
    }
  }, [hydrated, map]);

  const register = useCallback((id: string) => {
    const key = String(id || "").trim();
    if (key) idsRef.current.add(key);
  }, []);

  const isOpen = useCallback(
    (id: string, defaultOpen = true) => {
      const key = String(id || "").trim();
      if (!key) return defaultOpen;
      if (Object.prototype.hasOwnProperty.call(map, key)) return map[key] === true;
      return defaultOpen;
    },
    [map]
  );

  const setOpen = useCallback((id: string, open: boolean) => {
    const key = String(id || "").trim();
    if (!key) return;
    idsRef.current.add(key);
    setMap((prev) => (prev[key] === open ? prev : { ...prev, [key]: open }));
  }, []);

  const toggle = useCallback(
    (id: string, defaultOpen = true) => {
      const key = String(id || "").trim();
      if (!key) return;
      setOpen(key, !isOpen(key, defaultOpen));
    },
    [isOpen, setOpen]
  );

  const expand = useCallback(
    (id: string) => {
      setOpen(id, true);
    },
    [setOpen]
  );

  const expandAll = useCallback(() => {
    setMap((prev) => {
      const next = { ...prev };
      for (const id of idsRef.current) next[id] = true;
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setMap((prev) => {
      const next = { ...prev };
      for (const id of idsRef.current) next[id] = false;
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ isOpen, setOpen, toggle, expand, expandAll, collapseAll, register }),
    [isOpen, setOpen, toggle, expand, expandAll, collapseAll, register]
  );

  return (
    <AdminSectionCollapseContext.Provider value={value}>{children}</AdminSectionCollapseContext.Provider>
  );
}

export function useAdminSectionCollapse(): AdminSectionCollapseContextValue {
  const ctx = useContext(AdminSectionCollapseContext);
  if (!ctx) {
    return {
      isOpen: (_id, defaultOpen = true) => defaultOpen,
      setOpen: () => {},
      toggle: () => {},
      expand: () => {},
      expandAll: () => {},
      collapseAll: () => {},
      register: () => {},
    };
  }
  return ctx;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-white/15 bg-black/30 text-[10px] text-neutral-300 transition-transform ${
        open ? "rotate-90" : ""
      }`}
      aria-hidden
    >
      ▶
    </span>
  );
}

type SectionProps = {
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  headerAside?: ReactNode;
  children: ReactNode;
};

/** 상위 카드형 섹션 (panel) */
export function AdminCollapsibleSection({
  id,
  title,
  defaultOpen = true,
  className = "",
  bodyClassName = "px-4 pb-4 pt-2 md:px-6 md:pb-6",
  headerClassName = "px-4 pt-4 md:px-6 md:pt-6",
  headerAside,
  children,
}: SectionProps) {
  const { isOpen, toggle, register } = useAdminSectionCollapse();
  const open = isOpen(id, defaultOpen);

  useEffect(() => {
    register(id);
  }, [id, register]);

  return (
    <section id={id} className={className} data-admin-section={id} data-open={open ? "1" : "0"}>
      <div
        className={`flex flex-wrap items-start justify-between gap-2 ${headerClassName} ${
          open ? "border-b border-white/10 pb-3" : "pb-4 md:pb-6"
        }`}
      >
        <button
          type="button"
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left hover:bg-white/[0.04] -mx-1 px-1 py-0.5"
          aria-expanded={open}
          onClick={() => toggle(id, defaultOpen)}
        >
          <Chevron open={open} />
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <span className="hidden text-[11px] text-neutral-500 sm:inline group-hover:text-neutral-400">
            {open ? "접기" : "펼치기"}
          </span>
        </button>
        {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
      </div>
      {open ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  );
}

type BlockProps = {
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  headerAside?: ReactNode;
  children: ReactNode;
};

/** 카드 안쪽 하위 블록 */
export function AdminCollapsibleBlock({
  id,
  title,
  defaultOpen = true,
  className = "",
  headerAside,
  children,
}: BlockProps) {
  const { isOpen, toggle, register } = useAdminSectionCollapse();
  const open = isOpen(id, defaultOpen);

  useEffect(() => {
    register(id);
  }, [id, register]);

  return (
    <div
      id={id}
      className={className}
      data-admin-block={id}
      data-open={open ? "1" : "0"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          className="group flex min-w-0 flex-1 items-center gap-2 rounded text-left hover:bg-white/[0.04] -mx-1 px-1 py-0.5"
          aria-expanded={open}
          onClick={() => toggle(id, defaultOpen)}
        >
          <Chevron open={open} />
          <div className="min-w-0 text-base font-semibold text-inherit">{title}</div>
          <span className="hidden text-[11px] text-neutral-500 sm:inline group-hover:text-neutral-400">
            {open ? "접기" : "펼치기"}
          </span>
        </button>
        {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
      </div>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

export function AdminCollapseToolbar({ className = "" }: { className?: string }) {
  const { expandAll, collapseAll } = useAdminSectionCollapse();
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <button
        type="button"
        className="rounded border border-white/15 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
        onClick={expandAll}
      >
        섹션 모두 펼치기
      </button>
      <button
        type="button"
        className="rounded border border-white/15 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
        onClick={collapseAll}
      >
        섹션 모두 접기
      </button>
    </div>
  );
}

/** 좌측 네비 이동 시 대상·부모 섹션을 펼친 뒤 스크롤 */
export const ADMIN_SECTION_EXPAND_PARENTS: Record<string, string> = {
  "overlay-goal-shortcut": "overlay-settings",
  "high-society-mode": "donor-management",
  "high-society-overlay": "overlay-settings",
  "overlay-bg-media": "overlay-settings",
  "timer-control-section": "settlement-member-board",
  "block-member-positions": "settlement-member-board",
  "block-donation-sync": "settlement-member-board",
  "block-sig-match": "settlement-member-board",
  "block-meal-match": "settlement-member-board",
  "block-sig-sales": "settlement-member-board",
  "block-sig-rolling": "settlement-member-board",
  "block-sig-inventory": "settlement-member-board",
};
