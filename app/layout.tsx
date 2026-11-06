import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UNSPOKEN — Your gang. Full masti.",
  description: "A private party game. Ask a question, vote anonymously, and find out what your friends really think.",
  manifest: '/manifest.webmanifest',
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#fffefa'};
