import "@solana/wallet-adapter-react-ui/styles.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SolanaWalletProvider } from "@/context/WalletProvider";
import { AnchorContextProvider } from "@/context/AnchorProvider";
import Navbar from "@/components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Carbon Credit MRV Platform",
  description: "Decentralized carbon credit monitoring, reporting, and verification using blockchain",
  viewport: "width=device-width, initial-scale=1",
  icons: {
    icon: "🌿",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="theme-color" content="#059669" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-white text-gray-900`}>
        <SolanaWalletProvider>
          <AnchorContextProvider>
            <Navbar />
            <main className="min-h-screen">
              {children}
            </main>
            <footer className="bg-gray-900 text-gray-300 py-8 border-t border-gray-800 mt-24">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
                  <div>
                    <h3 className="font-bold text-white mb-4">🌿 Carbon MRV</h3>
                    <p className="text-sm text-gray-400">
                      Decentralized carbon credit verification for a sustainable future
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-white mb-4">Product</h4>
                    <ul className="space-y-2 text-sm">
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">Dashboard</a></li>
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">Register Land</a></li>
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">Verification</a></li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold text-white mb-4">Company</h4>
                    <ul className="space-y-2 text-sm">
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">About</a></li>
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">Blog</a></li>
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">Contact</a></li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold text-white mb-4">Legal</h4>
                    <ul className="space-y-2 text-sm">
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">Privacy</a></li>
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">Terms</a></li>
                      <li><a href="#" className="text-gray-400 hover:text-green-400 transition">Cookies</a></li>
                    </ul>
                  </div>
                </div>
                <div className="border-t border-gray-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <p className="text-sm text-gray-400">
                    © 2026 Carbon Credit MRV Platform. All rights reserved.
                  </p>
                  <div className="flex gap-4">
                    <a href="#" className="text-gray-400 hover:text-green-400 transition">Twitter</a>
                    <a href="#" className="text-gray-400 hover:text-green-400 transition">Discord</a>
                    <a href="#" className="text-gray-400 hover:text-green-400 transition">GitHub</a>
                  </div>
                </div>
              </div>
            </footer>
          </AnchorContextProvider>
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
