/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  reactStrictMode: true,

  webpack(config) {
    return config;
  },
};

export default nextConfig;
