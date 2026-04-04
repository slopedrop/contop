import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Navbar } from "@/components/layout/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contop — Your Desktop, From Anywhere",
  description:
    "Contop is a remote compute agent — control your desktop from your phone with AI-powered automation, from anywhere.",
  metadataBase: new URL("https://contop.app"),
  openGraph: {
    title: "Contop — Your Desktop, From Anywhere",
    description:
      "Contop is a remote compute agent — control your desktop from your phone with AI-powered automation, from anywhere.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Contop — Your Desktop, From Anywhere",
    description:
      "Contop is a remote compute agent — control your desktop from your phone with AI-powered automation, from anywhere.",
  },
  alternates: {
    canonical: "https://contop.app",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
          <Navbar />
          {children}
        </body>
    </html>
  );
}
