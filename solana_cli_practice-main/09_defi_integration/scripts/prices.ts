/**
 * Read-only market snapshot: Pyth oracle vs Jupiter routes, and how price impact grows with size.
 *   npx tsx scripts/prices.ts
 */
import { Connection, clusterApiUrl } from "@solana/web3.js";
import {
  USDC_MINT,
  WSOL_MINT,
  deviation,
  fetchJupiterQuote,
  fetchPythSolUsd,
  impliedUsdPerSol,
  routeLabels,
} from "../src/defi";

async function main() {
  const mainnet = new Connection(process.env.MAINNET_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");

  const pyth = await fetchPythSolUsd(mainnet, { maxAgeSeconds: 120, maxConfidenceRatio: 0.01 });
  console.log("Pyth SOL/USD (on-chain PriceUpdateV2)");
  console.log(`  price  $${pyth.usd.toFixed(4)}  ± $${(Number(pyth.conf) * 10 ** pyth.exponent).toFixed(4)}`);
  console.log(`  age    ${Math.floor(Date.now() / 1000) - pyth.publishTime}s, verification: ${pyth.verification}`);

  console.log("\nJupiter SOL → USDC quotes");
  for (const sol of [1n, 100n, 10_000n]) {
    const q = await fetchJupiterQuote(WSOL_MINT, USDC_MINT, sol * 1_000_000_000n);
    const px = impliedUsdPerSol(q);
    console.log(
      `  ${sol.toString().padStart(6)} SOL → $${(Number(q.outAmount) / 1e6).toFixed(2).padStart(12)}` +
        `  ($${px.toFixed(4)}/SOL, Δ vs Pyth ${(deviation(px, pyth.usd) * 100).toFixed(3)}%, impact ${(Number(q.priceImpactPct) * 100).toFixed(3)}%)` +
        `  via ${routeLabels(q).join(" → ")}`
    );
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
