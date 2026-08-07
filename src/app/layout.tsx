import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Persona Evidence Studio",
  description:
    "Evidence-backed persona and prompt strategy layer for Profound. Personas are testable hypotheses, not real people.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
