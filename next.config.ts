import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname
  },
  typescript: {
    ignoreBuildErrors: false
  }
};

export default nextConfig;
