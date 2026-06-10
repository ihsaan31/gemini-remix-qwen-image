import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qwen + Wan Generator",
  description: "Generate images with Qwen and videos with Wan on RunPod."
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
