import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import * as fs from "fs";

const TIP_JAR_IDL = JSON.parse(fs.readFileSync("../08_mvp_tip_jar/target/idl/tip_jar.json", "utf-8"));

describe("11_cpi_composable: tip_rewards composes tip_jar + System + ATA + SPL Token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.TipRewards as Program<any>;
  const tipJar = new Program(TIP_JAR_IDL, provider) as Program<any>;

  const creator = Keypair.generate();
  const tipper = Keypair.generate();
  const jarName = "cpi-rewards";

  const pda = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], program.programId)[0];
  const config = pda("config");
  const rewardMint = pda("reward_mint");
  const mintAuthority = pda("mint_authority");
  const [jar] = PublicKey.findProgramAddressSync(
    [Buffer.from("tip_jar"), creator.publicKey.toBuffer(), Buffer.from(jarName)],
    tipJar.programId
  );
  const tipperAta = getAssociatedTokenAddressSync(rewardMint, tipper.publicKey, true);

  const tipAccounts = (overrides: Record<string, PublicKey> = {}) => ({
    config,
    jar,
    recipient: creator.publicKey,
    tipper: tipper.publicKey,
    rewardMint,
    mintAuthority,
    tipperRewardAccount: tipperAta,
    tipJarProgram: tipJar.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    ...overrides,
  });

  let firstTipSig = "";

  before(async () => {
    for (const kp of [creator, tipper]) {
      const sig = await connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      const bh = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...bh });
    }
    // The jar is created directly through the module 08 program (already deployed via [[test.genesis]]).
    await tipJar.methods
      .initializeJar(jarName)
      .accounts({ jar, owner: creator.publicKey, systemProgram: SystemProgram.programId })
      .signers([creator])
      .rpc();
  });

  it("initializes the reward mint with a PDA mint authority", async () => {
    await program.methods
      .initRewards()
      .accounts({
        config,
        rewardMint,
        mintAuthority,
        admin: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const mint = await getMint(connection, rewardMint);
    expect(mint.decimals).to.equal(6);
    expect(mint.mintAuthority!.toBase58()).to.equal(mintAuthority.toBase58());
    expect(Number(mint.supply)).to.equal(0);
    const cfg = await program.account.rewardsConfig.fetch(config);
    expect(cfg.rewardMint.toBase58()).to.equal(rewardMint.toBase58());
  });

  it("tip_with_reward: CPI into tip_jar moves SOL, creates the ATA and mints rewards", async () => {
    const amount = 0.5 * LAMPORTS_PER_SOL;
    const before = await connection.getBalance(creator.publicKey);

    firstTipSig = await program.methods
      .tipWithReward(new anchor.BN(amount), "composed via CPI")
      .accounts(tipAccounts())
      .signers([tipper])
      .rpc();

    expect((await connection.getBalance(creator.publicKey)) - before).to.equal(amount);
    const jarState = await tipJar.account.tipJarAccount.fetch(jar);
    expect(jarState.totalTips.toNumber()).to.equal(1);
    expect(jarState.totalVolumeLamports.toNumber()).to.equal(amount);
    const ata = await getAccount(connection, tipperAta);
    expect(Number(ata.amount)).to.equal(50_000_000); // 0.5 SOL × 100 tokens/SOL × 10^6

    // Prove the composition: every program shows up in the invocation logs at the expected depth.
    let tx = null;
    for (let i = 0; i < 20 && !tx; i++) {
      tx = await connection.getTransaction(firstTipSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) await new Promise((r) => setTimeout(r, 250)); // .rpc() returns at "processed"
    }
    const logs = tx!.meta!.logMessages!.join("\n");
    expect(logs).to.include(`Program ${program.programId.toBase58()} invoke [1]`);
    expect(logs).to.include(`Program ${tipJar.programId.toBase58()} invoke [2]`);
    expect(logs).to.include(`Program 11111111111111111111111111111111 invoke [3]`); // nested: tip_jar → System
    expect(logs).to.include(`Program ${ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()} invoke [2]`);
    expect(logs).to.include(`Program ${TOKEN_PROGRAM_ID.toBase58()} invoke [2]`);
    console.log("    ✓ CPI tree verified: tip_rewards → {tip_jar → System, ATA → System/Token, Token}");
  });

  it("second tip reuses the existing ATA (init_if_needed) and accumulates rewards", async () => {
    await program.methods
      .tipWithReward(new anchor.BN(0.25 * LAMPORTS_PER_SOL), "again")
      .accounts(tipAccounts())
      .signers([tipper])
      .rpc();
    expect(Number((await getAccount(connection, tipperAta)).amount)).to.equal(75_000_000);
    const cfg = await program.account.rewardsConfig.fetch(config);
    expect(cfg.totalTipsRouted.toNumber()).to.equal(2);
    expect(cfg.totalRewardsMinted.toNumber()).to.equal(75_000_000);
  });

  it("rejects a recipient that is not the jar owner", async () => {
    const thief = Keypair.generate().publicKey;
    try {
      await program.methods
        .tipWithReward(new anchor.BN(LAMPORTS_PER_SOL / 10), "redirect")
        .accounts(tipAccounts({ recipient: thief }))
        .signers([tipper])
        .rpc();
      expect.fail("should have failed");
    } catch (e: any) {
      expect(e.error?.errorCode?.code).to.equal("InvalidRecipient");
    }
  });

  it("rejects a fake jar not owned by the tip_jar program", async () => {
    try {
      await program.methods
        .tipWithReward(new anchor.BN(LAMPORTS_PER_SOL / 10), "fake jar")
        .accounts(tipAccounts({ jar: config })) // an account owned by tip_rewards, not tip_jar
        .signers([tipper])
        .rpc();
      expect.fail("should have failed");
    } catch (e: any) {
      expect(e.error?.errorCode?.code).to.be.oneOf(["AccountOwnedByWrongProgram", "AccountDiscriminatorMismatch"]);
    }
  });

  it("rejects dust tips that would mint zero rewards", async () => {
    try {
      await program.methods.tipWithReward(new anchor.BN(9), "dust").accounts(tipAccounts()).signers([tipper]).rpc();
      expect.fail("should have failed");
    } catch (e: any) {
      expect(e.error?.errorCode?.code).to.equal("TipTooSmall");
    }
  });

  it("nobody can mint rewards directly — only the program's PDA can sign", async () => {
    try {
      await mintTo(connection, tipper, rewardMint, tipperAta, tipper, 1_000_000_000);
      expect.fail("should have failed");
    } catch (e: any) {
      expect(String(e)).to.match(/owner does not match|0x4/i);
    }

    const supply = Number((await getMint(connection, rewardMint)).supply);
    expect(supply).to.equal(75_000_000);

    fs.writeFileSync(
      "results.json",
      JSON.stringify(
        {
          module: "11_cpi_composable",
          status: "SUCCESS",
          program_id: program.programId.toBase58(),
          composed_programs: {
            tip_jar: tipJar.programId.toBase58(),
            system: SystemProgram.programId.toBase58(),
            associated_token: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
            spl_token: TOKEN_PROGRAM_ID.toBase58(),
          },
          reward_mint: rewardMint.toBase58(),
          jar_pda: jar.toBase58(),
          tipper: tipper.publicKey.toBase58(),
          rewards_minted_units: supply,
          first_tip_tx_signature: firstTipSig,
        },
        null,
        2
      )
    );
  });
});
