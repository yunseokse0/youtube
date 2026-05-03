/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  async redirects() {
    return [
      { source: "/ui-demo", destination: "/admin", permanent: false },
      /** OBS 예전 URL: 하이픈 대신 밑줄로 붙인 소스는 404 → 통합 오버레이로 유지(쿼리 유지) */
      { source: "/overlay/sig_select", destination: "/overlay/sig-sales", permanent: false },
    ];
  },
  async rewrites() {
    return [
      // 끝 슬래시만 메인 오버레이로 통일 (하위 경로 /overlay/meal-match 등은 그대로 두어야 함)
      { source: '/overlay/', destination: '/overlay' },
    ];
  },
  async headers() {
    return [
      {
        source: '/overlay',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
