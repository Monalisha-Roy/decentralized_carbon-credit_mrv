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
        lastCalculatedYear: l.account.lastCalculatedYear,
      }));
      setLands(formatted);

      // Fetch all carbon records
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
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="text-center">
          <p className="text-2xl font-semibold text-gray-600 mb-2">
            Connect your wallet
          </p>
          <p className="text-gray-400">
            Connect your Phantom wallet to view your dashboard
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-green-800">My Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            {publicKey?.toBase58().slice(0, 16)}...
          </p>
        </div>
        <button
          onClick={fetchDashboard}
          disabled={loading}
          className="bg-green-700 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition text-sm disabled:opacity-50"
        >
          {loading ? "Loading..." : "🔄 Refresh"}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow border border-gray-100 p-5">
          <div className="text-2xl mb-1">🗺️</div>
          <div className="text-3xl font-bold text-gray-800">{lands.length}</div>
          <div className="text-sm text-gray-500 mt-1">Registered Plots</div>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-100 p-5">
          <div className="text-2xl mb-1">✅</div>
          <div className="text-3xl font-bold text-gray-800">
            {lands.filter((l) => l.isVerified).length}
          </div>
          <div className="text-sm text-gray-500 mt-1">Verified Plots</div>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-100 p-5">
          <div className="text-2xl mb-1">🪙</div>
          <div className="text-3xl font-bold text-green-700">{tokenBalance}</div>
          <div className="text-sm text-gray-500 mt-1">Carbon Credits Balance</div>
        </div>
      </div>

      {/* Land Plots */}
      <h2 className="text-xl font-semibold text-gray-700 mb-3">
        Your Land Plots
      </h2>
      {loading ? (
        <div className="p-8 text-center text-gray-400">Loading...</div>
      ) : lands.length === 0 ? (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-8 text-center">
          <p className="text-gray-400 mb-3">No land plots registered yet.</p>
          <a
            href="/register"
            className="bg-green-700 text-white px-6 py-2 rounded-lg hover:bg-green-600 transition text-sm font-medium"
          >
            Register Your First Plot →
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 mb-8">
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
                className="bg-white rounded-xl shadow border border-gray-100 p-5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-gray-700 font-semibold">
                        {land.landId}
                      </span>
                      {land.isVerified ? (
                        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-medium">
                          ✅ Verified
                        </span>
                      ) : (
                        <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-medium">
                          ⏳ Pending Verification
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 grid grid-cols-3 gap-4 mt-2">
                      <span>📐 {land.areaHectares.toFixed(2)} ha</span>
                      <span>
                        📅 Last calc:{" "}
                        {land.lastCalculatedYear === 0
                          ? "Never"
                          : land.lastCalculatedYear}
                      </span>
                      <span>🪙 {totalCredits} credits earned</span>
                    </div>
                    <Link
                      href={`https://ipfs.io/ipfs/${land.ipfsCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 underline mt-2 inline-block"
                    >
                      View Land Document →
                    </Link>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setSelectedLand(
                          selectedLand?.landId === land.landId ? null : land
                        )
                      }
                      className="text-sm text-gray-500 border border-gray-200 px-3 py-1 rounded-lg hover:bg-gray-50"
                    >
                      {selectedLand?.landId === land.landId
                        ? "Hide History"
                        : "View History"}
                    </button>
                    {canCalculate && (
                      <button className="bg-green-600 text-white text-sm px-4 py-1 rounded-lg hover:bg-green-500 transition">
                        Calculate Credits →
                      </button>
                    )}
                    {!land.isVerified && (
                      <span className="text-xs text-gray-400 self-center">
                        Awaiting admin verification
                      </span>
                    )}
                  </div>
                </div>

                {/* Carbon History */}
                {selectedLand?.landId === land.landId &&
                  landCarbon.length > 0 && (
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <h4 className="text-sm font-semibold text-gray-600 mb-2">
                        Carbon Calculation History
                      </h4>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="text-left py-1">Year</th>
                            <th className="text-left py-1">AGB (t/ha)</th>
                            <th className="text-left py-1">BGB (t/ha)</th>
                            <th className="text-left py-1">SOC (t/ha)</th>
                            <th className="text-left py-1">Carbon Stock</th>
                            <th className="text-left py-1">Credits</th>
                          </tr>
                        </thead>
                        <tbody>
                          {landCarbon.map((c) => (
                            <tr
                              key={c.year}
                              className="border-t border-gray-50"
                            >
                              <td className="py-1">{c.year}</td>
                              <td className="py-1">{c.agbDensity}</td>
                              <td className="py-1">{c.bgbDensity}</td>
                              <td className="py-1">{c.socDensity}</td>
                              <td className="py-1">
                                {c.carbonStock.toFixed(2)} t
                              </td>
                              <td className="py-1 font-semibold text-green-600">
                                {c.creditsMinted}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}