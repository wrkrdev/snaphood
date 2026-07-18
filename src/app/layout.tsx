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

// Runs before first paint to set the theme from a saved choice or the OS preference,
// so there is never a flash of the wrong theme on load.
const themeInitScript = `(function(){try{var t=localStorage.getItem("snaphood-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
