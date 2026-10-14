import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

// Everything but eyebrows — Satoshi (Indian Type Foundry, ITF Free Font License, see src/fonts/satoshi).
// The licence forbids modifying the file (no subsetting or conversion) and redistributing it through a
// public repository: the official variable woff2 is self-hosted as shipped, and this repo stays private.
const satoshi = localFont({
  variable: "--font-satoshi",
  display: "swap",
  src: [{ path: "../fonts/satoshi/Satoshi-Variable.woff2", weight: "300 900", style: "normal" }],
});

// Eyebrows only — Geist Mono (SIL Open Font License), self-hosted by next/font at build time
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
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
    <html lang="en" className={`${satoshi.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
