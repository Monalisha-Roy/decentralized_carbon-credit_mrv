"use client";

import { useState, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/context/AnchorProvider";
import { PublicKey, SystemProgram, Connection } from "@solana/web3.js";
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

  // Global handler to suppress wallet rejection errors from console
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      if (!error) return;
      
      const errorStr = `${error?.code || ''} ${error?.name || ''} ${error?.message || ''} ${error?.toString() || ''}`.toLowerCase();
      const isWalletRejection = 
        error.code === 4001 ||
        errorStr.includes('user reject') ||
        errorStr.includes('rejected') ||
        errorStr.includes('decline') ||
        errorStr.includes('cancelled') ||
        errorStr.includes('user denied') ||
        error.name === 'WalletSignTransactionError';
      
      // Prevent wallet rejection errors from showing in console
      if (isWalletRejection) {
        event.preventDefault();
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);

  const handlePolygonChange = useCallback(
    (coords: [number, number][], area: number) => {
      setPolygon(coords);
      setAreaHectares(area);
    },
    []
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setLandFile(null);
      return;
    }

    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      setStatus(`❌ Invalid file type: ${file.type}. Please upload a PDF or image (JPG/PNG).`);
      setLandFile(null);
      return;
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setStatus(`❌ File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum is 10MB.`);
      setLandFile(null);
      return;
    }

    setLandFile(file);
    setStatus(''); // Clear any previous error
  };

  const handleSubmit = async () => {
    if (!connected || !publicKey) {
      setStatus("Please connect your wallet first.");
      return;
    }
    
    // Prevent duplicate submissions
    if (loading) {
      setStatus("Transaction already in progress. Please wait...");
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
      setStatus(""); // Clear previous status

      // Step 1: Convert polygon coordinates to [lon, lat] format (GeoJSON standard)
      setStatus("📋 Processing polygon coordinates...");
      const polygonCoordinates = polygon.map(([lat, lng]) => [lng, lat]); // [lon, lat] pairs
      
      // Generate deterministic land ID from coordinates hash
      const coordsString = JSON.stringify(polygonCoordinates);
      const encoder = new TextEncoder();
      const data = encoder.encode(coordsString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      const landId = hashHex.slice(0, 16); // First 16 chars for deterministic ID

      // Step 2: Upload land document to IPFS
      setStatus("📤 Uploading land document to IPFS...");
      let documentCid: string;
      try {
        documentCid = await uploadToPinata(landFile);
      } catch (uploadError: any) {
        setStatus("⚠️ Failed to upload document to IPFS. Please check that your file is valid (max 10MB) and try again.");
        setLoading(false);
        return;
      }
      
      setStatus(`✅ Document uploaded to IPFS. CID: ${documentCid}`);

      // Step 3: Derive land record PDA
      let landRecordPda: PublicKey;
      try {
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from("land"), Buffer.from(landId)],
          program.programId
        );
        landRecordPda = pda;
      } catch (pdaError: any) {
        setStatus("⚠️ Failed to derive account address. Please try again or contact support.");
        setLoading(false);
        return;
      }

      // Step 4: Check if the land account already exists (to prevent "already in use" errors)
      setStatus("🔍 Checking if land already registered...");
      try {
        // @ts-ignore
        const existingLand = await program.account.landRecord.fetch(landRecordPda);
        // If we reach here, the account exists
        if (existingLand.owner.equals(publicKey)) {
          setStatus("⚠️ This land was already registered with this wallet. This usually happens when a previous registration partially succeeded. You may need to contact support or try with a different land area.");
        } else {
          setStatus("⚠️ This land has already been registered by another wallet. Please try registering a different area.");
        }
        setLoading(false);
        return;
      } catch (fetchError: any) {
        // Account doesn't exist, which is what we expect for new registrations
        if (!fetchError.message?.includes("Account does not exist")) {
          // Some other error occurred during fetch
          console.error("Unexpected error checking land account:", fetchError);
          // Continue - this is not necessarily a fatal error
        }
        // Continue with registration
      }

      // Step 5: Call register_land on the contract with coordinates and document CID
      setStatus("⛓️ Registering land on Solana...");
      let tx: string;
      
      // Helper function to detect wallet rejection
      const isWalletRejectionError = (error: any): boolean => {
        if (!error) return false;
        const fullErrorStr = `${error?.code || ''} ${error?.name || ''} ${error?.message || ''} ${error?.toString() || ''}`.toLowerCase();
        return (
          error.code === 4001 ||
          fullErrorStr.includes('user reject') || 
          fullErrorStr.includes('rejected') ||
          fullErrorStr.includes('decline') ||
          fullErrorStr.includes('cancelled') ||
          fullErrorStr.includes('user denied') ||
          error.name === 'WalletSignTransactionError'
        );
      };
      
      try {
        tx = await Promise.resolve().then(async () => {
          try {
            return await program.methods
              .registerLand(landId, polygonCoordinates, documentCid, areaHectares)
              .accounts({
                landRecord: landRecordPda,
                owner: publicKey,
                systemProgram: SystemProgram.programId,
              })
              .rpc();
          } catch (innerError: any) {
            if (isWalletRejectionError(innerError)) {
              setStatus("⚠️ Transaction cancelled. You rejected the wallet signature. Your land and document have not been registered. Please try again when ready.");
              setLoading(false);
              throw new Error('WALLET_REJECTED');
            }
            throw innerError;
          }
        });
      } catch (txError: any) {
        // Catch wallet rejection that was already handled
        if (txError?.message === 'WALLET_REJECTED') {
          return;
        }
        
        // Catch any other wallet rejection errors that might have slipped through
        if (isWalletRejectionError(txError)) {
          setStatus("⚠️ Transaction cancelled. You rejected the wallet signature. Your land and document have not been registered. Please try again when ready.");
          setLoading(false);
          return;
        }
        
        // Re-throw to catch in main error handler
        throw txError;
      }

      setTxSignature(tx);
      
      // Log the successful registration details including coordinates
      console.log('✅ LAND REGISTRATION SUCCESSFUL');
      console.log('═══════════════════════════════════════');
      console.log(`📍 Land ID: ${landId}`);
      console.log(`📏 Area: ${areaHectares} hectares`);
      console.log(`📄 Document CID: ${documentCid}`);
      console.log(`🔗 Transaction: ${tx}`);
      console.log('');
      console.log('🗺️  Polygon Coordinates [longitude, latitude]:');
      polygonCoordinates.forEach((coord, index) => {
        console.log(`   [${index}] ${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}`);
      });
      console.log(`Total vertices: ${polygonCoordinates.length}`);
      console.log('═══════════════════════════════════════');
      console.log('');
      
      setStatus(`🎉 Land registered successfully!\n✅ Polygon coordinates stored on-chain\n✅ Document CID: ${documentCid}\n✅ Transaction: ${tx}`);
      setPolygon([]);
      setLandFile(null);
    } catch (e: any) {
      // Check if it's a wallet rejection error
      const fullErrorStr = `${e?.code || ''} ${e?.name || ''} ${e?.message || ''} ${e?.toString() || ''}`.toLowerCase();
      const isWalletRejection = 
        e.code === 4001 ||
        fullErrorStr.includes('user reject') || 
        fullErrorStr.includes('rejected') ||
        fullErrorStr.includes('decline') ||
        fullErrorStr.includes('cancelled') ||
        fullErrorStr.includes('user denied') ||
        e.name === 'WalletSignTransactionError';
      
      // Only log non-wallet errors to avoid console spam
      if (!isWalletRejection && e?.message !== 'WALLET_REJECTED') {
        console.error("Registration error:", e);
      }
      
      // Handle wallet rejection (user clicked "Cancel" in wallet popup)
      if (isWalletRejection) {
        setStatus("⚠️ Transaction cancelled. You rejected the wallet signature. Your land and document have not been registered. Please try again when ready.");
        setLoading(false);
        return;
      }
      
      // Skip further handling if already handled
      if (e?.message === 'WALLET_REJECTED') {
        return;
      }
      
      // Handle SendTransactionError with detailed log extraction
      if (e.name === 'SendTransactionError' || e.constructor?.name === 'SendTransactionError') {
        try {
          const logs = e.getLogs?.() || e.logs || [];
          const logsString = Array.isArray(logs) ? logs.join(' ') : logs?.toString() || '';
          
          if (logsString.includes('already been processed')) {
            setStatus(
              "✅ Your land has been registered successfully! The transaction was already processed. " +
              "Please refresh the page to view the confirmation."
            );
            setLoading(false);
            return;
          }
        } catch (logError) {
          // Continue to next error handler
        }
      }
      
      // Handle "account already in use" error - this is the key fix for the reported issue
      if (
        e.message?.includes("already in use") ||
        e.logs?.some((log: string) => log.includes("already in use")) ||
        e.message?.includes("Allocate") ||
        e.message?.includes("0x0") ||
        (e.simulationResponse?.logs && e.simulationResponse.logs.some((log: string) => log.includes("already in use")))
      ) {
        setStatus(
          "⚠️ Account already exists from a previous registration attempt. Please:\n" +
          "1. Try registering a different land area (draw a slightly different polygon)\n" +
          "2. Or wait a moment and refresh the page\n" +
          "3. Contact support if the issue persists"
        );
        setLoading(false);
        return;
      }
      
      // Handle insufficient balance
      if (e.message?.includes("insufficient") || e.message?.includes("balance")) {
        setStatus("⚠️ Insufficient SOL balance. Please ensure your wallet has enough SOL to cover transaction fees (minimum ~0.05 SOL).");
        setLoading(false);
        return;
      }
      
      // Handle network errors
      if (e.message?.includes("network") || e.message?.includes("Network") || e.message?.includes("timeout") || e.message?.includes("TIMEOUT")) {
        setStatus("⚠️ Network error detected. Please check your internet connection and try again.");
        setLoading(false);
        return;
      }
      
      // Handle IPFS upload errors
      if (e.message?.includes("IPFS") || e.message?.includes("pinata") || e.message?.includes("upload")) {
        setStatus("⚠️ Failed to upload document to IPFS. Please check that your file is valid and try again.");
        setLoading(false);
        return;
      }

      // Handle transaction simulation failures
      if (e.message?.includes("Simulation failed") || e.simulationResponse) {
        const logs = e.simulationResponse?.logs || e.logs || [];
        const logString = Array.isArray(logs) ? logs.join(" ") : logs.toString();
        const fullMessage = `${e.message || ''} ${logString}`.toLowerCase();
        
        // Check for "already been processed" in simulation failure
        if (fullMessage.includes("already been processed") || fullMessage.includes("already processed")) {
          setStatus(
            "✅ Your land has been registered successfully! The transaction was already processed on the blockchain. " +
            "Please refresh the page to view your new land in the dashboard."
          );
          setLoading(false);
          return;
        }
        
        if (logString.includes("already in use")) {
          setStatus(
            "⚠️ This land area has already been registered with this wallet. Please:\n" +
            "1. Draw a slightly different polygon (adjust the boundaries)\n" +
            "2. Or register a completely different area\n" +
            "3. Check your dashboard to see your registered lands"
          );
          setLoading(false);
          return;
        }
        
        setStatus(`⚠️ Transaction simulation failed: ${e.message || 'Unknown error'}. Please try again or contact support.`);
        setLoading(false);
        return;
      }
      
      // Handle "already been processed" errors (SendTransactionError)
      if (e.message?.includes("already been processed") || e.message?.includes("already processed")) {
        setStatus(
          "✅ Your land has been registered successfully! The transaction was already processed on the blockchain. " +
          "Please refresh the page or check your account to view the confirmation."
        );
        setLoading(false);
        return;
      }
      
      // Handle wallet not connected
      if (e.message?.includes("Wallet is not connected") || !publicKey) {
        setStatus("⚠️ Wallet disconnected. Please reconnect your wallet and try again.");
        setLoading(false);
        return;
      }

      // Handle program not loaded
      if (e.message?.includes("program") && !program) {
        setStatus("⚠️ Program failed to load. Please reconnect your wallet and try again.");
        setLoading(false);
        return;
      }
      
      // Generic error handler with full error message for debugging
      const errorMessage = e.message || e.toString() || "Unknown error occurred";
      setStatus(`⚠️ Registration failed: ${errorMessage}. Please try again or contact support if this persists.`);
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
                onChange={handleFileChange}
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