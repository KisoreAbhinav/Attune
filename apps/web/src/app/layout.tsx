import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ViewTransitions } from "next-view-transitions";
import styles from "./transitions.module.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Attune",
  description: "Explore the Attune image analysis demo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ViewTransitions>
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${styles.transitions} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
    </ViewTransitions>
  );
}
