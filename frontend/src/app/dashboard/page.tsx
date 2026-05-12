"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/context/AnchorProvider";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import Link from "next/link";
import { calculateCarbonCredits } from "@/lib/carbonCalculation";
import DroneUploadPanel, { DroneMetrics } from "@/components/DroneUploadPanel"; // HIDDEN: Satellite-only mode

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface LandRecord {
  publicKey: string;
  landId: string;
  polygonCoordinates: Array<[number, number]>;
  documentCid: string;
  areaHectares: number;
  isVerified: boolean;
  isDeclined: boolean;
  rejectionReason: string;
  lastCalculatedYear: number;
  totalCreditsMinted: number;
  calculationCount: number;
  lastCarbonStockCo2e: number; // on-chain baseline for next delta
}

interface CarbonRecord {
  landId: string;
  year: number;
  agbDensity: number;
  bgbDensity: number;
  socDensity: number;
  totalCarbonDensity: number;
  carbonStockTc: number;
  carbonStockCo2e: number;
  previousCarbonStockCo2e: number;
  creditsMinted: number;
  timestamp: number;
  authority: string;
  sequenceIndex: number;
  metadataCid: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const shortenAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

// Safe BN → number: avoids "Number can only safely store up to 53 bits" on i64/u64
const bnToNumber = (val: any): number => {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "object" && typeof val.toString === "function") {
    return parseInt(val.toString(), 10);
  }
  return Number(val);
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { connected, publicKey, wallet } = useWallet();
  const { program } = useAnchor();
  const { connection } = useConnection();

  const [lands, setLands] = useState<LandRecord[]>([]);
  const [carbonRecords, setCarbonRecords] = useState<CarbonRecord[]>([]);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [selectedLand, setSelectedLand] = useState<LandRecord | null>(null);
  const [selectedCalculation, setSelectedCalculation] = useState<{
    landId: string;
    year: number;
  } | null>(null);
  const [calculating, setCalculating] = useState<string | null>(null);
  const [calculationResults, setCalculationResults] = useState<any>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [calculatedForLandId, setCalculatedForLandId] = useState<string | null>(null);
  const [droneMetrics, setDroneMetrics] = useState<DroneMetrics | null>(null);

  // ─── Fetch Dashboard ──────────────────────────────────────────────────────

  const fetchDashboard = async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    try {
      // @ts-ignore
      const allLands = await program.account.landRecord.all([
        { memcmp: { offset: 8, bytes: publicKey.toBase58() } },
      ]);

      const formatted: LandRecord[] = allLands.map((l: any) => ({
        publicKey: l.publicKey.toBase58(),
        landId: l.account.landId,
        polygonCoordinates: l.account.polygonCoordinates,
        documentCid: l.account.documentCid,
        areaHectares: l.account.areaHectares,
        isVerified: l.account.isVerified,
        isDeclined: l.account.isDeclined,
        rejectionReason: l.account.rejectionReason,
        lastCalculatedYear: l.account.lastCalculatedYear,
        totalCreditsMinted: bnToNumber(l.account.totalCreditsMinted),
        calculationCount: bnToNumber(l.account.calculationCount),
        lastCarbonStockCo2e: l.account.lastCarbonStockCo2e ?? 0,
      }));
      setLands(formatted);

      // @ts-ignore
      const allCarbon = await program.account.carbonRecord.all();
      const formattedCarbon: CarbonRecord[] = allCarbon
        .filter((c: any) => formatted.some((l) => l.landId === c.account.landId))
        .map((c: any) => ({
          landId: c.account.landId,
          year: c.account.year,
          agbDensity: c.account.agbDensity ?? 0,
          bgbDensity: c.account.bgbDensity ?? 0,
          socDensity: c.account.socDensity ?? 0,
          totalCarbonDensity: c.account.totalCarbonDensity ?? 0,
          carbonStockTc: c.account.carbonStockTc ?? 0,
          carbonStockCo2e: c.account.carbonStockCo2e ?? 0,
          previousCarbonStockCo2e: c.account.previousCarbonStockCo2e ?? 0,
          creditsMinted: bnToNumber(c.account.creditsMinted),
          timestamp: bnToNumber(c.account.timestamp),
          authority: c.account.authority.toBase58(),
          sequenceIndex: bnToNumber(c.account.sequenceIndex),
          metadataCid: c.account.metadataCid ?? "",
        }));
      setCarbonRecords(formattedCarbon);

      // SPL token balance
      try {
        const [tokenMintPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("mint")],
          program.programId
        );
        const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
          mint: tokenMintPda,
        });
        if (tokenAccounts.value.length > 0) {
          const accountInfo = await getAccount(connection, tokenAccounts.value[0].pubkey);
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

  // ─── Calculate & Mint ─────────────────────────────────────────────────────

  // 1. Update the function signature (was: async (land: LandRecord))
  const handleCalculateCredits = async (land: LandRecord, droneMetrics?: DroneMetrics | null) => {
    setCalculating(land.landId);
    setCalculationError(null);
    setCalculationResults(null);
    setCalculatedForLandId(null);

    let timeoutId: NodeJS.Timeout | undefined;

    try {
      timeoutId = setTimeout(() => {
        console.warn("⚠️ Calculation timeout — clearing loading state");
        setCalculating(null);
      }, 5 * 60 * 1000);

      if (!publicKey) throw new Error("Wallet not connected");

      const currentYear = new Date().getFullYear();
      const startYear = land.lastCalculatedYear === 0 ? 2020 : land.lastCalculatedYear;

      if (land.lastCalculatedYear >= currentYear) {
        throw new Error(
          `Already calculated for ${land.lastCalculatedYear}. Wait until ${land.lastCalculatedYear + 1
          } (1-year gap required).`
        );
      }

      // Get most recent carbon record for this land
      const mostRecentRecord = carbonRecords
        .filter((c) => c.landId === land.landId)
        .sort((a, b) => b.year - a.year)[0];

      const request = {
        landId: land.landId,
        polygonCoordinates: land.polygonCoordinates,
        areaHectares: land.areaHectares,
        publicKey: publicKey.toBase58(),
        startYear,
        endYear: currentYear,
        isVerified: land.isVerified,
        // Pass previous record data to skip startYear satellite fetch
        lastCarbonStockCo2e: mostRecentRecord?.carbonStockCo2e ?? land.lastCarbonStockCo2e ?? 0,
        lastAgbDensity: mostRecentRecord?.agbDensity ?? 0,
        lastBgbDensity: mostRecentRecord?.bgbDensity ?? 0,
        lastSocDensity: mostRecentRecord?.socDensity ?? 0,
        ...(droneMetrics && {
          droneData: {
            orthomosaicCid: droneMetrics.orthomosaicCid,
            chmCid: droneMetrics.chmCid,
          },
        }),
      };

      const result = await calculateCarbonCredits(request);
      setCalculationResults(result.data);
      setCalculatedForLandId(land.landId);
      console.log("✅ Carbon calculation completed:", result.data);
      console.log("📊 carbonChange from API:", result.data?.carbonChange);
      console.log("  agbChange:", result.data?.carbonChange?.agbChange);
      console.log("  bgbChange:", result.data?.carbonChange?.bgbChange);
      console.log("  socChange:", result.data?.carbonChange?.socChange);
      console.log("  totalChange:", result.data?.carbonChange?.totalChange);
      console.log("  status:", result.data?.carbonChange?.status);
      // 3. Log which AGB source was used
      console.log("  agbSource:", result.data?.endYear?.agbSource ?? "satellite");

      if (!program) throw new Error("Program not initialized");

      const tokenMintPda = PublicKey.findProgramAddressSync(
        [Buffer.from("mint")],
        program.programId
      )[0];

      const landCarbon = carbonRecords.filter((c) => c.landId === land.landId);
      if (landCarbon.some((c) => c.year === currentYear)) {
        throw new Error(
          `Credits already calculated for ${currentYear}. Calculate again in ${currentYear + 1}.`
        );
      }

      const ownerTokenAccount = await getAssociatedTokenAddress(tokenMintPda, publicKey);

      let tokenAccountExists = false;
      try {
        await getAccount(connection, ownerTokenAccount);
        console.log("✅ Token account exists");
        tokenAccountExists = true;
      } catch (error: any) {
        if (error.message?.includes("could not find")) {
          console.log("📝 Token account doesn't exist, creating...");
        }
      }

      if (!tokenAccountExists) {
        try {
          const instruction = createAssociatedTokenAccountInstruction(
            publicKey,
            ownerTokenAccount,
            publicKey,
            tokenMintPda
          );
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
          const message = new TransactionMessage({
            payerKey: publicKey,
            recentBlockhash: blockhash,
            instructions: [instruction],
          }).compileToV0Message();

          const transaction = new VersionedTransaction(message);
          if (!wallet?.adapter) throw new Error("Wallet not available");
          const signed = await (wallet.adapter as any).signTransaction(transaction);
          const txid = await connection.sendRawTransaction(signed.serialize());

          try {
            const latest = await connection.getLatestBlockhash();
            await connection.confirmTransaction(
              {
                signature: txid,
                blockhash: latest.blockhash,
                lastValidBlockHeight: latest.lastValidBlockHeight,
              },
              "confirmed"
            );
          } catch {
            console.log("⏳ Waiting for token account creation...");
          }

          let accountVerified = false;
          for (let i = 0; i < 5; i++) {
            try {
              await getAccount(connection, ownerTokenAccount);
              console.log("✅ Token account created and verified");
              accountVerified = true;
              break;
            } catch {
              console.log(`📝 Attempt ${i + 1}: waiting for token account...`);
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
          if (!accountVerified) {
            console.warn("⚠️ Token account may not be ready, proceeding anyway...");
          }
        } catch (createError: any) {
          console.error("Token account creation error:", createError);
          console.log("📝 Continuing despite error...");
        }
      }

      // Use absolute end-year values to store on chain
      const agbDensity = result.data?.endYear?.carbonPools?.agb ?? 0;
      const bgbDensity = result.data?.endYear?.carbonPools?.bgb ?? 0;
      const socDensity = result.data?.endYear?.carbonPools?.soc ?? 0;
      const endYearCo2e = result.data?.endYear?.co2Equivalent ?? 0;
      const startYearCo2e = result.data?.startYear?.co2Equivalent ?? 0;

      console.log(`📝 Sending absolute end-year densities to contract for year ${currentYear}:`);
      console.log(`  AGB: ${agbDensity}, BGB: ${bgbDensity}, SOC: ${socDensity}`);
      console.log(`  End Year CO₂e Stock: ${endYearCo2e}`);

      // ── Step 1: Generate certificate first to get CID ───────────────────────────────
      let metadataCid = "";
      try {
        console.log("📄 Generating certificate...");
        const certRes = await fetch("/api/generate-certificate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            landId: land.landId,
            owner: publicKey.toBase58(),
            areaHectares: land.areaHectares,
            startYear: result.data?.startYear?.year,
            endYear: result.data?.endYear?.year,
            startAgb: result.data?.startYear?.carbonPools?.agb,
            startBgb: result.data?.startYear?.carbonPools?.bgb,
            startSoc: result.data?.startYear?.carbonPools?.soc,
            startCo2e: result.data?.startYear?.co2Equivalent,
            endAgb: result.data?.endYear?.carbonPools?.agb,
            endBgb: result.data?.endYear?.carbonPools?.bgb,
            endSoc: result.data?.endYear?.carbonPools?.soc,
            endCo2e: result.data?.endYear?.co2Equivalent,
            agbChange: result.data?.carbonChange?.agbChange,
            bgbChange: result.data?.carbonChange?.bgbChange,
            socChange: result.data?.carbonChange?.socChange,
            co2eChange: result.data?.carbonChange?.co2EquivalentChange,
            creditsAllocated: result.data?.carbonChange?.creditsAllocated,
            txSignature: "", // Empty for now, will include after transaction
            timestamp: Math.floor(Date.now() / 1000),
          }),
        });
        if (!certRes.ok) {
          throw new Error(`Certificate generation failed: ${certRes.status}`);
        }
        const certData = await certRes.json();
        if (certData.success) {
          metadataCid = certData.metadataCid;
          console.log("✅ Certificate CID generated:", metadataCid);
        } else {
          console.warn("⚠️ Certificate generation failed:", certData.error);
        }
      } catch (certErr) {
        console.warn("⚠️ Certificate generation error:", certErr);
      }

      // ── Step 2: Send to contract with certificate CID ─────────────────────────────
      let tx: string | undefined;
      try {
        tx = await program.methods
          .calculateAndMintV2(
            land.landId,          // 1. land_id: String
            currentYear,          // 2. year: u16
            agbDensity,           // 3. agb_density: f64
            bgbDensity,           // 4. bgb_density: f64
            socDensity,           // 5. soc_density: f64
            endYearCo2e,          // 6. absolute_co2e_end_year: f64
            startYearCo2e,        // 7. absolute_co2e_start_year: f64
            metadataCid,          // 8. metadata_cid: String (now has certificate CID)
          )
          .accounts({
            platformState: PublicKey.findProgramAddressSync(
              [Buffer.from("platform")],
              program.programId
            )[0],
            landRecord: new PublicKey(land.publicKey),
            tokenMint: tokenMintPda,
            ownerTokenAccount,
            authority: publicKey,
          })
          .rpc({ skipPreflight: true });
        console.log("✅ Transaction sent! Sig:", tx);
      } catch (mintError: any) {
        const errorStr = JSON.stringify(mintError);
        const errorMsg = mintError?.message || errorStr;
        console.log("🔍 Raw mint error:", mintError);
        if (errorStr.includes("already exists")) {
          throw new Error(`Calculation already exists for ${currentYear}. Wait until next year.`);
        } else if (errorStr.includes("Custom: 0") || errorStr.includes("Custom\":0")) {
          throw new Error(`Account constraint failed — calculation for ${currentYear} may already exist.`);
        } else if (errorStr.includes("Insufficient lamports")) {
          throw new Error("Insufficient SOL balance.");
        }
        throw new Error(errorMsg || "Transaction failed");
      }

      // ── Step 3: Wait for confirmation ─────────────────────────────────────────────
      try {
        console.log("⏳ Waiting for transaction confirmation...");
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          signature: tx,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        });
        console.log("✅ Transaction confirmed!");
      } catch (confirmErr) {
        console.warn("⚠️ Transaction confirmation warning:", confirmErr);
      }

      console.log("✅ Record saved on-chain! Transaction:", tx);
      await fetchDashboard();
      setCalculationResults(null);
      setCalculatedForLandId(null);

    } catch (err: any) {
      const errorMsg =
        err?.message ||
        (typeof err === "object" ? JSON.stringify(err) : String(err)) ||
        "Failed to calculate carbon credits";

      if (errorMsg.includes("already been processed") || errorMsg.includes("already processed")) {
        try {
          await fetchDashboard();
          setCalculationError(null);
        } catch {
          setCalculationError("Credits may have been allocated. Please refresh.");
        }
      } else {
        setCalculationError(errorMsg);
        console.error("❌ Carbon calculation error:", errorMsg);
        console.error("Full error object:", err);
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setCalculating(null);
    }
  };

  // ─── Effects ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (program && publicKey) fetchDashboard();
  }, [program, publicKey]);

  // ─── Not Connected ────────────────────────────────────────────────────────

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-semibold text-gray-700 mb-2">Connect your wallet</p>
          <p className="text-gray-500">Connect your Phantom wallet to view your dashboard</p>
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">

        {/* ── Header ── */}
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

        {/* ── Stats Cards ── */}
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
            <div className="text-4xl font-bold text-green-700">
              {tokenBalance.toLocaleString()}
            </div>
            <div className="text-gray-600 text-sm mt-2">Carbon Credits Balance</div>
          </div>
        </div>

        {/* ── Land Plots ── */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Your Land Plots</h2>
            <Link href="/register" className="text-green-600 hover:text-green-700 font-semibold text-sm">
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
                const landCarbon = carbonRecords
                  .filter((c) => c.landId === land.landId)
                  .sort((a, b) => b.year - a.year);

                const canCalculate =
                  land.isVerified &&
                  !land.isDeclined &&
                  (land.lastCalculatedYear === 0 ||
                    new Date().getFullYear() > land.lastCalculatedYear);

                const isExpanded = selectedLand?.landId === land.landId;

                return (
                  <div
                    key={land.landId}
                    className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition overflow-hidden"
                  >
                    {/* ── Card Header ── */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                          </div>
                          {land.isDeclined && land.rejectionReason && (
                            <p className="text-xs text-red-500 mt-1">
                              Reason: {land.rejectionReason}
                            </p>
                          )}
                        </div>
                        {/* FIX: "View Details" toggles history panel */}
                        <button
                          onClick={() =>
                            setSelectedLand(isExpanded ? null : land)
                          }
                          className="text-sm font-medium text-green-600 hover:text-green-800 transition whitespace-nowrap border border-green-200 px-3 py-1 rounded-lg hover:bg-green-50"
                        >
                          {isExpanded ? "▼ Hide Details" : "▶ View Details"}
                        </button>
                      </div>
                    </div>

                    {/* ── Card Stats ── */}
                    <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-white">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div>
                          <div className="text-gray-600 text-xs uppercase tracking-wide font-semibold">Area</div>
                          <div className="text-2xl font-bold text-gray-900 mt-1">
                            {land.areaHectares.toFixed(1)}
                          </div>
                          <div className="text-gray-500 text-xs">hectares</div>
                        </div>
                        <div>
                          <div className="text-gray-600 text-xs uppercase tracking-wide font-semibold">Last Calculated</div>
                          <div className="text-2xl font-bold text-gray-900 mt-1">
                            {land.lastCalculatedYear === 0 ? "—" : land.lastCalculatedYear}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-600 text-xs uppercase tracking-wide font-semibold">Calculations</div>
                          <div className="text-2xl font-bold text-gray-900 mt-1">
                            {land.calculationCount}
                          </div>
                          <div className="text-gray-500 text-xs">total</div>
                        </div>
                        <div>
                          <div className="text-gray-600 text-xs uppercase tracking-wide font-semibold">Credits</div>
                          <div className="text-2xl font-bold text-green-600 mt-1">
                            {land.totalCreditsMinted.toLocaleString()}
                          </div>
                          <div className="text-gray-500 text-xs">earned (lifetime)</div>
                        </div>
                      </div>
                    </div>

                    {/* ── Card Actions ── */}
                    <div className="px-6 py-4 flex flex-col gap-3 sm:gap-4 border-t border-gray-100 bg-gradient-to-r from-white to-gray-50">
                      {canCalculate && (
                        <DroneUploadPanel
                          land={{ landId: land.landId }}
                          onDroneProcessed={(metrics) => handleCalculateCredits(land, metrics)}
                          onSkipDrone={() => handleCalculateCredits(land, null)}
                          calculating={calculating === land.landId}
                        />
                      )}
                      <Link
                        href={`https://ipfs.io/ipfs/${land.documentCid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-center text-blue-600 hover:text-blue-700 font-medium text-sm py-2.5 rounded-lg hover:bg-blue-50 transition border border-blue-100"
                      >
                        📄 View Document
                      </Link>
                    </div>

                    {/* ── Calculation Error ── */}
                    {calculationError && calculating !== land.landId && (
                      <div className="px-6 py-4 border-t border-gray-100 bg-red-50">
                        <h4 className="font-semibold text-red-900 mb-2">❌ Calculation Error</h4>
                        <p className="text-sm text-red-700 mb-3">{calculationError}</p>
                        <div className="text-xs text-red-600 bg-red-100 p-2 rounded mb-3 font-mono overflow-x-auto">
                          Troubleshooting steps:
                          <ul className="list-disc ml-4 mt-2 space-y-1">
                            <li>Ensure model server is running: <code>python ml/model_server.py</code></li>
                            <li>Check that land is verified</li>
                            <li>Verify satellite data is available for your location</li>
                            <li>Check browser console for more details</li>
                          </ul>
                        </div>
                        <button
                          onClick={() => setCalculationError(null)}
                          className="text-sm text-red-600 hover:text-red-900 font-semibold py-1"
                        >
                          Dismiss Error
                        </button>
                      </div>
                    )}

                    {/* ── ML Calculation Preview (pre-mint) ── */}
                    {calculationResults?.carbonChange && calculatedForLandId === land.landId && (
                      <div className="px-6 py-4 border-t border-gray-100 bg-blue-50">
                        <h4 className="font-semibold text-gray-900 mb-4">📊 Carbon Calculation Results</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-white p-4 rounded-lg border border-blue-200">
                            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">
                              {calculationResults.startYear.year} Starting Values
                            </p>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600">AGB:</span>
                                <span className="font-semibold">{calculationResults.startYear.carbonPools.agb.toFixed(2)} t/ha</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">BGB:</span>
                                <span className="font-semibold">{calculationResults.startYear.carbonPools.bgb.toFixed(2)} t/ha</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">SOC:</span>
                                <span className="font-semibold">{calculationResults.startYear.carbonPools.soc.toFixed(2)} t/ha</span>
                              </div>
                              <div className="flex justify-between pt-2 border-t border-gray-200">
                                <span className="text-gray-600 font-medium">Total Stock:</span>
                                <span className="font-bold text-green-600">{calculationResults.startYear.totalCarbonStock.toFixed(0)} t</span>
                              </div>
                            </div>
                          </div>
                          <div className="bg-white p-4 rounded-lg border border-blue-200">
                            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">
                              {calculationResults.endYear.year} Ending Values
                            </p>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600">AGB:</span>
                                <span className="font-semibold">{calculationResults.endYear.carbonPools.agb.toFixed(2)} t/ha</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">BGB:</span>
                                <span className="font-semibold">{calculationResults.endYear.carbonPools.bgb.toFixed(2)} t/ha</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">SOC:</span>
                                <span className="font-semibold">{calculationResults.endYear.carbonPools.soc.toFixed(2)} t/ha</span>
                              </div>
                              <div className="flex justify-between pt-2 border-t border-gray-200">
                                <span className="text-gray-600 font-medium">Total Stock:</span>
                                <span className="font-bold text-green-600">{calculationResults.endYear.totalCarbonStock.toFixed(0)} t</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 p-4 bg-green-100 rounded-lg border border-green-300">
                          <p className="text-xs text-green-700 uppercase tracking-wide font-semibold mb-3">
                            Carbon Impact ({calculationResults.period.durationYears} year{calculationResults.period.durationYears > 1 ? "s" : ""})
                          </p>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                            <div>
                              <span className="text-green-700">AGB Change:</span>
                              <div className="font-bold text-green-600">
                                {calculationResults.carbonChange.agbChange > 0 ? "+" : ""}{calculationResults.carbonChange.agbChange.toFixed(2)} t/ha
                              </div>
                            </div>
                            <div>
                              <span className="text-green-700">SOC Change:</span>
                              <div className="font-bold text-green-600">
                                {calculationResults.carbonChange.socChange > 0 ? "+" : ""}{calculationResults.carbonChange.socChange.toFixed(2)} t/ha
                              </div>
                            </div>
                            <div>
                              <span className="text-green-700">Total Change:</span>
                              <div className="font-bold text-green-600">
                                {calculationResults.carbonChange.totalChange > 0 ? "+" : ""}{calculationResults.carbonChange.totalChange.toFixed(0)} t
                              </div>
                            </div>
                            <div>
                              <span className="text-green-700">Change %:</span>
                              <div className="font-bold text-green-600">
                                {calculationResults.carbonChange.percentChange > 0 ? "+" : ""}{calculationResults.carbonChange.percentChange.toFixed(2)}%
                              </div>
                            </div>
                            <div>
                              <span className="text-green-700">CO₂ Equivalent:</span>
                              <div className="font-bold text-green-600">
                                {calculationResults.carbonChange.co2EquivalentChange > 0 ? "+" : ""}{calculationResults.carbonChange.co2EquivalentChange.toFixed(0)} t CO₂e
                              </div>
                            </div>
                            <div>
                              <span className="text-green-700">Status:</span>
                              <div className="font-bold text-green-600">{calculationResults.carbonChange.status}</div>
                            </div>
                          </div>
                        </div>

                        {calculationResults.startYear.carbonPools.agb_uncertainty && (
                          <div className="mt-4 p-3 bg-yellow-50 rounded border border-yellow-200">
                            <p className="text-xs text-yellow-700 font-semibold">
                              ⚠️ Model Uncertainty (STD): {calculationResults.startYear.carbonPools.agb_uncertainty.toFixed(2)} t/ha
                            </p>
                          </div>
                        )}

                        <button
                          onClick={() => { setCalculationResults(null); setCalculationError(null); setCalculatedForLandId(null); }}
                          className="mt-4 w-full text-center text-sm text-gray-600 hover:text-gray-900 py-2 rounded hover:bg-gray-200 transition"
                        >
                          ✕ Close Results
                        </button>
                      </div>
                    )}

                    {/* ── FIX: Calculation History Panel (shown on "View Details") ── */}
                    {isExpanded && (
                      <div className="border-t border-gray-100">
                        {landCarbon.length === 0 ? (
                          <div className="px-6 py-8 text-center bg-gray-50">
                            <p className="text-gray-400 text-sm">No calculations yet for this plot.</p>
                            {canCalculate && (
                              <p className="text-gray-500 text-xs mt-1">
                                Click <strong>Calculate Credits</strong> above to get started.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="px-6 py-4 bg-gray-50">
                            <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                              📋 Calculation & Credit History
                              <span className="text-xs font-normal text-gray-500">
                                ({land.calculationCount} record{land.calculationCount !== 1 ? "s" : ""})
                              </span>
                            </h4>

                            {/* History Table */}
                            <div className="overflow-x-auto rounded-lg border border-gray-200">
                              <table className="w-full text-xs text-gray-700">
                                <thead className="bg-gray-100">
                                  <tr className="text-gray-500 border-b border-gray-200">
                                    <th className="text-left py-2 px-3 font-semibold">#</th>
                                    <th className="text-left py-2 px-3 font-semibold">Year</th>
                                    <th className="text-left py-2 px-3 font-semibold">AGB (t/ha)</th>
                                    <th className="text-left py-2 px-3 font-semibold">BGB (t/ha)</th>
                                    <th className="text-left py-2 px-3 font-semibold">SOC (t/ha)</th>
                                    <th className="text-left py-2 px-3 font-semibold">Stock tC</th>
                                    <th className="text-left py-2 px-3 font-semibold">Stock tCO₂e</th>
                                    <th className="text-left py-2 px-3 font-semibold">Prev tCO₂e</th>
                                    <th className="text-right py-2 px-3 font-semibold">Credits (Δ)</th>
                                    <th className="text-center py-2 px-3 font-semibold">Detail</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {landCarbon.map((c, idx) => {
                                    const isSelected =
                                      selectedCalculation?.landId === land.landId &&
                                      selectedCalculation?.year === c.year;
                                    const isFirstCalc = (c.previousCarbonStockCo2e ?? 0) === 0;
                                    const delta = (c.carbonStockCo2e ?? 0) - (c.previousCarbonStockCo2e ?? 0);

                                    return (
                                      <tr
                                        key={c.year}
                                        className={`border-b border-gray-100 transition ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                                          } ${isSelected ? "!bg-blue-100 border-blue-200" : "hover:bg-blue-50"}`}
                                      >
                                        <td className="py-2 px-3 text-gray-400 font-mono">
                                          {c.sequenceIndex + 1}
                                        </td>
                                        <td className="py-2 px-3 font-semibold text-gray-800">{c.year}</td>
                                        <td className="py-2 px-3">{(c.agbDensity ?? 0).toFixed(2)}</td>
                                        <td className="py-2 px-3">{(c.bgbDensity ?? 0).toFixed(2)}</td>
                                        <td className="py-2 px-3">{(c.socDensity ?? 0).toFixed(2)}</td>
                                        <td className="py-2 px-3">{(c.carbonStockTc ?? 0).toFixed(1)}</td>
                                        <td className="py-2 px-3">{(c.carbonStockCo2e ?? 0).toFixed(1)}</td>
                                        <td className="py-2 px-3 text-gray-500">
                                          {isFirstCalc ? (
                                            <span className="italic text-gray-400">baseline</span>
                                          ) : (
                                            (c.previousCarbonStockCo2e ?? 0).toFixed(1)
                                          )}
                                        </td>
                                        <td className="py-2 px-3 text-right">
                                          <span className={`font-bold ${c.creditsMinted > 0 ? "text-green-600" : "text-amber-500"}`}>
                                            {c.creditsMinted > 0 ? "+" : ""}{(c.creditsMinted ?? 0).toLocaleString()}
                                          </span>
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                          <button
                                            onClick={() =>
                                              setSelectedCalculation(
                                                isSelected ? null : { landId: land.landId, year: c.year }
                                              )
                                            }
                                            className="text-blue-600 hover:text-blue-800 font-semibold text-xs bg-blue-100 hover:bg-blue-200 px-2 py-1 rounded transition"
                                          >
                                            {isSelected ? "▼" : "▶"}
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* ── Expanded Detail for selected row ── */}
                            {selectedCalculation?.landId === land.landId && (() => {
                              const rec = landCarbon.find((c) => c.year === selectedCalculation.year);
                              if (!rec) return null;
                              const isFirstCalc = (rec.previousCarbonStockCo2e ?? 0) === 0;
                              const delta = (rec.carbonStockCo2e ?? 0) - (rec.previousCarbonStockCo2e ?? 0);

                              return (
                                <div className="mt-4 p-4 bg-white rounded-xl border border-blue-200 space-y-3">

                                  {/* Year + Credits */}
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Year</p>
                                      <p className="text-2xl font-bold text-gray-900">{rec.year}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Credits Minted</p>
                                      <p className={`text-2xl font-bold ${rec.creditsMinted > 0 ? "text-green-600" : "text-amber-500"}`}>
                                        {rec.creditsMinted > 0 ? "+" : ""}{(rec.creditsMinted ?? 0).toLocaleString()}
                                        <span className="text-sm font-normal text-gray-500 ml-1">credits</span>
                                      </p>
                                    </div>
                                  </div>

                                  {/* Key numbers */}
                                  <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm border border-gray-100">
                                    <div className="flex justify-between">
                                      <span className="text-gray-500">CO₂e Stock</span>
                                      <span className="font-semibold text-gray-900">{(rec.carbonStockCo2e ?? 0).toFixed(1)} t</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-500">Previous</span>
                                      <span className="font-semibold text-gray-900">
                                        {isFirstCalc
                                          ? <span className="italic text-gray-400 font-normal">baseline</span>
                                          : `${(rec.previousCarbonStockCo2e ?? 0).toFixed(1)} t`
                                        }
                                      </span>
                                    </div>
                                    <div className="flex justify-between pt-2 border-t border-gray-200">
                                      <span className="text-gray-500">Change</span>
                                      <span className={`font-bold ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-500" : "text-gray-400"}`}>
                                        {isFirstCalc ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} t CO₂e`}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Note about certificate */}
                                  {!isFirstCalc && rec.metadataCid && (
                                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                                      <p className="text-xs text-blue-700 font-semibold mb-2">📊 Full Calculation Details</p>
                                      <p className="text-xs text-blue-600 mb-3">View the certificate to see detailed credit calculation breakdown and CO₂e change.</p>
                                    </div>
                                  )}

                                  {/* Links */}
                                  <div className="space-y-2 pt-1">
                                    {rec.metadataCid && (
                                      <a
                                        href={`/certificate/${rec.metadataCid}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-between w-full text-sm text-blue-600 hover:text-blue-800 font-medium bg-blue-50 border border-blue-200 px-3 py-2.5 rounded-lg hover:bg-blue-100 transition"
                                      >
                                        <span>📄 View Full Certificate</span>
                                        <span className="text-xs text-blue-400">IPFS →</span>
                                      </a>
                                    )}
                                  </div>

                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )
                    }

                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div >
  );
}