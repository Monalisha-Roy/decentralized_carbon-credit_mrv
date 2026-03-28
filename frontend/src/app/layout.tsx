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

export const metadata: Metadata = {
  title: "Carbon Credit MRV Platform",
  description: "Decentralized carbon credit monitoring and verification",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={geistSans.className}>
        <SolanaWalletProvider>
          <AnchorContextProvider>
            <Navbar />
            <main className="min-h-screen bg-gray-50">
              {children}
            </main>
          </AnchorContextProvider>
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
