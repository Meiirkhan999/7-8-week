/**
 * Week 9 — DeFi integration into the Tip Jar app: "tip $X" instead of "tip N lamports".
 *
 *   1. Price SOL in USD from the Pyth on-chain oracle (mainnet, read-only)
 *   2. Cross-check against a live Jupiter SOL→USDC quote (real AMM liquidity); abort if they disagree
 *   3. Convert USD → lamports with integer math and a slippage ceiling
 *   4. Send the tip through the module 08 tip_jar program (local validator)
 *
 *   npm run validator          # terminal 1: local validator with tip_jar preloaded
 *   npx tsx scripts/tip_usd.ts 5   # terminal 2: tip $5
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  USDC_MINT,
  WSOL_MINT,
  deviation,
  fetchJupiterQuote,
  fetchPythSolUsd,
  impliedUsdPerSol,
  maxLamportsWithSlippage,
  routeLabels,
  usdToLamports,
} from "../src/defi";

const MAX_ORACLE_VS_MARKET_DEVIATION = 0.02; // 2%
const SLIPPAGE_BPS = 100; // 1% ceiling between quote time and send time
const IDL_PATH = path.join(__dirname, "..", "..", "08_mvp_tip_jar", "target", "idl", "tip_jar.json");

function loadWallet(): Keypair {
  const p = path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function airdrop(connection: Connection, to: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

async function main() {
  const usd = Number(process.argv[2] ?? "5");
  console.log("============================================================");
  console.log(`  MODULE 9: DeFi-powered Tip Jar — tipping $${usd.toFixed(2)}`);
  console.log("============================================================");

  const appRpc = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
  const mainnet = new Connection(process.env.MAINNET_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");
  const connection = new Connection(appRpc, "confirmed");

  // 1. Oracle price
  const pyth = await fetchPythSolUsd(mainnet, { maxAgeSeconds: 120, maxConfidenceRatio: 0.01 });
  console.log(`[1] Pyth SOL/USD: $${pyth.usd.toFixed(4)} (conf ±${((Number(pyth.conf) / Number(pyth.price)) * 100).toFixed(3)}%, ${pyth.verification})`);

  // 2. Market cross-check
  const quote = await fetchJupiterQuote(WSOL_MINT, USDC_MINT, 1_000_000_000n, 50);
  const market = impliedUsdPerSol(quote);
  const dev = deviation(market, pyth.usd);
  console.log(`[2] Jupiter 1 SOL → ${(Number(quote.outAmount) / 1e6).toFixed(4)} USDC via ${routeLabels(quote).join(" → ")}`);
  console.log(`    Oracle vs market deviation: ${(dev * 100).toFixed(3)}% (limit ${MAX_ORACLE_VS_MARKET_DEVIATION * 100}%)`);
  if (dev > MAX_ORACLE_VS_MARKET_DEVIATION) throw new Error("Oracle and market disagree — refusing to price the tip");

  // 3. Conversion with slippage ceiling
  const lamports = usdToLamports(usd, pyth);
  const marketLamports = BigInt(Math.floor((usd / market) * LAMPORTS_PER_SOL));
  const ceiling = maxLamportsWithSlippage(marketLamports, SLIPPAGE_BPS);
  console.log(`[3] $${usd} = ${lamports} lamports (${Number(lamports) / LAMPORTS_PER_SOL} SOL); ceiling ${ceiling}`);
  if (lamports > ceiling) throw new Error("Tip exceeds slippage ceiling");

  // 4. Send through the Tip Jar program
  const tipper = loadWallet();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(tipper), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl, provider);
  // JSON IDL has no generated TS types; use the dynamic builder to avoid TS2589 deep instantiation.
  const methods: any = program.methods;
  if (!(await connection.getAccountInfo(program.programId))) {
    throw new Error(`tip_jar program ${program.programId.toBase58()} is not deployed on ${appRpc}. Run "npm run validator" first.`);
  }

  if ((await connection.getBalance(tipper.publicKey)) < 2 * LAMPORTS_PER_SOL) await airdrop(connection, tipper.publicKey, 10);
  const creator = Keypair.generate();
  await airdrop(connection, creator.publicKey, 1);
  const jarName = "usd-tips";
  const [jar] = PublicKey.findProgramAddressSync(
    [Buffer.from("tip_jar"), creator.publicKey.toBuffer(), Buffer.from(jarName)],
    program.programId
  );
  await methods
    .initializeJar(jarName)
    .accounts({ jar, owner: creator.publicKey, systemProgram: SystemProgram.programId })
    .signers([creator])
    .rpc();
  console.log(`[4] Jar ${jar.toBase58()} created for creator ${creator.publicKey.toBase58()}`);

  const before = await connection.getBalance(creator.publicKey);
  const message = `$${usd.toFixed(2)} tip @ $${pyth.usd.toFixed(2)}/SOL (Pyth)`;
  const sig = await methods
    .tip(new anchor.BN(lamports.toString()), message)
    .accounts({ jar, tipper: tipper.publicKey, recipient: creator.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  const after = await connection.getBalance(creator.publicKey);
  const jarState: any = await (program.account as any).tipJarAccount.fetch(jar);

  const received = BigInt(after - before);
  if (received !== lamports) throw new Error(`Creator received ${received}, expected ${lamports}`);
  if (BigInt(jarState.totalVolumeLamports.toString()) !== lamports) throw new Error("Jar volume mismatch");
  const receivedUsd = (Number(received) / LAMPORTS_PER_SOL) * pyth.usd;
  console.log(`    ✓ Tip tx: ${sig}`);
  console.log(`    ✓ Creator received ${received} lamports ≈ $${receivedUsd.toFixed(4)}; jar volume ${jarState.totalVolumeLamports}`);

  const results = {
    module: "09_defi_integration",
    status: "SUCCESS",
    cluster: appRpc,
    usd_amount: usd,
    pyth_usd_per_sol: +pyth.usd.toFixed(6),
    pyth_publish_time: new Date(pyth.publishTime * 1000).toISOString(),
    jupiter_usd_per_sol: +market.toFixed(6),
    jupiter_route: routeLabels(quote),
    deviation_pct: +(dev * 100).toFixed(4),
    tip_lamports: Number(lamports),
    received_usd: +receivedUsd.toFixed(4),
    jar_pda: jar.toBase58(),
    creator: creator.publicKey.toBase58(),
    tx_signature: sig,
  };
  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  console.log("\n✓ results.json written — MODULE 9 COMPLETED SUCCESSFULLY!");
}

main().catch((e) => {
  console.error("Module 9 Execution Error:", e.message ?? e);
  process.exit(1);
});
