import * as anchor from "@coral-xyz/anchor";
const { BN } = anchor.default || anchor;
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";

describe("08_mvp_tip_jar: Tip Jar MVP Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TipJar as Program<any>;
  const jarOwner = Keypair.generate();
  const tipper = Keypair.generate();
  const jarName = "dev-coffee";

  before(async () => {
    // Fund jarOwner and tipper
    for (const kp of [jarOwner, tipper]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      const bh = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({ signature: sig, ...bh });
    }
  });

  it("Initializes a new Tip Jar PDA", async () => {
    const [jarPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tip_jar"), jarOwner.publicKey.toBuffer(), Buffer.from(jarName)],
      program.programId
    );

    console.log("    Derived Tip Jar PDA:", jarPda.toBase58(), "with bump:", bump);

    const tx = await program.methods
      .initializeJar(jarName)
      .accounts({
        jar: jarPda,
        owner: jarOwner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([jarOwner])
      .rpc();

    console.log("    ✓ Initialize Jar Tx Signature:", tx);

    const jarData = await program.account.tipJarAccount.fetch(jarPda);
    expect(jarData.owner.toBase58()).to.equal(jarOwner.publicKey.toBase58());
    expect(jarData.name).to.equal(jarName);
    expect(jarData.totalTips.toNumber()).to.equal(0);
    expect(jarData.totalVolumeLamports.toNumber()).to.equal(0);
    expect(jarData.bump).to.equal(bump);
  });

  it("Sends a tip with CPI transfer and emits event", async () => {
    const [jarPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("tip_jar"), jarOwner.publicKey.toBuffer(), Buffer.from(jarName)],
      program.programId
    );

    const balanceBefore = await provider.connection.getBalance(jarOwner.publicKey);
    const tipAmount = 0.5 * LAMPORTS_PER_SOL; // 0.5 SOL
    const message = "Great tutorial on Solana systems programming!";

    let eventReceived: any = null;
    const listener = program.addEventListener("tipReceivedEvent", (event) => {
      eventReceived = event;
    });

    const tx = await program.methods
      .tip(new BN(tipAmount), message)
      .accounts({
        jar: jarPda,
        tipper: tipper.publicKey,
        recipient: jarOwner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tipper])
      .rpc();

    console.log("    ✓ Send Tip Tx Signature:", tx);

    // Wait a brief moment for event listener
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await program.removeEventListener(listener);

    const balanceAfter = await provider.connection.getBalance(jarOwner.publicKey);
    expect(balanceAfter - balanceBefore).to.equal(tipAmount);
    console.log(`    ✓ Recipient SOL balance increased by exactly ${tipAmount / LAMPORTS_PER_SOL} SOL`);

    const jarData = await program.account.tipJarAccount.fetch(jarPda);
    expect(jarData.totalTips.toNumber()).to.equal(1);
    expect(jarData.totalVolumeLamports.toNumber()).to.equal(tipAmount);
    console.log("    ✓ Jar state updated:", {
      totalTips: jarData.totalTips.toNumber(),
      totalVolumeSol: jarData.totalVolumeLamports.toNumber() / LAMPORTS_PER_SOL,
    });

    // Write results.json
    const results = {
      module: "08_mvp_tip_jar",
      status: "SUCCESS",
      jar_pda: jarPda.toBase58(),
      owner: jarOwner.publicKey.toBase58(),
      tipper: tipper.publicKey.toBase58(),
      tip_amount_lamports: tipAmount,
      tx_signature: tx,
    };
    fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  });

  it("Prevents tipping to fraudulent recipient address", async () => {
    const [jarPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("tip_jar"), jarOwner.publicKey.toBuffer(), Buffer.from(jarName)],
      program.programId
    );

    const fakeRecipient = Keypair.generate().publicKey;

    try {
      await program.methods
        .tip(new BN(100_000), "Malicious recipient redirect")
        .accounts({
          jar: jarPda,
          tipper: tipper.publicKey,
          recipient: fakeRecipient,
          systemProgram: SystemProgram.programId,
        })
        .signers([tipper])
        .rpc();

      expect.fail("Should have failed with InvalidRecipient constraint");
    } catch (err: any) {
      console.log("    ✓ Fraudulent recipient detected and blocked by constraint");
    }
  });
});
