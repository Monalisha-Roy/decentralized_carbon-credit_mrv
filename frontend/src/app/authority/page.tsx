"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/context/AnchorProvider";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const AUTHORITY_PUBKEY = "Bjt92NdnruXKVhT1WwxYuzDC8SUwmMyXShrmAKjcPfDM";

interface LandRecord {
  publicKey: string;
  owner: string;
  landId: string;
  ipfsCid: string;
  areaHectares: number;
  isVerified: boolean;
  isDeclined: boolean;
  rejectionReason: string;
  lastCalculatedYear: number;
}
interface PlatformStats {
  totalLands: number;
  verifiedLands: number;
  pendingLands: number;
  declinedLands: number;
  totalCredits: number;
}

export default function AuthorityPage() {
  const { connected, publicKey } = useWallet();
  const { program } = useAnchor();

  const [lands, setLands] = useState<LandRecord[]>([]);
  const [stats, setStats] = useState<PlatformStats>({
    totalLands: 0,
    verifiedLands: 0,
    pendingLands: 0,
    declinedLands: 0,
    totalCredits: 0,
  });
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"pending" | "verified" | "declined" | "all">("pending");

  const isAuthority = publicKey?.toBase58() === AUTHORITY_PUBKEY;

  const initializePlatform = async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    setStatus("");

    try {
      const [platformStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("platform")],
        program.programId
      );

      const [tokenMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint")],
        program.programId
      );

      const tx = await program.methods
        .initializePlatform()
        // @ts-ignore
        .accounts({
          platformState: platformStatePda,
          tokenMint: tokenMintPda,
          authority: publicKey,
        })
        .rpc();

      setStatus(`✅ Platform initialized! Tx: ${tx}`);
      await fetchAllLands();
    } catch (e: any) {
      console.error(e);
      setStatus(`❌ Error initializing platform: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllLands = async () => {
    if (!program) return;
    setLoading(true);
    try {
      // @ts-ignore
      const allLands = await program.account.landRecord.all();
      const formatted: LandRecord[] = allLands.map((l: any) => ({
        publicKey: l.publicKey.toBase58(),
        owner: l.account.owner.toBase58(),
        landId: l.account.landId,
        ipfsCid: l.account.ipfsCid,
        areaHectares: l.account.areaHectares,
        isVerified: l.account.isVerified,
        isDeclined: l.account.isDeclined,
        rejectionReason: l.account.rejectionReason,
        lastCalculatedYear: l.account.lastCalculatedYear,
      }));

      setLands(formatted);
      setStats({
        totalLands: formatted.length,
        verifiedLands: formatted.filter((l) => l.isVerified).length,
        pendingLands: formatted.filter((l) => !l.isVerified && !l.isDeclined).length,
        declinedLands: formatted.filter((l) => l.isDeclined).length,
        totalCredits: 0,
      });
    } catch (e: any) {
      console.error(e);
      setStatus("Error fetching lands: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const checkAndInitializePlatform = async (): Promise<boolean> => {
    if (!program) return false;
    
    try {
      const [platformStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("platform")],
        program.programId
      );

      // Try to fetch the platform state account
      try {
        // @ts-ignore
        await program.account.platformState.fetch(platformStatePda);
        return true; // Platform is already initialized
      } catch {
        // Platform not initialized, initialize it
        setStatus("⏳ Initializing platform... Please wait");
        await initializePlatform();
        return true;
      }
    } catch (e: any) {
      console.error("Error checking platform:", e);
      return false;
    }
  };

  const handleVerify = async (land: LandRecord) => {
    if (!program || !publicKey) return;
    setVerifying(land.landId);
    setStatus("");

    try {
      // Check if platform is initialized, initialize if needed
      const platformReady = await checkAndInitializePlatform();
      if (!platformReady) {
        setStatus("❌ Failed to initialize platform");
        setVerifying(null);
        return;
      }

      const [platformStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("platform")],
        program.programId
      );

      const [landRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("land"), Buffer.from(land.landId)],
        program.programId
      );

      const tx = await program.methods
        .verifyLand()
        .accounts({
          platformState: platformStatePda,
          landRecord: landRecordPda,
          authority: publicKey,
        })
        .rpc();

      setStatus(`✅ Land ${land.landId} verified! Tx: ${tx}`);
      await fetchAllLands();
    } catch (e: any) {
      console.error(e);
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setVerifying(null);
    }
  };

  const handleDecline = async (land: LandRecord) => {
    if (!program || !publicKey) return;
    const reason = prompt("Enter reason for declining this land registration:");
    if (!reason || reason.trim() === "") {
      setStatus("❌ Please provide a reason for declining.");
      return;
    }

    setVerifying(land.landId);
    setStatus("");

    try {
      // Check if platform is initialized, initialize if needed
      const platformReady = await checkAndInitializePlatform();
      if (!platformReady) {
        setStatus("❌ Failed to initialize platform");
        setVerifying(null);
        return;
      }

      const [platformStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("platform")],
        program.programId
      );

      const [landRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("land"), Buffer.from(land.landId)],
        program.programId
      );

      const tx = await program.methods
        .declineLand(reason)
        .accounts({
          platformState: platformStatePda,
          landRecord: landRecordPda,
          authority: publicKey,
        })
        .rpc();

      setStatus(`❌ Land ${land.landId} declined. Tx: ${tx}`);
      await fetchAllLands();
    } catch (e: any) {
      console.error(e);
      setStatus(`❌ Error: ${e.message}`);
    } finally {
      setVerifying(null);
    }
  };

  useEffect(() => {
    if (program && isAuthority) {
      fetchAllLands();
    }
  }, [program, isAuthority]);

  const filteredLands = lands.filter((l) => {
    if (activeTab === "pending") return !l.isVerified && !l.isDeclined;
    if (activeTab === "verified") return l.isVerified;
    if (activeTab === "declined") return l.isDeclined;
    return true;
  });

  // Not connected
  if (!connected) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="text-center">
          <p className="text-2xl font-semibold text-gray-600 mb-2">
            Connect your wallet
          </p>
          <p className="text-gray-400">Authority access requires wallet connection</p>
        </div>
      </div>
    );
  }

  // Not authority
  if (!isAuthority) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="text-center">
          <div className="text-5xl mb-4">🚫</div>
          <p className="text-2xl font-semibold text-red-600 mb-2">
            Access Denied
          </p>
          <p className="text-gray-400">
            This page is only accessible to the platform authority.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-green-800">
            Authority Dashboard
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Platform admin — {publicKey?.toBase58().slice(0, 16)}...
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={initializePlatform}
            disabled={loading}
            className="bg-purple-700 text-white px-4 py-2 rounded-lg hover:bg-purple-600 transition text-sm disabled:opacity-50"
          >
            {loading ? "Initializing..." : "⚙️ Initialize Platform"}
          </button>
          <button
            onClick={fetchAllLands}
            disabled={loading}
            className="bg-green-700 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition text-sm disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "🔄 Refresh"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Lands", value: stats.totalLands, icon: "🗺️", color: "blue" },
          { label: "Pending Verification", value: stats.pendingLands, icon: "⏳", color: "yellow" },
          { label: "Verified Lands", value: stats.verifiedLands, icon: "✅", color: "green" },
          { label: "Total Credits Minted", value: stats.totalCredits, icon: "🪙", color: "purple" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl shadow border border-gray-100 p-5"
          >
            <div className="text-2xl mb-1">{stat.icon}</div>
            <div className="text-3xl font-bold text-gray-800">{stat.value}</div>
            <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Status message */}
      {status && (
        <div className="mb-4 p-3 rounded-lg bg-gray-50 text-sm text-gray-700 border border-gray-200">
          {status}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(["pending", "verified", "declined", "all"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition ${
              activeTab === tab
                ? "bg-green-700 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab === "pending"
              ? `⏳ Pending (${stats.pendingLands})`
              : tab === "verified"
              ? `✅ Verified (${stats.verifiedLands})`
              : tab === "declined"
              ? `❌ Declined (${stats.declinedLands})`
              : `🗺️ All (${stats.totalLands})`}
          </button>
        ))}
      </div>

      {/* Land Records Table */}
      <div className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading lands...</div>
        ) : filteredLands.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No {activeTab === "all" ? "" : activeTab} land records found.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Land ID</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Owner</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Area (ha)</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Last Calc. Year</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Document</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredLands.map((land, i) => (
                <tr
                  key={land.landId}
                  className={`border-b border-gray-50 hover:bg-gray-50 transition ${
                    i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {land.landId}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {land.owner.slice(0, 8)}...{land.owner.slice(-6)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {land.areaHectares.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {land.lastCalculatedYear === 0
                      ? "Never"
                      : land.lastCalculatedYear}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`https://ipfs.io/ipfs/${land.ipfsCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline text-xs"
                    >
                      View Doc →
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    {land.isVerified ? (
                      <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-medium">
                        Verified
                      </span>
                    ) : land.isDeclined ? (
                      <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-medium">
                        Declined
                      </span>
                    ) : (
                      <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full text-xs font-medium">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!land.isVerified && !land.isDeclined && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleVerify(land)}
                          disabled={verifying === land.landId}
                          className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-green-500 transition disabled:opacity-50"
                        >
                          {verifying === land.landId ? "..." : "Verify ✓"}
                        </button>
                        <button
                          onClick={() => handleDecline(land)}
                          disabled={verifying === land.landId}
                          className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs hover:bg-red-400 transition disabled:opacity-50"
                        >
                          Decline ✗
                        </button>
                      </div>
                    )}
                    {land.isDeclined && (
                      <span className="text-red-500 text-xs font-medium">
                        Declined
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}