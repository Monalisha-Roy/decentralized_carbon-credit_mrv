"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface CertificateAttribute {
  trait_type: string;
  value: string | number;
}

interface Certificate {
  name: string;
  description: string;
  attributes: CertificateAttribute[];
}

function getAttr(attrs: CertificateAttribute[], key: string): string {
  const found = attrs.find((a) => a.trait_type === key);
  if (!found) return "—";
  if (typeof found.value === "number") return found.value.toFixed(2);
  return String(found.value);
}

function getNum(attrs: CertificateAttribute[], key: string): number {
  const found = attrs.find((a) => a.trait_type === key);
  return found ? Number(found.value) : 0;
}

export default function CertificatePage() {
  const params = useParams();
  const cid = params?.cid as string;

  const [cert, setCert] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cid) return;
    setLoading(true);
    fetch(`https://gateway.pinata.cloud/ipfs/${cid}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch certificate");
        return r.json();
      })
      .then((data) => {
        setCert(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [cid]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f0a] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-2 border-[#4ade80] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-[#4ade80] font-mono text-sm tracking-widest uppercase">
            Fetching Certificate
          </p>
        </div>
      </div>
    );
  }

  if (error || !cert) {
    return (
      <div className="min-h-screen bg-[#0a0f0a] flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-400 font-mono text-sm">Failed to load certificate</p>
          <p className="text-gray-600 text-xs font-mono">{error}</p>
        </div>
      </div>
    );
  }

  const attrs = cert.attributes;
  const landId      = getAttr(attrs, "Land ID");
  const owner       = getAttr(attrs, "Owner");
  const area        = getAttr(attrs, "Area (ha)");
  const period      = getAttr(attrs, "Period");
  const issuedAt    = getAttr(attrs, "Issued At");
  const txSig       = getAttr(attrs, "Transaction");
  const blockchain  = getAttr(attrs, "Blockchain");
  const standard    = getAttr(attrs, "Standard");
  const credits     = getNum(attrs, "Credits Allocated");

  const startAgb    = getNum(attrs, "Start AGB (t/ha)");
  const startBgb    = getNum(attrs, "Start BGB (t/ha)");
  const startSoc    = getNum(attrs, "Start SOC (t/ha)");
  const startCo2e   = getNum(attrs, "Start CO₂e Stock (t)");

  const endAgb      = getNum(attrs, "End AGB (t/ha)");
  const endBgb      = getNum(attrs, "End BGB (t/ha)");
  const endSoc      = getNum(attrs, "End SOC (t/ha)");
  const endCo2e     = getNum(attrs, "End CO₂e Stock (t)");

  const agbChange   = getNum(attrs, "AGB Change (t/ha)");
  const bgbChange   = getNum(attrs, "BGB Change (t/ha)");
  const socChange   = getNum(attrs, "SOC Change (t/ha)");
  const co2eChange  = getNum(attrs, "CO₂e Change (t)");

  const isBaseline  = credits === 0 && co2eChange === 0;
  const issuedDate  = issuedAt !== "—"
    ? new Date(issuedAt).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

  const shortTx = txSig !== "—" && txSig !== "pending"
    ? `${txSig.slice(0, 12)}...${txSig.slice(-8)}`
    : txSig;

  const shortOwner = owner !== "—"
    ? `${owner.slice(0, 8)}...${owner.slice(-8)}`
    : "—";

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#faf7f2] via-[#fefcf8] to-[#f5f0e8] py-12 px-4" style={{backgroundImage: 'linear-gradient(135deg, #faf7f2 0%, #fefcf8 50%, #f5f0e8 100%), url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' /%3E%3C/filter%3E%3Crect width=\'100\' height=\'100\' filter=\'url(%23noise)\' opacity=\'0.02\'/%3E%3C/svg%3E")'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Lora:wght@400;500;600&family=IBM+Plex+Mono:wght@300;400;500&display=swap');
        .cert-font { font-family: 'Cormorant Garamond', serif; letter-spacing: 0.05em; }
        .cert-accent { font-family: 'Lora', serif; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .cert-border { 
          border-image: linear-gradient(135deg, #c19a6b 0%, #8b7355 50%, #c19a6b 100%) 1;
          box-shadow: inset 0 0 0 1px rgba(193, 154, 107, 0.1), 0 8px 32px rgba(0, 0, 0, 0.06);
        }
        .cert-seal {
          background: radial-gradient(circle at 30% 30%, #d4af37, #8b7355);
          box-shadow: 0 8px 16px rgba(139, 115, 85, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.8s ease forwards; }
        .fade-up-1 { animation-delay: 0.1s; opacity: 0; }
        .fade-up-2 { animation-delay: 0.2s; opacity: 0; }
        .fade-up-3 { animation-delay: 0.3s; opacity: 0; }
        .fade-up-4 { animation-delay: 0.4s; opacity: 0; }
        .fade-up-5 { animation-delay: 0.5s; opacity: 0; }
        .decorative-line {
          background: linear-gradient(90deg, transparent, #c19a6b, transparent);
          height: 1px;
        }
      `}</style>

      <div className="max-w-7xl mx-auto space-y-2">

        {/* Decorative top element */}
        <div className="fade-up fade-up-1 text-center mb-3">
          <div className="inline-block">
            <div className="text-4xl mb-2">✦</div>
            <p className="cert-accent text-[#8b7355] text-xs tracking-widest uppercase" style={{fontSize: '11px', letterSpacing: '0.2em'}}>
              Certified Carbon
            </p>
            <p className="cert-accent text-[#c19a6b] text-xs tracking-widest uppercase" style={{fontSize: '10px', letterSpacing: '0.15em'}}>
              Verification Document
            </p>
          </div>
        </div>

        {/* Main Certificate Frame */}
        <div className="fade-up fade-up-2 max-w-3xl mx-auto">
          <div className="relative bg-gradient-to-b from-[#fffef9] to-[#faf7f0] rounded-lg overflow-hidden" style={{boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15), inset 0 0 0 1px rgba(193, 154, 107, 0.2)', border: '2px solid #d4af37'}}>
          
          {/* Decorative border pattern */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#c19a6b] to-transparent opacity-50" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#c19a6b] to-transparent opacity-50" />

          <div className="p-6 space-y-3">

            {/* Title */}
            <div className="text-center space-y-2 border-b border-[#c19a6b] border-opacity-30 pb-3">
              <p className="cert-accent text-[#8b7355] text-xs tracking-widest uppercase" style={{letterSpacing: '0.15em'}}>
                {period}
              </p>
              <h1 className="cert-font text-3xl text-[#4a3728]" style={{fontWeight: 600}}>
                {isBaseline ? "Baseline" : "Carbon Credit"}
              </h1>
              <h2 className="cert-accent text-lg text-[#8b7355]">
                {isBaseline ? "Establishment" : "Certificate"}
              </h2>
              <p className="cert-accent text-[#a0826d] text-sm italic pt-2">Authenticated Digital Ledger</p>
            </div>

            {/* Credits banner */}
            <div className={`rounded-lg p-4 text-center space-y-2 ${
              isBaseline
                ? "bg-blue-50 border border-[#a0c4de]"
                : "bg-gradient-to-br from-green-50 to-emerald-50 border border-[#c19a6b]"
            }`} style={{boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)'}}>
              {isBaseline ? (
                <div>
                  <p className="text-[#4a6fa5] text-xs uppercase tracking-widest cert-accent mb-2">
                    Baseline Established
                  </p>
                  <p className="text-[#2c4370] text-4xl font-semibold cert-font" style={{fontWeight: 600}}>
                    {endCo2e.toFixed(1)} t CO₂e
                  </p>
                  <p className="text-[#6b8cc1] text-sm cert-accent mt-2">
                    Reference stock for future calculations
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-[#5a7d2a] text-xs uppercase tracking-widest cert-accent mb-2">
                    Credits Issued
                  </p>
                  <p className="text-[#3a5f1a] text-5xl font-bold cert-font" style={{fontWeight: 700}}>
                    +{credits.toLocaleString()}
                  </p>
                  <p className="text-[#6b9a3a] text-sm cert-accent mt-3">
                    1 credit = 1 tonne CO₂e sequestered
                  </p>
                  <div className="pt-3 border-t border-[#c19a6b] border-opacity-30 mt-3">
                    <p className="text-[#8b7355] text-xs cert-accent">CO₂e Increase</p>
                    <p className="text-[#5a7d2a] text-2xl font-semibold cert-font">+{co2eChange.toFixed(1)} t</p>
                  </div>
                </div>
              )}
            </div>

            {/* Carbon pools comparison */}
            <div>
              <p className="cert-accent text-[#8b7355] text-xs uppercase tracking-widest mb-2" style={{letterSpacing: '0.1em'}}>
                Carbon Pool Analysis
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "AGB", start: startAgb, end: endAgb, change: agbChange, color: "#c19a6b" },
                  { label: "BGB", start: startBgb, end: endBgb, change: bgbChange, color: "#a0826d" },
                  { label: "SOC", start: startSoc, end: endSoc, change: socChange, color: "#d4af37" },
                ].map((pool) => (
                  <div
                    key={pool.label}
                    className="rounded-lg border p-3 bg-white"
                    style={{borderColor: pool.color, borderWidth: '1px', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)'}}
                  >
                    <p className="text-xs uppercase tracking-widest cert-accent mb-3" style={{color: pool.color, letterSpacing: '0.1em'}}>
                      {pool.label}
                    </p>
                    <div className="space-y-2 text-xs cert-accent">
                      <div className="flex justify-between text-[#8b7355]">
                        <span>Start</span>
                        <span className="font-medium">{pool.start.toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between text-[#4a3728] font-semibold">
                        <span>End</span>
                        <span>{pool.end.toFixed(1)}</span>
                      </div>
                      <div className="pt-2 border-t border-[#e0d7cc] flex justify-between font-medium"
                        style={{ color: pool.change >= 0 ? "#3a5f1a" : "#8b3a3a" }}>
                        <span>Δ</span>
                        <span>{pool.change >= 0 ? "+" : ""}{pool.change.toFixed(2)}</span>
                      </div>
                    </div>
                    <p className="text-[#8b7355] text-xs cert-accent mt-2">t C/ha</p>
                  </div>
                ))}
              </div>
            </div>

            {/* CO2e stocks */}
            <div className="grid grid-cols-2 gap-2 border-t border-[#c19a6b] border-opacity-30 pt-3">
              <div className="text-center p-6 rounded-lg bg-white border border-[#d4d0c0]" style={{boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)'}}>
                <p className="text-[#8b7355] text-xs uppercase tracking-widest cert-accent mb-3" style={{letterSpacing: '0.1em'}}>
                  Start CO₂e Stock
                </p>
                <p className="text-[#4a3728] text-3xl font-semibold cert-font" style={{fontWeight: 600}}>
                  {startCo2e.toFixed(1)} t
                </p>
              </div>
              <div className="text-center p-6 rounded-lg bg-gradient-to-br from-green-50 to-emerald-50 border border-[#c19a6b]" style={{boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)'}}>
                <p className="text-[#5a7d2a] text-xs uppercase tracking-widest cert-accent mb-3" style={{letterSpacing: '0.1em'}}>
                  End CO₂e Stock
                </p>
                <p className="text-[#3a5f1a] text-3xl font-bold cert-font" style={{fontWeight: 700}}>
                  {endCo2e.toFixed(1)} t
                </p>
              </div>
            </div>

            {/* Credit Calculation Breakdown */}
            <div className="rounded-lg p-4 bg-amber-50 border border-amber-200 space-y-2">
              <p className="text-[#8b5a2b] text-xs uppercase tracking-widest cert-accent font-semibold">Credit Calculation Details</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-white rounded p-2 border border-amber-100">
                  <p className="text-[#8b7355] cert-accent mb-1">CO₂e Delta</p>
                  <p className="text-[#5a7d2a] font-semibold text-sm cert-font">{co2eChange.toFixed(2)} t</p>
                </div>
                <div className="bg-white rounded p-2 border border-amber-100">
                  <p className="text-[#8b7355] cert-accent mb-1">Credits Allocated</p>
                  <p className="text-[#3a5f1a] font-semibold text-sm cert-font">{credits}</p>
                </div>
              </div>
              <p className="text-[#8b5a2b] text-xs cert-accent italic">1 credit = 1 tonne CO₂e increase</p>
            </div>

            {/* Details grid - Land & Verification inside certificate */}
            <div className="grid grid-cols-2 gap-2 border-t border-[#c19a6b] border-opacity-30 pt-3">
              {/* Land details card */}
              <div className="rounded-lg p-4 bg-white bg-opacity-50 border border-[#e0d7cc]">
                <p className="text-[#8b7355] text-xs uppercase tracking-widest cert-accent mb-3">
                  Land & Ownership
                </p>
                <div className="space-y-3 text-xs">
                  <div>
                    <p className="text-[#8b7355] cert-accent mb-1">Land ID</p>
                    <p className="text-[#4a3728] cert-accent font-medium break-all text-xs">{landId}</p>
                  </div>
                  <div>
                    <p className="text-[#8b7355] cert-accent mb-1">Area</p>
                    <p className="text-[#4a3728] cert-accent font-medium">{area} ha</p>
                  </div>
                  <div>
                    <p className="text-[#8b7355] cert-accent mb-1">Owner</p>
                    <p className="text-[#4a3728] cert-accent text-xs break-all">{shortOwner}</p>
                  </div>
                </div>
              </div>

              {/* Verification card */}
              <div className="rounded-lg p-4 bg-white bg-opacity-50 border border-[#e0d7cc]">
                <p className="text-[#8b7355] text-xs uppercase tracking-widest cert-accent mb-3">
                  On-Chain Verification
                </p>
                <div className="space-y-2 text-xs">
                  <div>
                    <p className="text-[#8b7355] cert-accent mb-1">Blockchain</p>
                    <p className="text-[#4a3728] cert-accent text-xs">{blockchain}</p>
                  </div>
                  <div>
                    <p className="text-[#8b7355] cert-accent mb-1">Transaction</p>
                    {txSig !== "pending" && txSig !== "—" ? (
                      <a
                        href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#5a7d2a] cert-accent text-xs hover:underline break-all"
                      >
                        {shortTx} ↗
                      </a>
                    ) : (
                      <p className="text-[#8b7355] cert-accent text-xs">{txSig}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[#8b7355] cert-accent mb-1">Issued At</p>
                    <p className="text-[#4a3728] cert-accent text-xs">{issuedDate}</p>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Decorative seal area */}
          <div className="absolute bottom-4 right-4 w-16 h-16 cert-seal rounded-full opacity-60 flex items-center justify-center">
            <div className="text-white text-lg font-bold cert-font">✓</div>
          </div>

          {/* Bottom decorative elements */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#c19a6b] to-transparent opacity-50" />
          </div>
        </div>

        {/* Footer */}
        <div className="fade-up fade-up-4 text-center py-2 space-y-1">
          <p className="text-[#8b7355] text-xs cert-accent">
            This certificate is permanently stored on IPFS and verified on Solana blockchain.
          </p>
          <div className="flex items-center justify-center gap-1 text-xs">
            <span className="text-[#8b7355] cert-accent">IPFS CID:</span>
            <p className="text-[#a0826d] mono break-all max-w-2xl">{cid}</p>
          </div>
        </div>

      </div>
    </div>
  );
}