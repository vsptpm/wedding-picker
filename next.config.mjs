/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp"],
  devIndicators: false,
};

export default nextConfig;
