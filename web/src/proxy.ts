import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Runs before every page/API request:
//  1. builds a per-request CSP nonce,
//  2. refreshes the Supabase session cookie,
//  3. optimistically redirects signed-out visitors away from staff pages.
// Real authorization happens again in the Data Access Layer and in the database (RLS + RPC checks).

const PUBLIC_PREFIXES = [
  "/login", "/forgot-password", "/reset-password", "/auth/", "/enquiry", "/share/", "/api/public/", "/api/health", "/api/cron/",
];

function csp(nonce: string, isDev: boolean): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const tileTemplate = process.env.MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileOrigin = (() => {
    try {
      const origin = new URL(tileTemplate.replace(/\{[a-z]+\}/g, "0")).origin;
      // "{s}.tile.example.org" style templates need a subdomain wildcard.
      return tileTemplate.includes("{s}.") ? origin.replace("://0.", "://*.") : origin;
    } catch {
      return "";
    }
  })();
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are needed by chart/map libraries; scripts stay nonce-locked.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tileOrigin}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${supabase.replace("https://", "wss://")}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let signedIn = false;
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  }

  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  if (!signedIn && !isPublic && !path.startsWith("/api/")) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    const redirect = NextResponse.redirect(to);
    redirect.headers.set("Content-Security-Policy", policy);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation output.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|woff2?)$).*)",
  ],
};
