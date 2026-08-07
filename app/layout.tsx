import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Drill Tracker", description: "Offline-first shooting drill tracker", manifest: "/manifest.webmanifest", icons: { icon: "/icon.svg" }, appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Drills" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
