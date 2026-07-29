import type { Metadata } from "next";
import "./globals.css";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const basePath =
  process.env.GITHUB_ACTIONS === "true" && repositoryName
    ? `/${repositoryName}`
    : "";
const siteUrl =
  basePath
    ? `https://kaleohano.github.io/${repositoryName}`
    : "https://sparkboard-ideas.itskaleohano.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "灵感胶囊｜打开就能一起想",
  description: "一个打开就能用的自由脑暴白板，写便利贴、拖动想法、为好点子投票。",
  openGraph: {
    title: "灵感胶囊｜打开就能一起想",
    description: "自由写便利贴、拖动想法，为好点子投票。",
    type: "website",
    images: [{ url: "/og-v6.png", width: 1200, height: 630, alt: "延伸到画面之外的灵感胶囊与彩色便利贴" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "灵感胶囊｜打开就能一起想",
    description: "自由写便利贴、拖动想法，为好点子投票。",
    images: ["/og-v6.png"],
  },
  icons: {
    icon: `${basePath}/favicon.svg`,
    shortcut: `${basePath}/favicon.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
