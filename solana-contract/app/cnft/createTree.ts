import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
    createTree,
    mplBubblegum,
} from "@metaplex-foundation/mpl-bubblegum";
import {
    keypairIdentity,
    generateSigner,
} from "@metaplex-foundation/umi";
import { readFile, readFileSync } from "fs";
import { homedir } from "os";

async function main() {
    // connect to devnet
    const umi = createUmi("https://api.devnet.solana.com").use(mplBubblegum());
    
    // Load your authority wallet
    const keyfileBytes = JSON.parse(
        readFileSync(`${homedir()}/.config/solana/id.json`, "utf-8")
    );
    const keypair = umi.eddsa.createKeypairFromSecretKey(
        Uint8Array.from(keyfileBytes)
    );
    umi.use(keypairIdentity(keypair));

    console.log("Authority:", keypair.publicKey);

    // Generate a new keypair for the Merkle tree account
    const merkleTree = generateSigner(umi);
    console.log("Merkle Tree Adress:", merkleTree.publicKey);

    // create the tree
    // maxDepth = 14 supports up to 16,284 cNFTs
    // maxBufferedSize=64 is standard
    const builder = await createTree(umi, {
        merkleTree,
        maxDepth: 14,
        maxBufferSize: 64,
    });

    await builder.sendAndConfirm(umi);

    console.log("Merkle Tree created successfully!");
    console.log("Save this address: ", merkleTree.publicKey);
    console.log("You will need it for minting cNFTs");
}

main().catch(console.error);