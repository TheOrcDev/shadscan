import type { Metadata } from "next";
import { Geist_Mono, Nunito_Sans, Outfit } from "next/font/google";

import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getSiteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";

const nunitoSansHeading = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  description: "The CLI that audits a shadcn app for missing UI fundamentals.",
  metadataBase: getSiteUrl(),
  openGraph: {
    description:
      "Audit command menus, UI states, accessibility basics, metadata, and more with deterministic evidence.",
    siteName: "Shadscan",
    title: "Shadscan",
    type: "website",
    url: "/",
  },
  title: {
    default: "Shadscan",
    template: "%s | Shadscan",
  },
  twitter: {
    card: "summary_large_image",
    description:
      "Audit command menus, UI states, accessibility basics, metadata, and more with deterministic evidence.",
    title: "Shadscan",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        outfit.variable,
        nunitoSansHeading.variable
      )}
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <SiteHeader />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
