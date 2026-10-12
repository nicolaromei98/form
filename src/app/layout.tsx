import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Display role — Aeonik Pro (client-specified, licensed Pro files)
const aeonik = localFont({
  variable: "--font-aeonik",
  display: "block",
  adjustFontFallback: false,
  src: [
    { path: "../fonts/AeonikPro-Light.woff2", weight: "300", style: "normal" },
    { path: "../fonts/AeonikPro-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/AeonikPro-Medium.woff2", weight: "500", style: "normal" },
  ],
});

// Body + metadata role — Aeonik Mono Pro (client-specified)
const aeonikMono = localFont({
  variable: "--font-aeonik-mono",
  display: "block",
  adjustFontFallback: false,
  src: [
    { path: "../fonts/AeonikMonoPro-Light.woff2", weight: "300", style: "normal" },
    { path: "../fonts/AeonikMonoPro-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/AeonikMonoPro-Medium.woff2", weight: "500", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "FORM — The Living Interface",
  description: "A living workspace that turns intention into interactive tools.",
};

export const viewport: Viewport = {
  themeColor: "#e9e9e6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${aeonik.variable} ${aeonikMono.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
