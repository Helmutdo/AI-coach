import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppStatusBootstrap } from "@/components/AppStatusBootstrap";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { UserSync } from "@/components/UserSync";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "AI Coach",
  description: "AI-powered endurance coach — Strava & Garmin CSV sync",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-zinc-950 font-sans antialiased`}
      >
        <AuthSessionProvider>
          <UserSync />
          <AppStatusBootstrap />
          {children}
        </AuthSessionProvider>
      </body>
    </html>
  );
}
