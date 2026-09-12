import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChangeGuard — Infrastructure Change Intelligence",
  description: "Analyze infrastructure dependencies, risk, evidence, and change plans before making a change.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
