/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  async rewrites() {
    return [
      // Normalize overlay route to avoid 404s in certain host setups
      { source: '/overlay', destination: '/overlay' },
      { source: '/overlay/', destination: '/overlay' },
      { source: '/overlay/:path*', destination: '/overlay' },
    ];
  },
};

module.exports = nextConfig;
