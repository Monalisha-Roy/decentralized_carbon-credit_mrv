import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
    mplBubblegum,
    mintToCollectionV1,
    mintV1,
} from "@metaplex-foundation/mpl-bubblegum";
import {
    keypairIdentity,
    publicKey as umiPublicKey,
} from "@metaplex-foundation/umi";
import { readFileSync } from "fs";
import { homedir } from "os";
import { builtinModules } from "module";
import { idlAddress } from "@coral-xyz/anchor/dist/cjs/idl";
import { validateAccounts } from "@coral-xyz/anchor";
import { buffer } from "stream/consumers";

// CARBON CERTIFICATE METADATA TYPE
export interface CarbonCertificateData {
    landId: string;
    ownerWallet: string;
    year: number;
    agbDensity: number;
    bgbDensity: number;
    socDensity: number;
    totalDensity: number;
    carbonStock: number;
    creditsMinted: number;
    areaHectares: number;
    ipfsCid: string;
}

// MINT CNFT CERTIFICATE
export async function mintCarbonCertificate(data: CarbonCertificateData) {
    const MERKLE_TREE = "3jqRgf5hMSbtQCKKNBXfGRiqJ92URsezNsZCUmaXXZUJ";

    // connect to devnet
    const umi = createUmi("https://api.devnet.solana.com").use(mplBubblegum());

    // Load authority wallet
    const keyfileBytes = JSON.parse(
        readFileSync(`${homedir()}/.config/solana/id.json`, "utf-8")
    );
    const keypair = umi.eddsa.createKeypairFromSecretKey(
        Uint8Array.from(keyfileBytes)
    );
    umi.use(keypairIdentity(keypair));

    // Build metadata for the certificate
    const metadata = {
        name: `CCC-${data.landId}-${data.year}`,
        Symbol: "CCC",
        uri: buildMetadataUri(data),
        sellerFeeBasisPoints: 0,
        creators: [
            {
                address: keypair.publicKey,
                verified: true,
                share: 100,
            },
        ],
        collection: null,
        uses: null,
    };

    console.log("Minting cNFT certificate for: ", data.landId, data.year);

    const { signature } = await mintV1(umi, {
        leafOwner: umiPublicKey(data.ownerWallet),
        merkleTree: umiPublicKey(MERKLE_TREE),
        metadata,
    }).sendAndConfirm(umi);

    console.log("cNFT minted! Signature:", signature);
    return signature;
}

// BUILD METADATA URI
// In production this should be uploaded to IPFS first
// for now we use a data URI with teh carbon details
function buildMetadataUri(data: CarbonCertificateData): string {
  // In production: upload metadata JSON to IPFS and return the URL like:
  // https://ipfs.io/ipfs/QmXxxxxxx
  // For now we use a short placeholder URI
  return `https://carbon-credit-mrv.app/certificate/${data.landId}/${data.year}`;
}

// TEST RUN
async function main() {
    const testData: CarbonCertificateData = {
        landId: "land-001",
        ownerWallet: "Bjt92NdnruXKVhT1WwxYuzDC8SUwmMyXShrmAKjcPfDM",
        year: 2024,
        agbDensity: 45.5,
        bgbDensity: 12.3,
        socDensity: 8.7,
        totalDensity: 66.5,
        carbonStock: 698.25,
        creditsMinted: 698,
        areaHectares: 10.5,
        ipfsCid: "QmX7b5jxn6Tl3FqxV2kY9mP8rZ3wN1oA4cD6eF2gH8iJ0k",
    };

    await mintCarbonCertificate(testData);
}
main().catch(console.error);