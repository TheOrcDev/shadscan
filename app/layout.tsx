import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist_Mono, Nunito_Sans, Outfit } from "next/font/google";

import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getHeaderGitHubRepository } from "@/lib/public-github-repository";
import {
  createPageMetadata,
  createRobotsMetadata,
  ORCDEV_URL,
  SITE_DEFAULT_TITLE,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/site-metadata";
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

const homeMetadata = createPageMetadata({
  description: SITE_DESCRIPTION,
  path: "/",
  socialTitle: SITE_DEFAULT_TITLE,
  title: SITE_DEFAULT_TITLE,
});

const googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
  ...homeMetadata,
  applicationName: SITE_NAME,
  authors: [{ name: "OrcDev", url: ORCDEV_URL }],
  category: "technology",
  creator: "OrcDev",
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
  metadataBase: getSiteUrl(),
  publisher: "OrcDev",
  referrer: "origin-when-cross-origin",
  robots: createRobotsMetadata(),
  title: {
    default: SITE_DEFAULT_TITLE,
    template: "%s | shadscan",
  },
  ...(googleSiteVerification
    ? { verification: { google: googleSiteVerification } }
    : {}),
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { color: "#ffffff", media: "(prefers-color-scheme: light)" },
    { color: "#171717", media: "(prefers-color-scheme: dark)" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const githubRepository = await getHeaderGitHubRepository();

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
            <SiteHeader githubRepository={githubRepository} />
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            <SiteFooter />
          </div>
          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
