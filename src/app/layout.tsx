import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "./providers";
import AppFooter from "@/components/common/AppFooter";
import AppHeader from "@/components/common/AppHeader/AppHeader";
import { BRAND_NAME } from "@/lib/brand";
import "./globals.css";

const display = Rubik({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description: "Events from a walk to a convention: event pages, registration, tickets with QR check-in, badges, rooms and community in one place.",
  authors: [{ name: "Markus Löffler", url: "https://github.com/MarkusLoeffler01/Ventry"}]
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={display.variable} suppressHydrationWarning>
      <body
        className="antialiased"
        style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
      >
        <InitColorSchemeScript attribute="class" />
        <AppRouterCacheProvider>
          <Suspense fallback={null}>
            <Providers>
              <AppHeader />
              <main style={{ display: "flex", flex: "1 0 auto", flexDirection: "column" }}>
                {children}
              </main>
              <AppFooter />
            </Providers>
          </Suspense>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
