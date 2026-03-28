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
  lastCalculatedYear: number;
}

interface PlatformStats {
  totalLands: number;
  verifiedLands: number;
  pendingLands: number;
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
    totalCredits: 0,
  });
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"pending" | "verified" | "all">("pending");

  const isAuthority = publicKey?.toBase58() === AUTHORITY_PUBKEY;

  const fetchAllLands = async () => {
    if (!program) return;
    setLoading(true);
    try {
      const allLands = await program.account.landRecord.all();
      const formatted: LandRecord[] = allLands.map((l: any) => ({
        publicKey: l.publicKey.toBase58(),
        owner: l.account.owner.toBase58(),
        landId: l.account.landId,
        ipfsCid: l.account.ipfsCid,
        areaHectares: l.account.areaHectares,
        isVerified: l.account.isVerified,
        lastCalculatedYear: l.account.lastCalculatedYear,
      }));

      setLands(formatted);
      setStats({
        totalLands: formatted.length,
        verifiedLands: formatted.filter((l) => l.isVerified).length,
        pendingLands: formatted.filter((l) => !l.isVerified).length,
        totalCredits: 0, // will add later
      });
    } catch (e: any) {
      console.error(e);
      setStatus("Error fetching lands: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (land: LandRecord) => {
    if (!program || !publicKey) return;
    setVerifying(land.landId);
    setStatus("");

    try {
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

  useEffect(() => {
    if (program && isAuthority) {
      fetchAllLands();
    }
  }, [program, isAuthority]);

  const filteredLands = lands.filter((l) => {
    if (activeTab === "pending") return !l.isVerified;
    if (activeTab === "verified") return l.isVerified;
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
        <button
          onClick={fetchAllLands}
          disabled={loading}
          className="bg-green-700 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition text-sm disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "🔄 Refresh"}
        </button>
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
        {(["pending", "verified", "all"] as const).map((tab) => (
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
                    ) : (
                      <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full text-xs font-medium">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!land.isVerified && (
                      <button
                        onClick={() => handleVerify(land)}
                        disabled={verifying === land.landId}
                        className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-green-500 transition disabled:opacity-50"
                      >
                        {verifying === land.landId ? "Verifying..." : "Verify ✓"}
                      </button>
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