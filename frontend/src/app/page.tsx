"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

export default function Home() {
  const { connected } = useWallet();

  const features = [
    {
      icon: "🛰️",
      title: "Satellite + Drone",
      description: "Dual-layer carbon stock estimation using ML models"
    },
    {
      icon: "⛓️",
      title: "Blockchain Verified",
      description: "All carbon records stored on Solana, tamper-proof"
    },
    {
      icon: "🪙",
      title: "Carbon Credits",
      description: "1 tonne = 1 coin, minted as SPL token + cNFT certificate"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-6 text-center lg:text-left">
            <div className="inline-block bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm font-semibold lg:inline-block">
              🌱 Sustainable Blockchain Solutions
            </div>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">
              Carbon Credit MRV Platform
            </h1>
            
            <p className="text-lg sm:text-xl text-gray-600 leading-relaxed">
              A decentralized platform for monitoring, reporting, and verifying carbon credits using satellite imagery, drone data, and blockchain technology.
            </p>

            {!connected ? (
              <div className="space-y-4 flex flex-col lg:flex-row lg:items-center lg:gap-4">
                <p className="text-gray-500 text-sm lg:text-base">
                  Connect your Phantom wallet to get started
                </p>
                <WalletMultiButton className="!bg-green-600 hover:!bg-green-700 !rounded-lg !py-2 !px-6 !text-base !w-full lg:!w-auto" />
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <Link
                  href="/register"
                  className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-semibold text-center inline-block"
                >
                  Register Your Land →
                </Link>
                <Link
                  href="/dashboard"
                  className="bg-white text-green-600 border-2 border-green-600 px-6 py-3 rounded-lg hover:bg-green-50 transition font-semibold text-center inline-block"
                >
                  View My Lands
                </Link>
              </div>
            )}
          </div>

          {/* Right Image/Illustration */}
          <div className="hidden lg:flex items-center justify-center">
            <div className="relative w-full h-96 bg-gradient-to-br from-green-100 to-blue-100 rounded-2xl flex items-center justify-center overflow-hidden">
              <Image
                src="/hero.jpg"
                alt="Carbon credit forest and renewable energy"
                width={500}
                height={400}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="bg-white py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Why Choose Our Platform?
            </h2>
            <p className="text-lg text-gray-600">
              Industry-leading carbon credit verification for a sustainable future
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-8 hover:shadow-lg hover:from-green-50 hover:to-blue-50 transition duration-300 border border-gray-200 hover:border-green-300"
              >
                <div className="text-5xl mb-4">{feature.icon}</div>
                <h3 className="font-bold text-xl text-gray-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-green-600 to-green-700 text-white py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-8">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Ready to Join the Green Revolution?
            </h2>
            <p className="text-lg text-green-50">
              Start verifying your carbon credits on the blockchain today
            </p>
          </div>
          
          {!connected && (
            <div className="flex justify-center">
              <WalletMultiButton className="!bg-white hover:!bg-green-50 !text-green-700 !rounded-lg !py-3 !px-8 !text-base !font-semibold" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}