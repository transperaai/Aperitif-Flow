import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: BRAND.name,
  description: "Turn documented workflows into a runnable model.",
  applicationName: BRAND.name,
  appleWebApp: { title: BRAND.name },
  openGraph: { siteName: BRAND.name, title: BRAND.name, description: "Turn documented workflows into a runnable model." },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("h-full font-sans antialiased", inter.variable, plexMono.variable)}>
      <body className="flex min-h-full flex-col font-sans text-sm">{children}</body>
    </html>
  );
}
