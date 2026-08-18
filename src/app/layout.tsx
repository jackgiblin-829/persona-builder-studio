import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Persona Builder Studio",
  description:
    "Build evidence-backed personas and realistic-search prompt taxonomies from brand research and SparkToro.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
