import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { UI_PREFS_BOOT_SCRIPT } from "@/lib/ui-prefs-cache";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spok — Live Harness for Grok Build",
  description:
    "Live thinking-trace and repo-diff visualizer for Grok Build sessions. Professional and CRT themes with durable sessions and a hardened local runtime.",
  icons: {
    icon: "/favicon.ico",
  },
  appleWebApp: {
    capable: true,
    title: "Spok",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

/** Phone-friendly viewport; desktop unchanged. Safe-area for notched devices. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0c0e12",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" data-theme="professional" suppressHydrationWarning>
      <head>
        {/* Apply cached CRT/theme before paint — must not wait on /api/settings */}
        <script dangerouslySetInnerHTML={{ __html: UI_PREFS_BOOT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
