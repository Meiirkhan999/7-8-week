/**
 * Decode Anchor events ("Program data: <base64>" log lines) emitted by the module 08 tip_jar program.
 */
import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import tipJarIdl from "../idl/tip_jar.json";

export const TIP_JAR_IDL = tipJarIdl as Idl;
export const TIP_JAR_PROGRAM_ID = new PublicKey((tipJarIdl as any).address);

export interface DecodedEvent {
  signature: string;
  blockTime: number | null;
  name: string;
  data: Record<string, string>;
}

/** Stringify BN / PublicKey fields so React and JSON can render them. */
function plain(data: Record<string, any>): Record<string, string> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v?.toBase58 ? v.toBase58() : String(v)]));
}

export function parseEventsFromLogs(programId: PublicKey, idl: Idl, logs: string[]): { name: string; data: Record<string, string> }[] {
  const parser = new EventParser(programId, new BorshCoder(idl));
  return [...parser.parseLogs(logs)].map((e) => ({ name: e.name, data: plain(e.data as any) }));
}

/** Fetch the latest `limit` transactions of the program and decode their events (sequential to respect RPC limits). */
export async function fetchRecentEvents(connection: Connection, signatures: string[], limit = 15): Promise<DecodedEvent[]> {
  const out: DecodedEvent[] = [];
  for (const signature of signatures.slice(0, limit)) {
    const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx?.meta?.logMessages) continue;
    for (const ev of parseEventsFromLogs(TIP_JAR_PROGRAM_ID, TIP_JAR_IDL, tx.meta.logMessages)) {
      out.push({ signature, blockTime: tx.blockTime ?? null, ...ev });
    }
  }
  return out;
}
