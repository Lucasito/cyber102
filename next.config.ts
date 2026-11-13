import type { NextConfig } from "next";

const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      // Всё, кроме виджета, не встраивается в чужие страницы (защита от кликджекинга)
      {
        source: "/((?!widget).*)",
        headers: [...security, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
      // Виджет встраивается на сайт министерства и другие сайты
      { source: "/widget", headers: [...security, { key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      { source: "/widget.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
};

export default nextConfig;
