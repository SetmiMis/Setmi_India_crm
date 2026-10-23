import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
// Brand fonts, self-hosted from npm (no runtime call to Google Fonts; keeps the CSP to 'self').
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SETMI INDIA CRM", template: "%s · SETMI INDIA CRM" },
  description: "SETMI INDIA Sales FMS — Enquiry to Order. Engineered for the Extraordinary.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f9dc7" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme comes from a cookie so no inline script is needed (keeps the CSP strict).
  const theme = (await cookies()).get("theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang="en" data-theme={theme}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
