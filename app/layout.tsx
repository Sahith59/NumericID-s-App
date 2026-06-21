import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BoLD Numeric Orders Lab",
  description: "Standalone BoLD BOLA test app using numeric order IDs."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
