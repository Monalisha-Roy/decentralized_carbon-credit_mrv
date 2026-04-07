"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/context/AnchorProvider";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { uploadToPinata } from "@/lib/pinata";
import dynamic from "next/dynamic";

// Dynamic import for map (no SSR)
const LandMap = dynamic(() => import("@/components/LandMap"), { ssr: false });

export default function RegisterPage() {
  const { connected, publicKey } = useWallet();
  const { program } = useAnchor();

  const [polygon, setPolygon] = useState<[number, number][]>([]);
  const [areaHectares, setAreaHectares] = useState<number>(0);
  const [landFile, setLandFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [txSignature, setTxSignature] = useState<string>("");

  const handlePolygonChange = useCallback(
    (coords: [number, number][], area: number) => {
      setPolygon(coords);
      setAreaHectares(area);
    },
    []
  );

  const handleSubmit = async () => {
    if (!connected || !publicKey) {
      setStatus("Please connect your wallet first.");
      return;
    }
    if (polygon.length < 3) {
      setStatus("Please draw a polygon around your land on the map.");
      return;
    }
    if (!landFile) {
      setStatus("Please upload your land document.");
      return;
    }
    if (!program) {
      setStatus("Program not loaded. Please reconnect wallet.");
      return;
    }

    try {
      setLoading(true);

      // Step 1: Upload land document to IPFS
      setStatus("📤 Uploading land document to IPFS...");
      const ipfsCid = await uploadToPinata(landFile);
      setStatus(`✅ Uploaded to IPFS. CID: ${ipfsCid}`);

      // Step 2: Generate land ID from CID (first 16 chars)
      const landId = ipfsCid.slice(0, 16);

      // Step 3: Derive land record PDA
      const [landRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("land"), Buffer.from(landId)],
        program.programId
      );

      // Step 4: Call register_land on the contract
      setStatus("⛓️ Registering land on Solana...");
      const tx = await program.methods
        .registerLand(landId, ipfsCid, areaHectares)
        .accounts({
          landRecord: landRecordPda,
          owner: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setTxSignature(tx);
      setStatus(`🎉 Land registered successfully!`);
    } catch (e: any) {
      console.error(e);
      
      // Handle wallet rejection
      if (e.code === 4001 || e.message?.includes("User rejected") || e.message?.includes("rejected")) {
        setStatus("⚠️ Transaction cancelled. You rejected the wallet signature. Please try again to register your land.");
        return;
      }
      
      // Handle insufficient balance
      if (e.message?.includes("insufficient") || e.message?.includes("balance")) {
        setStatus("⚠️ Insufficient balance. Please ensure your wallet has enough SOL to cover transaction fees.");
        return;
      }
      
      // Handle network errors
      if (e.message?.includes("network") || e.message?.includes("Network") || e.message?.includes("timeout")) {
        setStatus("⚠️ Network error. Please check your connection and try again.");
        return;
      }
      
      // Handle IPFS upload errors
      if (e.message?.includes("IPFS") || e.message?.includes("pinata") || e.message?.includes("upload")) {
        setStatus("⚠️ Failed to upload document. Please check your file and try again.");
        return;
      }
      
      // Generic error handler
      const errorMessage = e.message || "Unknown error occurred";
      setStatus(`⚠️ Registration failed: ${errorMessage}. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">🌍</div>
          <p className="text-2xl font-bold text-gray-900 mb-2">
            Connect Your Wallet
          </p>
          <p className="text-gray-600">
            You need a Phantom wallet to register land on our platform
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="inline-block bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm font-semibold mb-4">
            🌱 Register New Land
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
            Register Your Land
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Draw your land boundary on the interactive map, upload your land document, and register it on the Solana blockchain in three simple steps.
          </p>
        </div>

        {/* Progress Steps */}
        <div className="grid grid-cols-3 gap-4 mb-12">
          <div className="relative">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-600 text-white font-bold mx-auto">1</div>
            <p className="text-center text-sm font-semibold text-gray-900 mt-2">Draw Boundary</p>
          </div>
          <div className="relative">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-200 text-gray-700 font-bold mx-auto">2</div>
            <p className="text-center text-sm font-semibold text-gray-900 mt-2">Upload Document</p>
          </div>
          <div className="relative">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-200 text-gray-700 font-bold mx-auto">3</div>
            <p className="text-center text-sm font-semibold text-gray-900 mt-2">Submit</p>
          </div>
        </div>

        {/* Step 1: Map */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-8 overflow-hidden">
          <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-green-50 to-white">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-600 text-white font-bold">
                  1
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Draw Your Land Boundary
                </h2>
                <p className="text-gray-600 text-sm mt-1">
                  Click on the map to place points, forming a polygon around your land. Double-click when finished.
                </p>
              </div>
            </div>
          </div>
          <div className="relative bg-gray-100">
            <LandMap onPolygonChange={handlePolygonChange} />
          </div>
          {areaHectares > 0 && (
            <div className="p-4 bg-green-50 border-t border-green-200 flex items-center gap-3">
              <div className="text-2xl">✅</div>
              <div>
                <p className="font-semibold text-green-900">Polygon Complete</p>
                <p className="text-green-700 text-sm">
                  Area: <span className="font-bold">{areaHectares.toFixed(2)} hectares</span> ({polygon.length} points)
                </p>
              </div>
            </div>
          )}
          {areaHectares === 0 && (
            <div className="p-4 bg-amber-50 border-t border-amber-200 flex items-center gap-3">
              <div className="text-2xl">⏳</div>
              <p className="text-amber-700">Draw a polygon with at least 3 points</p>
            </div>
          )}
        </div>

        {/* Step 2: Upload Document */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-8 p-6">
          <div className="flex items-start gap-3 mb-6">
            <div className="flex-shrink-0">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-600 text-white font-bold">
                2
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                Upload Land Document
              </h2>
              <p className="text-gray-600 text-sm mt-1">
                Upload a scanned copy of your land ownership document or deed
              </p>
            </div>
          </div>

          <div className="relative">
            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-green-400 hover:bg-green-50 transition">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <div className="text-4xl mb-2">📄</div>
                <p className="text-sm text-gray-600 font-medium">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-gray-500">
                  PDF, JPG, PNG up to 10MB
                </p>
              </div>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setLandFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          {landFile && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
              <div className="text-2xl">✅</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-green-900">{landFile.name}</p>
                <p className="text-green-700 text-xs">
                  {(landFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Step 3: Submit */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-start gap-3 mb-6">
            <div className="flex-shrink-0">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-600 text-white font-bold">
                3
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                Submit Registration
              </h2>
              <p className="text-gray-600 text-sm mt-1">
                Review and submit your land registration to the blockchain
              </p>
            </div>
          </div>

          {/* Status Messages */}
          {status && (
            <div className={`mb-6 p-4 rounded-lg border ${
              status.includes('✅') || status.includes('🎉')
                ? 'bg-green-50 border-green-200 text-green-800'
                : status.includes('⚠️')
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : status.includes('❌')
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}>
              <p className="text-sm font-medium">{status}</p>
            </div>
          )}

          {txSignature && (
            <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border border-blue-200">
              <p className="text-sm text-gray-700 mb-2">✨ Transaction successfully submitted!</p>
              <a
                href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-sm"
              >
                View on Solana Explorer →
              </a>
            </div>
          )}

          {/* Validation Checklist */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">Before you submit:</h3>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm text-gray-700">
                <span className={areaHectares > 0 ? "text-green-600" : "text-gray-400"}>
                  {areaHectares > 0 ? "✓" : "○"}
                </span>
                Land boundary is drawn
              </li>
              <li className="flex items-center gap-2 text-sm text-gray-700">
                <span className={landFile ? "text-green-600" : "text-gray-400"}>
                  {landFile ? "✓" : "○"}
                </span>
                Document is uploaded
              </li>
              <li className="flex items-center gap-2 text-sm text-gray-700">
                <span className={connected ? "text-green-600" : "text-gray-400"}>
                  {connected ? "✓" : "○"}
                </span>
                Wallet is connected
              </li>
            </ul>
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={loading || areaHectares === 0 || !landFile}
            className="w-full bg-gradient-to-r from-green-600 to-green-700 text-white py-3 px-6 rounded-lg hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold text-lg"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⏳</span>
                Processing Registration...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                🔗 Register Land on Blockchain
              </span>
            )}
          </button>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
          <p className="text-sm text-blue-900">
            <span className="font-semibold">ℹ️ Note:</span> Your land registration will be stored on the Solana blockchain and IPFS. This process typically takes a few minutes.
          </p>
        </div>
      </div>
    </div>
  );
}