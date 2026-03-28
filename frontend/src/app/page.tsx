"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

export default function Home() {
  const { connected } = useWallet();

  return (
    <div className="flex flex-col items-center justify-center min-h-[90vh] px-4 text-center">
      <div className="max-w-2xl">
        <h1 className="text-5xl font-bold text-green-800 mb-4">
          🌿 Carbon Credit MRV Platform
        </h1>
        <p className="text-gray-600 text-lg mb-8">
          A decentralized platform for monitoring, reporting, and verifying
          carbon credits using satellite imagery, drone data, and blockchain.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-10 text-left">
          <div className="bg-white rounded-xl p-4 shadow border border-green-100">
            <div className="text-2xl mb-2">🛰️</div>
            <h3 className="font-semibold text-green-800">Satellite + Drone</h3>
            <p className="text-sm text-gray-500 mt-1">
              Dual-layer carbon stock estimation using ML models
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow border border-green-100">
            <div className="text-2xl mb-2">⛓️</div>
            <h3 className="font-semibold text-green-800">Blockchain Verified</h3>
            <p className="text-sm text-gray-500 mt-1">
              All carbon records stored on Solana, tamper-proof
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow border border-green-100">
            <div className="text-2xl mb-2">🪙</div>
            <h3 className="font-semibold text-green-800">Carbon Credits</h3>
            <p className="text-sm text-gray-500 mt-1">
              1 tonne = 1 coin, minted as SPL token + cNFT certificate
            </p>
          </div>
        </div>

        {!connected ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-gray-500 text-sm">
              Connect your Phantom wallet to get started
            </p>
            <WalletMultiButton className="!bg-green-700 hover:!bg-green-600 !rounded-lg !py-3 !px-6 !text-base" />
          </div>
        ) : (
          <div className="flex gap-4 justify-center">
            <Link
              href="/register"
              className="bg-green-700 text-white px-6 py-3 rounded-lg hover:bg-green-600 transition font-medium"
            >
              Register Your Land →
            </Link>
            <Link
              href="/dashboard"
              className="bg-white text-green-700 border border-green-700 px-6 py-3 rounded-lg hover:bg-green-50 transition font-medium"
            >
              View My Lands
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}