import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attune",
  description: "Explore the Attune image analysis demo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="dark h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
