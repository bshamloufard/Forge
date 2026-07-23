import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forge Tinkering MVP",
  description: "A Tinker-class post-training control plane MVP"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
