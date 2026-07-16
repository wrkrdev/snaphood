import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SnapHood",
  description: "Snap anything into a Robinhood Chain meme token demo."
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
