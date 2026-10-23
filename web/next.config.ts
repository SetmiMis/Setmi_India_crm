import type { NextConfig } from "next";

// Security headers that do not depend on the request. The Content-Security-Policy (which needs
// a per-request nonce) is set in src/proxy.ts. See docs/SECURITY.md.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Only meaningful over HTTPS; browsers ignore it on plain HTTP (local dev).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for Node hosting (Hostinger). See docs/DEPLOYMENT_HOSTINGER.md.
  output: "standalone",
  poweredByHeader: false,
  // Cache Components stays OFF on purpose: nearly every page shows per-user, permission-filtered
  // data, so everything renders at request time and nothing is shared between users (ADR-0002).
  experimental: {
    serverActions: {
      // PDF attachments (≤10 MB) and bulk-import payloads travel through Server Actions.
      bodySizeLimit: "11mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
