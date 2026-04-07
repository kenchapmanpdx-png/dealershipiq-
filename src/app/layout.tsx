import type { Metadata } from "next";
import localFont from "next/font/local";
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
  title: {
    default: 'DealershipIQ — SMS-Powered Sales Training for Auto Dealers',
    template: '%s | DealershipIQ',
  },
  description:
    'Daily sales training via text message. AI grades responses in real time. Managers track performance on a live dashboard. Built for automotive dealerships.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dealershipiq-wua7.vercel.app'),
  openGraph: {
    title: 'DealershipIQ — SMS-Powered Sales Training',
    description:
      'Daily SMS training questions, AI grading, and a real-time manager dashboard. Built for automotive dealerships.',
    url: process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dealershipiq-wua7.vercel.app',
    siteName: 'DealershipIQ',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DealershipIQ — SMS-Powered Sales Training',
    description:
      'Daily SMS training, AI grading, and real-time performance dashboards for auto dealerships.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
