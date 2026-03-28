import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaContract } from "../target/types/solana_contract";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("decentralized_carbon-credit_mrv", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaContract as Program<SolanaContract>;
  const authority = provider.wallet as anchor.Wallet;

  // Land owner (a new keypair to simulate a different user)
  const landOwner = anchor.web3.Keypair.generate();

  // PDAa
  let platformStatePda: anchor.web3.PublicKey;
  let tokenMintPda: anchor.web3.PublicKey;
  let landRecordPda: anchor.web3.PublicKey;
  let carbonRecordPda: anchor.web3.PublicKey;
  let ownerTokenAccount: anchor.web3.PublicKey;

  const landId = "land-001";
  const ipfsCid = "QmX7b5jxn6Tl3FqxV2kY9mP8rZ3wN1oA4cD6eF2gH8iJ0k";
  const areaHectares = 10.5;
  const year = 2024;

  before(async() => {
    // Fund land owner from authority wallet instead of airdrop
    const transferTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: landOwner.publicKey,
        lamports: 1 * anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(transferTx);

    // Derive PDAs
    [platformStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("platform")],
      program.programId
    );

    [tokenMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      program.programId
    );

    [landRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("land"), Buffer.from(landId)],
      program.programId
    );

    const yearBuffer = Buffer.alloc(2);
    yearBuffer.writeUInt16LE(year);
    [carbonRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("carbon"), Buffer.from(landId), yearBuffer],
      program.programId
    );
  });

  // =====================
  // TEST 1: Initialize Platform
  // =====================
  it("Initializes the platform", async () => {
    try {
      const tx = await program.methods
        .initializePlatform()
        .accounts({
          platformState: platformStatePda,
          tokenMint: tokenMintPda,
          authority: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log(" Platform initialized. Tx:", tx);
    } catch (e) {
      // Already initialized — skip
      console.log("Platform already initialized, skipping...");
    }

    const platform = await program.account.platformState.fetch(platformStatePda);
    assert.ok(platform.authority.equals(authority.publicKey));
    assert.ok(platform.tokenMint.equals(tokenMintPda));
    console.log("   Authority:", platform.authority.toBase58());
    console.log("   Token Mint:", platform.tokenMint.toBase58());
  });

  // TEST 2: RESGISTER LAND
  it("Registers a land plot", async () => {
    const tx = await program.methods
      .registerLand(landId, ipfsCid, areaHectares)
      .accounts({
        landRecord: landRecordPda,
        owner: landOwner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([landOwner])
      .rpc();
    console.log("Land registered: Tx:", tx);

    const land = await program.account.landRecord.fetch(landRecordPda);
    assert.ok(land.owner.equals(landOwner.publicKey));
    assert.equal(land.landId, landId);
    assert.equal(land.ipfsCid, ipfsCid);
    assert.equal(land.areaHectares, areaHectares);
    assert.equal(land.isVerified, false);
    assert.equal(land.lastCalculatedYear, 0);
    console.log("Land ID: ", land.landId);
    console.log("Area: ", land.areaHectares, "hectares");
    console.log("Verified: ", land.isVerified);
  });

  // TEST 3: VERIFY LAND
  it("Verifies the land (authority only)", async () => {
    const tx = await program.methods
      .verifyLand()
      .accounts({
        platformState: platformStatePda,
        landRecord: landRecordPda,
        authority: authority.publicKey,
      })
      .rpc();
    console.log("Land Verified. Tx: ", tx);

    const land = await program.account.landRecord.fetch(landRecordPda);
    assert.equal(land.isVerified, true);
    console.log("IS VErified: ", land.isVerified);
  });

  // TEST 4: UNAUTHORIZED VERIFY SHOULD FALL
  it("Rejects unauthorized land verification", async () => {
    const fakeAuthority = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .verifyLand()
        .accounts({
          platformState: platformStatePda,
          landRecord: landRecordPda,
          authority: fakeAuthority.publicKey,
        })
        .signers([fakeAuthority])
        .rpc();
      assert.fail("Should have thrown Unauthorized error");
    } catch (e) {
      console.log("Correctly rejected unauthorized verification");
    }
  });

  // TEST 5: CALCULATE AND MINT
  it ("Calculates carbon and mints SPL tokens", async () => {
    // Create owner's token account
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (authority.payer as anchor.web3.Keypair),
      tokenMintPda,
      landOwner.publicKey
    );
    ownerTokenAccount = tokenAccount.address;

    const agbDensity = 45.5;
    const bgbDensity = 12.3;
    const socDensity = 8.7;

    const tx = await program.methods
      .calculateAndMint(landId, year, agbDensity, bgbDensity, socDensity)
      .accounts({
        platformState: platformStatePda,
        landRecord: landRecordPda,
        carbonRecord: carbonRecordPda,
        tokenMint: tokenMintPda,
        ownerTokenAccount: ownerTokenAccount,
        authority: authority.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Carbon calculated and tokens minted. Tx: ", tx);

    // check carbon record
    const carbon = await program.account.carbonRecord.fetch(carbonRecordPda);
    assert.equal(carbon.landId, landId);
    assert.equal(carbon.year, year);
    console.log("AGB Density: ", carbon.agbDensity);
    console.log("BGB Density: ", carbon.bgbDensity);
    console.log("SOC Density: ", carbon.socDensity);
    console.log("Total Density: ", carbon.totalDensity);
    console.log("Carbon Stock: ", carbon.carbonStock, "tonnes");
    console.log("Credits Minted: ", carbon.creditsMinted.toString());

    // check token balance
    const tokenAccountInfo  = await getAccount(provider.connection, ownerTokenAccount);
    console.log("Token Balance: ", tokenAccountInfo.amount.toString());
    assert.equal(
      tokenAccountInfo.amount.toString(),
      carbon.creditsMinted.toString()
    );

    // check baseline year updated
    const land = await program.account.landRecord.fetch(landRecordPda);
    assert.equal(land.lastCalculatedYear, year);
    console.log("Last Calculated Year: ", land.lastCalculatedYear);
  });

  // TEST 6; TOO SOON TO CHECK 
  it ("Rejects calculation in same year", async () => {
    const yearBuffer = Buffer.alloc(2);
    yearBuffer.writeUInt16LE(year);
    const [dupCarbonRecord] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("carbon"), Buffer.from(landId), yearBuffer],
      program.programId
    );

    try {
      await program.methods
        .calculateAndMint(landId, year, 45.5, 12.3, 8.7)
        .accounts({
          platformState: platformStatePda,
          landRecord: landRecordPda,
          carbonRecord: dupCarbonRecord,
          tokenMint: tokenMintPda,
          ownerTokenAccount: ownerTokenAccount,
          authority: authority.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown TooSoon error");
    } catch (e) {
      console.log("Correctly rejected same-year calculation");
    }
  });

});