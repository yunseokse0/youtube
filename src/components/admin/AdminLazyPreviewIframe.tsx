"use client";

import { useEffect, useRef, useState, type CSSProperties, type IframeHTMLAttributes } from "react";

type Props = Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src"> & {
  src: string;
  title: string;
};

/**
 * 관리자 미리보기 iframe은 각각 Next 앱 + /api/state 폴링이라
 * 화면 밖까지 한꺼번에 열면 서버 연결이 밀린다. 뷰포트에 들어온 뒤에만 src를 붙인다.
 */
export default function AdminLazyPreviewIframe({ src, title, className, style, ...rest }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!src) return;
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShow(true);
      },
      { root: null, rootMargin: "160px 0px", threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);

  const fill: CSSProperties = { background: "transparent", ...(style || {}) };

  return (
    <div ref={hostRef} className="absolute inset-0">
      {show ? (
        <iframe src={src} title={title} className={className} style={fill} {...rest} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[11px] text-neutral-600">
          미리보기 대기
        </div>
      )}
    </div>
  );
}
