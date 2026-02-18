/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true
  },
  env: {
    NEXT_PUBLIC_YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  },
};

module.exports = nextConfig;
