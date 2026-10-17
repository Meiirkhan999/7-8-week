import * as anchor from "@coral-xyz/anchor";
const { BN } = anchor.default || anchor;
import { Program } from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";

describe("05_anchor_counter: Counter Program Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Counter as Program<any>;
  const counterKeypair = Keypair.generate();
  const unauthorizedUser = Keypair.generate();

  it("Initializes the counter account with initial count = 10", async () => {
    const tx = await program.methods
      .initialize(new BN(10))
      .accounts({
        counter: counterKeypair.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([counterKeypair])
      .rpc();

    console.log("    ✓ Initialize Tx Signature:", tx);

    const account = await program.account.counter.fetch(counterKeypair.publicKey);
    expect(account.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(account.count.toNumber()).to.equal(10);
    console.log("    ✓ Counter initial state verified: count =", account.count.toNumber());
  });

  it("Increments the counter by 5", async () => {
    const tx = await program.methods
      .increment(new BN(5))
      .accounts({
        counter: counterKeypair.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    console.log("    ✓ Increment Tx Signature:", tx);

    const account = await program.account.counter.fetch(counterKeypair.publicKey);
    expect(account.count.toNumber()).to.equal(15);
    console.log("    ✓ Counter updated count verified: count =", account.count.toNumber());
  });

  it("Prevents unauthorized increment from non-authority signer", async () => {
    // Airdrop lamports to unauthorized user for tx fee
    const sig = await provider.connection.requestAirdrop(
      unauthorizedUser.publicKey,
      1_000_000_000
    );
    const blockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature: sig, ...blockhash });

    try {
      await program.methods
        .increment(new BN(1))
        .accounts({
          counter: counterKeypair.publicKey,
          authority: unauthorizedUser.publicKey,
        })
        .signers([unauthorizedUser])
        .rpc();

      expect.fail("Should have failed with Unauthorized error");
    } catch (err: any) {
      console.log("    ✓ Successfully blocked unauthorized caller:", err.message || err);
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("Resets the counter back to 0", async () => {
    const tx = await program.methods
      .reset()
      .accounts({
        counter: counterKeypair.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    console.log("    ✓ Reset Tx Signature:", tx);

    const account = await program.account.counter.fetch(counterKeypair.publicKey);
    expect(account.count.toNumber()).to.equal(0);
    console.log("    ✓ Counter reset state verified: count =", account.count.toNumber());

    // Write results.json
    const results = {
      module: "05_anchor_counter",
      status: "SUCCESS",
      counter_pubkey: counterKeypair.publicKey.toBase58(),
      authority: provider.wallet.publicKey.toBase58(),
      final_count: account.count.toNumber(),
    };
    fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  });
});
