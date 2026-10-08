import type { Metadata } from "next";
import "./globals.css";

// System fonts on purpose: no network font fetch, so builds work on any venue Wi-Fi.
export const metadata: Metadata = {
  title: "Job Match",
  description: "AI job matching with explained results",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
