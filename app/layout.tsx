import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "1K Daily",
  description: "Pick 3–10 · split a grand · fastest bag wins",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
