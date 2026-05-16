import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      landId, owner, areaHectares,
      startYear, endYear,
      startAgb, startBgb, startSoc, startCo2e,
      endAgb, endBgb, endSoc, endCo2e,
      agbChange, bgbChange, socChange,
      co2eChange, creditsAllocated,
      txSignature, timestamp,
    } = body;

    const certificate = {
      name: `Carbon Credit Certificate — ${landId}`,
      description: `Verified carbon sequestration certificate for land plot ${landId}`,
      attributes: [
        { trait_type: "Land ID",            value: landId },
        { trait_type: "Owner",              value: owner },
        { trait_type: "Area (ha)",          value: areaHectares },
        { trait_type: "Period",             value: `${startYear} → ${endYear}` },
        // Start year
        { trait_type: "Start AGB (t)",   value: startAgb },
        { trait_type: "Start BGB (t)",   value: startBgb },
        { trait_type: "Start SOC (t)",   value: startSoc },
        { trait_type: "Start CO₂e Stock (t)", value: startCo2e },
        // End year
        { trait_type: "End AGB (t)",     value: endAgb },
        { trait_type: "End BGB (t)",     value: endBgb },
        { trait_type: "End SOC (t)",     value: endSoc },
        { trait_type: "End CO₂e Stock (t)", value: endCo2e },
        // Changes
        { trait_type: "AGB Change (t)",  value: agbChange },
        { trait_type: "BGB Change (t)",  value: bgbChange },
        { trait_type: "SOC Change (t)",  value: socChange },
        { trait_type: "CO₂e Change (t)",    value: co2eChange },
        { trait_type: "Credits Allocated",  value: creditsAllocated },
        // Verification
        { trait_type: "Transaction",        value: txSignature },
        { trait_type: "Issued At",          value: new Date(timestamp * 1000).toISOString() },
        { trait_type: "Blockchain",         value: "Solana Devnet" },
        { trait_type: "Standard",           value: "Carbon MRV v1.0" },
      ],
    };

    const pinataRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataContent: certificate,
        pinataMetadata: { name: `certificate_${landId}_${endYear}.json` },
      }),
    });

    if (!pinataRes.ok) {
      const err = await pinataRes.text();
      throw new Error(`Pinata upload failed: ${err}`);
    }

    const pinataData = await pinataRes.json();
    const metadataCid = pinataData.IpfsHash;

    return NextResponse.json({
      success: true,
      metadataCid,
      metadataUrl: `https://gateway.pinata.cloud/ipfs/${metadataCid}`,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}