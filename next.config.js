/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode for catching React bugs early
  reactStrictMode: true,

  // Path alias handled via jsconfig.json; also declare here for Next.js
  // (next automatically picks up jsconfig paths)

  // Silence Lovable-specific module warnings during build
  webpack(config) {
    return config;
  },
};

export default nextConfig;
