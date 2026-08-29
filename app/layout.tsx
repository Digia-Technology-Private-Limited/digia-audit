import type { Metadata } from "next";
import { ConvexClientProvider } from "../components/ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Digia Audit",
  description: "Find the user problem your product should act on next.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><ConvexClientProvider>{children}</ConvexClientProvider></body>
    </html>
  );
}
