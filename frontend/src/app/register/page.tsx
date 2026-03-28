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
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="text-center">
          <p className="text-2xl font-semibold text-gray-600 mb-2">
            Connect your wallet
          </p>
          <p className="text-gray-400">
            You need a Phantom wallet to register land
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-green-800 mb-2">
        Register Your Land
      </h1>
      <p className="text-gray-500 mb-6">
        Draw your land boundary on the map, upload your land document, and
        register it on the blockchain.
      </p>

      {/* Map */}
      <div className="bg-white rounded-xl shadow border border-gray-200 mb-6 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700">
            Step 1 — Draw your land boundary
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Click on the map to draw a polygon around your land. Double-click
            to finish.
          </p>
        </div>
        <LandMap onPolygonChange={handlePolygonChange} />
        {areaHectares > 0 && (
          <div className="p-3 bg-green-50 text-green-700 text-sm font-medium">
            ✅ Polygon drawn — Area: {areaHectares.toFixed(2)} hectares (
            {polygon.length} points)
          </div>
        )}
      </div>

      {/* Upload */}
      <div className="bg-white rounded-xl shadow border border-gray-200 mb-6 p-6">
        <h2 className="font-semibold text-gray-700 mb-3">
          Step 2 — Upload land document
        </h2>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(e) => setLandFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
        />
        {landFile && (
          <p className="text-sm text-green-600 mt-2">
            ✅ {landFile.name} selected
          </p>
        )}
      </div>

      {/* Submit */}
      <div className="bg-white rounded-xl shadow border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-700 mb-4">
          Step 3 — Submit registration
        </h2>

        {status && (
          <div className="mb-4 p-3 rounded-lg bg-gray-50 text-sm text-gray-700 border border-gray-200">
            {status}
          </div>
        )}

        {txSignature && (
          <div className="mb-4">
            <a
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 underline"
            >
              View transaction on Solana Explorer →
            </a>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="bg-green-700 text-white px-8 py-3 rounded-lg hover:bg-green-600 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Processing..." : "Register Land →"}
        </button>
      </div>
    </div>
  );
}