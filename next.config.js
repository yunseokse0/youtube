/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  async redirects() {
    return [{ source: "/ui-demo", destination: "/admin", permanent: false }];
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
