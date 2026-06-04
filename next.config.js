/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  async redirects() {
    return [
      { source: "/ui-demo", destination: "/admin", permanent: false },
      /** OBS 예전 URL: 하이픈 대신 밑줄로 붙인 소스는 404 → 통합 오버레이로 유지(쿼리 유지) */
      { source: "/overlay/sig_select", destination: "/overlay/sig-sales", permanent: false },
      { source: "/overlay/sig_match/demo", destination: "/overlay/sig-match/demo", permanent: false },
      { source: "/overlay/sig_match", destination: "/overlay/sig-match", permanent: false },
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
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },
  /** EC2 1GB 등: deploy/build-prod.mjs 가 LOW_MEMORY_BUILD=1 설정 */
  ...(process.env.LOW_MEMORY_BUILD === "1"
    ? {
        experimental: {
          cpus: 1,
        },
      }
    : {}),
};

module.exports = nextConfig;
