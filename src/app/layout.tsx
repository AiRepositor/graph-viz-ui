import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GraphViz — Interactive Project Graph",
  description: "Interactive graph visualization of repos and agent artifacts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
