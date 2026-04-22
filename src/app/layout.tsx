import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AutoFollowUp AI — Never Lose a Lead Again",
  description:
    "AI-powered lead follow-up for service businesses. Automatically reply to Facebook comments and messages, qualify leads, and follow up until they book.",
  openGraph: {
    title: "AutoFollowUp AI — Never Lose a Lead Again",
    description:
      "AI-powered lead follow-up for service businesses. Automatically reply to Facebook comments and messages, qualify leads, and follow up until they book.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full`}>{children}</body>
    </html>
  );
}
