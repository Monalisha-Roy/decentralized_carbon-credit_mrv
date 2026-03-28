"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

export default function Navbar() {
  return (
    <nav className="bg-green-800 text-white px-6 py-4 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-8">
        <span className="text-xl font-bold tracking-tight">
          🌿 Carbon MRV
        </span>
        <div className="flex gap-6 text-sm font-medium">
          <Link href="/" className="hover:text-green-300 transition">
            Home
          </Link>
          <Link href="/register" className="hover:text-green-300 transition">
            Register Land
          </Link>
          <Link href="/dashboard" className="hover:text-green-300 transition">
            My Lands
          </Link>
          <Link href="/authority" className="hover:text-green-300 transition">
            Authority
          </Link>
        </div>
      </div>
      <WalletMultiButton className="!bg-green-600 hover:!bg-green-500" />
    </nav>
  );
}