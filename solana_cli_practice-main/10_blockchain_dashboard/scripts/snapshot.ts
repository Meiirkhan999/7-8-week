/**
 * CLI twin of the dashboard: runs the same data layer (src/lib) and writes results.json.
 *   npx tsx scripts/snapshot.ts <wallet> [programId] [rpcUrl]
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import {
  LAMPORTS_PER_SOL,
  bucketSignatures,
  fetchProgramActivity,
  fetchWalletOverview,
  pickBucketSeconds,
  successRate,
} from "../src/lib/solana";
import { TIP_JAR_PROGRAM_ID, fetchRecentEvents } from "../src/lib/events";

async function main() {
  const [walletArg, programArg, rpcArg] = process.argv.slice(2);
  if (!walletArg) throw new Error("usage: snapshot.ts <wallet> [programId] [rpcUrl]");
  const rpc = rpcArg || process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
  const connection = new Connection(rpc, "confirmed");
  const program = new PublicKey(programArg || TIP_JAR_PROGRAM_ID.toBase58());

  const wallet = await fetchWalletOverview(connection, new PublicKey(walletArg));
  const sigs = await fetchProgramActivity(connection, program);
  const bucketSeconds = pickBucketSeconds(sigs);
  const events = program.equals(TIP_JAR_PROGRAM_ID) ? await fetchRecentEvents(connection, sigs.map((s) => s.signature)) : [];

  const results = {
    module: "10_blockchain_dashboard",
    status: "SUCCESS",
    cluster: rpc,
    wallet: {
      address: wallet.address,
      sol: wallet.lamports / LAMPORTS_PER_SOL,
      tokens: wallet.holdings.length,
      recent_txs: wallet.signatures.length,
      success_rate: successRate(wallet.signatures),
    },
    program: {
      id: program.toBase58(),
      recent_txs: sigs.length,
      success_rate: successRate(sigs),
      bucket_seconds: bucketSeconds,
      buckets: bucketSignatures(sigs, bucketSeconds).length,
      decoded_events: events.length,
      last_event: events[0] ?? null,
    },
  };
  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
