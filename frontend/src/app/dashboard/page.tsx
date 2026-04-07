"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/context/AnchorProvider";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import Link from "next/link";

interface LandRecord {
  publicKey: string;
  landId: string;
  ipfsCid: string;
  areaHectares: number;
  isVerified: boolean;
  isDeclined: boolean;        
  rejectionReason: string;
  lastCalculatedYear: number;
}

interface CarbonRecord {
  landId: string;
  year: number;
  agbDensity: number;
  bgbDensity: number;
  socDensity: number;
  totalDensity: number;
  carbonStock: number;
  creditsMinted: number;
  timestamp: number;
}

export default function DashboardPage() {
  const { connected, publicKey } = useWallet();
  const { program } = useAnchor();
  const { connection } = useConnection();

  const [lands, setLands] = useState<LandRecord[]>([]);
  const [carbonRecords, setCarbonRecords] = useState<CarbonRecord[]>([]);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [selectedLand, setSelectedLand] = useState<LandRecord | null>(null);

  const fetchDashboard = async () => {
    if (!program || !publicKey) return;
    setLoading(true);

    try {
      // Fetch all land records owned by this wallet
      // @ts-ignore
      const allLands = await program.account.landRecord.all([
        {
          memcmp: {
            offset: 8,
            bytes: publicKey.toBase58(),
          },
        },
      ]);

      const formatted: LandRecord[] = allLands.map((l: any) => ({
        publicKey: l.publicKey.toBase58(),
        landId: l.account.landId,
        ipfsCid: l.account.ipfsCid,
        areaHectares: l.account.areaHectares,
        isVerified: l.account.isVerified,
        isDeclined: l.account.isDeclined,           // add this
        rejectionReason: l.account.rejectionReason, // add this
        lastCalculatedYear: l.account.lastCalculatedYear,
      }));
      setLands(formatted);

      // Fetch all carbon records
      // @ts-ignore
      const allCarbon = await program.account.carbonRecord.all();
      const formattedCarbon: CarbonRecord[] = allCarbon
        .filter((c: any) =>
          formatted.some((l) => l.landId === c.account.landId)
        )
        .map((c: any) => ({
          landId: c.account.landId,
          year: c.account.year,
          agbDensity: c.account.agbDensity,
          bgbDensity: c.account.bgbDensity,
          socDensity: c.account.socDensity,
          totalDensity: c.account.totalDensity,
          carbonStock: c.account.carbonStock,
          creditsMinted: c.account.creditsMinted.toNumber(),
          timestamp: c.account.timestamp.toNumber(),
        }));
      setCarbonRecords(formattedCarbon);

      // Fetch SPL token balance
      try {
        const [tokenMintPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("mint")],
          program.programId
        );
        const tokenAccounts = await connection.getTokenAccountsByOwner(
          publicKey,
          { mint: tokenMintPda }
        );
        if (tokenAccounts.value.length > 0) {
          const accountInfo = await getAccount(
            connection,
            tokenAccounts.value[0].pubkey
          );
          setTokenBalance(Number(accountInfo.amount));
        }
      } catch {
        setTokenBalance(0);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (program && publicKey) {
      fetchDashboard();
    }
  }, [program, publicKey]);

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-semibold text-gray-700 mb-2">
            Connect your wallet
          </p>
          <p className="text-gray-500">
            Connect your Phantom wallet to view your dashboard
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">My Dashboard</h1>
            <p className="text-gray-600 text-sm mt-2 break-all">
              Wallet: {publicKey?.toBase58().slice(0, 16)}...
            </p>
          </div>
          <button
            onClick={fetchDashboard}
            disabled={loading}
            className="w-full sm:w-auto bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "⏳ Loading..." : "🔄 Refresh"}
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition">
            <div className="text-4xl mb-3">🗺️</div>
            <div className="text-4xl font-bold text-gray-900">{lands.length}</div>
            <div className="text-gray-600 text-sm mt-2">Registered Plots</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-4xl font-bold text-green-600">
              {lands.filter((l) => l.isVerified).length}
            </div>
            <div className="text-gray-600 text-sm mt-2">Verified Plots</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition sm:col-span-2 lg:col-span-1">
            <div className="text-4xl mb-3">🪙</div>
            <div className="text-4xl font-bold text-green-700">{tokenBalance.toLocaleString()}</div>
            <div className="text-gray-600 text-sm mt-2">Carbon Credits Balance</div>
          </div>
        </div>

        {/* Land Plots Section */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Your Land Plots</h2>
            <Link
              href="/register"
              className="text-green-600 hover:text-green-700 font-semibold text-sm"
            >
              + Add New Plot
            </Link>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <p className="text-gray-400">⏳ Loading your land plots...</p>
            </div>
          ) : lands.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 sm:p-12 text-center">
              <div className="text-5xl mb-4">🌍</div>
              <p className="text-gray-600 mb-6 text-lg">No land plots registered yet.</p>
              <Link
                href="/register"
                className="inline-block bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-semibold"
              >
                Register Your First Plot →
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {lands.map((land) => {
                const landCarbon = carbonRecords.filter(
                  (c) => c.landId === land.landId
                );
                const totalCredits = landCarbon.reduce(
                  (sum, c) => sum + c.creditsMinted,
                  0
                );
                const canCalculate =
                  land.isVerified &&
                  (land.lastCalculatedYear === 0 ||
                    new Date().getFullYear() > land.lastCalculatedYear);

                return (
                  <div
                    key={land.landId}
                    className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition overflow-hidden"
                  >
                    {/* Card Header */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-gray-700 bg-gray-100 px-3 py-1 rounded">
                              {land.landId}
                            </span>
                            {land.isVerified ? (
                            <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-semibold">
                              ✅ Verified
                            </span>
                          ) : land.isDeclined ? (
                            <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-semibold">
                              ❌ Declined
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-semibold">
                              ⏳ Pending
                            </span>
                          )}
                          {land.isDeclined && land.rejectionReason && (
                            <p className="text-xs text-red-500 mt-1">Reason: {land.rejectionReason}</p>
                          )}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setSelectedLand(
                              selectedLand?.landId === land.landId ? null : land
                            )
                          }
                          className="text-sm font-medium text-gray-600 hover:text-gray-900 transition"
                        >
                          {selectedLand?.landId === land.landId
                            ? "▼ Hide Details"
                            : "▶ View Details"}
                        </button>
                      </div>
                    </div>

                    {/* Card Stats */}
                    <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-white">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <div>
                          <div className="text-gray-600 text-xs uppercase tracking-wide font-semibold">Area</div>
                          <div className="text-2xl font-bold text-gray-900 mt-1">{land.areaHectares.toFixed(1)}</div>
                          <div className="text-gray-500 text-xs">hectares</div>
                        </div>
                        <div>
                          <div className="text-gray-600 text-xs uppercase tracking-wide font-semibold">Last Calculated</div>
                          <div className="text-2xl font-bold text-gray-900 mt-1">
                            {land.lastCalculatedYear === 0 ? "—" : land.lastCalculatedYear}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-600 text-xs uppercase tracking-wide font-semibold">Credits</div>
                          <div className="text-2xl font-bold text-green-600 mt-1">{totalCredits}</div>
                          <div className="text-gray-500 text-xs">earned</div>
                        </div>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="px-6 py-3 flex flex-col sm:flex-row gap-2 border-t border-gray-100 bg-gray-50">
                      <Link
                        href={`https://ipfs.io/ipfs/${land.ipfsCid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center text-blue-600 hover:text-blue-700 font-medium text-sm py-2 rounded hover:bg-blue-50 transition"
                      >
                        📄 View Document
                      </Link>
                      {canCalculate && (
                        <button className="flex-1 bg-green-600 text-white font-medium text-sm py-2 rounded hover:bg-green-700 transition">
                          📊 Calculate Credits
                        </button>
                      )}
                    </div>

                    {/* Carbon History */}
                    {selectedLand?.landId === land.landId && landCarbon.length > 0 && (
                      <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                        <h4 className="font-semibold text-gray-900 mb-4">Carbon History</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-gray-700">
                            <thead>
                              <tr className="text-gray-500 border-b border-gray-200">
                                <th className="text-left py-2 px-2 font-semibold">Year</th>
                                <th className="text-left py-2 px-2 font-semibold">AGB</th>
                                <th className="text-left py-2 px-2 font-semibold">BGB</th>
                                <th className="text-left py-2 px-2 font-semibold">SOC</th>
                                <th className="text-right py-2 px-2 font-semibold">Credits</th>
                              </tr>
                            </thead>
                            <tbody>
                              {landCarbon.map((c, idx) => (
                                <tr
                                  key={c.year}
                                  className={`border-b border-gray-100 ${
                                    idx % 2 === 0 ? "bg-white" : "bg-gray-100"
                                  }`}
                                >
                                  <td className="py-2 px-2">{c.year}</td>
                                  <td className="py-2 px-2">{c.agbDensity.toFixed(1)}</td>
                                  <td className="py-2 px-2">{c.bgbDensity.toFixed(1)}</td>
                                  <td className="py-2 px-2">{c.socDensity.toFixed(1)}</td>
                                  <td className="py-2 px-2 text-right font-semibold text-green-600">
                                    {c.creditsMinted}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}