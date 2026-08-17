/** @type {import('next').NextConfig} */
/** deploy/build-prod.mjs 가 NEXT_USE_STAGING_DIST=1 일 때만 스테이징 distDir (next start 런타임 오염 방지) */
const useStagingDist = String(process.env.NEXT_USE_STAGING_DIST || "").trim() === "1";
const stagingDir = useStagingDist
  ? String(process.env.NEXT_BUILD_DIR || ".next-staging").trim()
  : "";
const nextConfig = {
  ...(stagingDir ? { distDir: stagingDir } : {}),
  trailingSlash: false,
  async redirects() {
    return [
      { source: "/ui-demo", destination: "/admin", permanent: false },
      /** OBS 예전 URL: 하이픈 대신 밑줄로 붙인 소스는 404 → 통합 오버레이로 유지(쿼리 유지) */
      { source: "/overlay/sig_select", destination: "/overlay/sig-sales", permanent: false },
      { source: "/overlay/sig_match/demo", destination: "/overlay/sig-match/demo", permanent: false },
      { source: "/overlay/sig_match", destination: "/overlay/sig-match", permanent: false },
      /** OBS에 흔한 오타: `sig-sales/manual` → `sig-sales-manual` */
      { source: "/overlay/sig-sales/manual", destination: "/overlay/sig-sales-manual", permanent: false },
      { source: "/overlay/sig-sales/manual/:path*", destination: "/overlay/sig-sales-manual/:path*", permanent: false },
      /** 후원 팝업 오타 경로 */
      { source: "/player_alert", destination: "/player-alert", permanent: false },
      { source: "/player_alert/:path*", destination: "/player-alert/:path*", permanent: false },
      /** OBS 예전 플레이어 오버레이 → 웹 팝업 */
      { source: "/overlay/player", destination: "/player-alert", permanent: false },
      { source: "/overlay/player/:path*", destination: "/player-alert/:path*", permanent: false },
      /** 후원순위 전체(분홍) 제거 — OBS 예전 URL */
      { source: "/overlay/donor-rankings-full", destination: "/overlay/donor-rankings", permanent: false },
      { source: "/overlay/donor-rankings-full/:path*", destination: "/overlay/donor-rankings", permanent: false },
    ];
  },
  async rewrites() {
    return {
      afterFiles: [
        // 끝 슬래시만 메인 오버레이로 통일 (하위 경로 /overlay/meal-match 등은 그대로 두어야 함)
        { source: "/overlay/", destination: "/overlay" },
      ],
      /** public/ 에 파일이 없을 때만 Node API로 — 있으면 정적 파일 우선(시그 GIF 수백 장 시 502 완화) */
      fallback: [
        { source: "/images/sigs/:path*", destination: "/api/sig-legacy/:path*" },
        { source: "/images/sig/:path*", destination: "/api/sig-legacy/:path*" },
        { source: "/uploads/sigs/:path*", destination: "/api/uploads-sigs/:path*" },
        { source: "/uploads/images/:file", destination: "/api/uploads-sigs/:file" },
      ],
    };
  },
  async headers() {
    const staticCache =
      process.env.NODE_ENV === "development"
        ? "no-store, no-cache, must-revalidate"
        : "public, max-age=31536000, immutable";
    return [
      {
        source: '/admin',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/login',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/overlay',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: staticCache }],
      },
    ];
  },
  /** Windows dev: webpack pack 캐시 rename ENOENT → _next/static 404 방지 */
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.cache = { type: "memory" };
    }
    if (isServer) {
      const prev = config.externals;
      const add = ["mysql2", "mysql2/promise"];
      if (Array.isArray(prev)) config.externals = [...prev, ...add];
      else if (typeof prev === "function") {
        config.externals = [
          prev,
          ({ request }, cb) => {
            if (request && add.includes(request)) return cb(null, `commonjs ${request}`);
            cb();
          },
        ];
      } else if (prev) config.externals = [prev, ...add];
      else config.externals = add;
    }
    return config;
  },
  /** EC2 1GB 등: deploy/build-prod.mjs 가 LOW_MEMORY_BUILD=1 설정 */
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["mysql2"],
    ...(process.env.LOW_MEMORY_BUILD === "1"
      ? {
          cpus: 1,
        }
      : {}),
  },
};

module.exports = nextConfig;
