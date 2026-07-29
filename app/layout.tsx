import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  metadataBase: new URL("https://sparkboard-ideas.itskaleohano.chatgpt.site"),
  title: "灵光板｜打开就能一起想",
  description: "一个打开就能用的自由脑暴白板，写便利贴、拖动想法、为好点子投票。",
  openGraph: {
    title: "灵光板｜打开就能一起想",
    description: "自由写便利贴、拖动想法，为好点子投票。",
    type: "website",
    images: [{ url: "/og-v3.png", width: 1731, height: 909, alt: "复古纸张风格的灵光板与便利贴" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "灵光板｜打开就能一起想",
    description: "自由写便利贴、拖动想法，为好点子投票。",
    images: ["/og-v3.png"],
  },
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
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
