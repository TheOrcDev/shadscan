import type { Metadata } from "next";
import { Geist_Mono, Nunito_Sans, Outfit } from "next/font/google";

import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import {
  getGitHubStargazerCount,
  SOURCE_CODE_GITHUB_REPO,
} from "@/lib/github-stars";
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
    siteName: "shadscan",
    title: "shadscan",
    type: "website",
    url: "/",
  },
  title: {
    default: "shadscan",
    template: "%s | shadscan",
  },
  twitter: {
    card: "summary_large_image",
    description:
      "Audit command menus, UI states, accessibility basics, metadata, and more with deterministic evidence.",
    title: "shadscan",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const stargazersCount = await getGitHubStargazerCount();

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
          <div className="flex min-h-svh flex-col">
            <SiteHeader
              githubRepo={SOURCE_CODE_GITHUB_REPO}
              stargazersCount={stargazersCount}
            />
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            <SiteFooter />
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
