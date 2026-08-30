import type { Metadata } from "next";
import { ConvexClientProvider } from "../components/ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse | Digia",
  description: "Pulse helps product teams understand what users are struggling with and what to act on next.",
  openGraph: {
    title: "Pulse | Digia",
    description: "Pulse helps product teams understand what users are struggling with and what to act on next.",
    siteName: "Pulse by Digia",
    type: "website",
  },
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
