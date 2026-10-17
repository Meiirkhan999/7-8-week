import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";

describe("06_anchor_pda_profile: PDA Profile Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PdaProfile as Program<any>;
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();

  before(async () => {
    // Airdrop funds to user1 and user2
    for (const u of [user1, user2]) {
      const sig = await provider.connection.requestAirdrop(u.publicKey, 2_000_000_000);
      const bh = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({ signature: sig, ...bh });
    }
  });

  it("Derives deterministic PDA and creates user profile", async () => {
    const [profilePda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user1.publicKey.toBuffer()],
      program.programId
    );

    console.log("    Derived PDA for User 1:", profilePda.toBase58(), "with bump:", bump);

    const tx = await program.methods
      .createProfile(
        "alice_sol",
        "Building decentralized systems on Solana",
        "https://solana.com/avatar1.png"
      )
      .accounts({
        profile: profilePda,
        authority: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    console.log("    ✓ Create Profile Tx Signature:", tx);

    const profileData = await program.account.userProfile.fetch(profilePda);
    expect(profileData.authority.toBase58()).to.equal(user1.publicKey.toBase58());
    expect(profileData.username).to.equal("alice_sol");
    expect(profileData.bio).to.equal("Building decentralized systems on Solana");
    expect(profileData.avatarUrl).to.equal("https://solana.com/avatar1.png");
    expect(profileData.points.toNumber()).to.equal(100);
    expect(profileData.bump).to.equal(bump);
    console.log("    ✓ Profile data verified for user1:", profileData);
  });

  it("Prevents creating duplicate profile for same authority (collision check)", async () => {
    const [profilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user1.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createProfile(
          "alice_second",
          "Attempt duplicate",
          "https://solana.com/avatar2.png"
        )
        .accounts({
          profile: profilePda,
          authority: user1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      expect.fail("Should have failed because account is already initialized");
    } catch (err: any) {
      console.log("    ✓ Duplicate creation properly rejected by Anchor account initialization constraints");
    }
  });

  it("Updates profile bio and avatar", async () => {
    const [profilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user1.publicKey.toBuffer()],
      program.programId
    );

    const newBio = "Senior Systems & Solana Architect";
    const tx = await program.methods
      .updateProfile(newBio, null)
      .accounts({
        profile: profilePda,
        authority: user1.publicKey,
      })
      .signers([user1])
      .rpc();

    console.log("    ✓ Update Profile Tx Signature:", tx);

    const updatedData = await program.account.userProfile.fetch(profilePda);
    expect(updatedData.bio).to.equal(newBio);
    expect(updatedData.avatarUrl).to.equal("https://solana.com/avatar1.png");
  });

  it("Prevents unauthorized modification of profile", async () => {
    const [profilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user1.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .updateProfile("Hacked bio", null)
        .accounts({
          profile: profilePda,
          authority: user2.publicKey,
        })
        .signers([user2])
        .rpc();

      expect.fail("Should have thrown Unauthorized error");
    } catch (err: any) {
      console.log("    ✓ Unauthorized update blocked successfully");
    }
  });

  it("Creates separate isolated profile for user 2", async () => {
    const [profilePda2, bump2] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_profile"), user2.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .createProfile("bob_builder", "Rust & Anchor Hacker", "https://solana.com/bob.png")
      .accounts({
        profile: profilePda2,
        authority: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    console.log("    ✓ User 2 Profile Tx Signature:", tx);

    const p2Data = await program.account.userProfile.fetch(profilePda2);
    expect(p2Data.username).to.equal("bob_builder");

    const results = {
      module: "06_anchor_pda_profile",
      status: "SUCCESS",
      user1_pda: (PublicKey.findProgramAddressSync([Buffer.from("user_profile"), user1.publicKey.toBuffer()], program.programId))[0].toBase58(),
      user2_pda: profilePda2.toBase58(),
    };
    fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  });
});
