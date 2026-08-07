import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This repo sits inside a workspace with other lockfiles; pin the root so
  // Next does not infer the parent directory.
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["postgres", "mammoth"],
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
