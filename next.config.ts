import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname
  },
  typescript: {
    ignoreBuildErrors: false
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
