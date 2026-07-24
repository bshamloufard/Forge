import type { Metadata } from "next";
import "./product-ui.css";

export const metadata: Metadata = {
  title: "Forge — Post-training workspace",
  description: "Train, evaluate, and deploy post-trained models from one control plane."
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
