import type { Metadata } from "next";
import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: "SnapHood",
    template: "%s | SnapHood"
  },
  description: "Snap anything into a Robinhood Chain meme token demo.",
  openGraph: {
    title: "SnapHood",
    description: "Snap anything into a Robinhood Chain meme token demo.",
    url: "/",
    siteName: "SnapHood",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "SnapHood",
    description: "Snap anything into a Robinhood Chain meme token demo."
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
