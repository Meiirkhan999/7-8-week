/**
 * Dashboard data layer: RPC calls + pure aggregation functions (unit-tested in solana.test.ts).
 */
import { Connection, PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const CLUSTERS: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export function explorerUrl(kind: "tx" | "address", value: string, cluster: string, rpcUrl: string): string {
  const base = `https://explorer.solana.com/${kind}/${value}`;
  if (cluster === "mainnet-beta") return base;
  if (cluster === "devnet") return `${base}?cluster=devnet`;
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
}

// ---------- Tokens ----------
export interface TokenHolding {
  mint: string;
  account: string;
  amount: number;
  decimals: number;
  program: "SPL Token" | "Token-2022";
}

/** Normalize `getParsedTokenAccountsByOwner` results; drops empty accounts, biggest first. */
export function toHoldings(
  accounts: { pubkey: { toBase58(): string } | string; account: { data: any } }[],
  program: TokenHolding["program"]
): TokenHolding[] {
  return accounts
    .map(({ pubkey, account }) => {
      const info = account.data?.parsed?.info;
      return {
        mint: info?.mint as string,
        account: typeof pubkey === "string" ? pubkey : pubkey.toBase58(),
        amount: Number(info?.tokenAmount?.uiAmountString ?? 0),
        decimals: Number(info?.tokenAmount?.decimals ?? 0),
        program,
      };
    })
    .filter((h) => h.mint && h.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

// ---------- Transactions / activity ----------
export interface ActivityBucket {
  start: number; // unix seconds
  ok: number;
  failed: number;
}

/**
 * Group signatures into fixed time buckets (e.g. 1h). Empty buckets between the first and last
 * activity are kept so gaps are visible on the chart instead of being silently collapsed.
 */
export function bucketSignatures(
  sigs: Pick<ConfirmedSignatureInfo, "blockTime" | "err">[],
  bucketSeconds: number
): ActivityBucket[] {
  const timed = sigs.filter((s) => typeof s.blockTime === "number") as { blockTime: number; err: unknown }[];
  if (timed.length === 0) return [];
  const floor = (t: number) => Math.floor(t / bucketSeconds) * bucketSeconds;
  const min = floor(Math.min(...timed.map((s) => s.blockTime)));
  const max = floor(Math.max(...timed.map((s) => s.blockTime)));
  const buckets = new Map<number, ActivityBucket>();
  for (let t = min; t <= max; t += bucketSeconds) buckets.set(t, { start: t, ok: 0, failed: 0 });
  for (const s of timed) {
    const b = buckets.get(floor(s.blockTime))!;
    if (s.err) b.failed++;
    else b.ok++;
  }
  return [...buckets.values()];
}

/** Choose a bucket size giving roughly 12–48 bars for the observed time span. */
export function pickBucketSeconds(sigs: Pick<ConfirmedSignatureInfo, "blockTime">[]): number {
  const times = sigs.map((s) => s.blockTime).filter((t): t is number => typeof t === "number");
  if (times.length < 2) return 3600;
  const span = Math.max(...times) - Math.min(...times);
  const options = [60, 300, 900, 3600, 6 * 3600, 86400, 7 * 86400];
  return options.find((o) => span / o <= 48) ?? options[options.length - 1];
}

export function successRate(sigs: Pick<ConfirmedSignatureInfo, "err">[]): number {
  if (sigs.length === 0) return 0;
  return sigs.filter((s) => !s.err).length / sigs.length;
}

export function formatBucketLabel(start: number, bucketSeconds: number): string {
  const d = new Date(start * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (bucketSeconds >= 86400) return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const shorten = (s: string, n = 4) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

// ---------- RPC ----------
export interface WalletOverview {
  address: string;
  lamports: number;
  executable: boolean;
  owner: string | null;
  holdings: TokenHolding[];
  signatures: ConfirmedSignatureInfo[];
}

export async function fetchWalletOverview(connection: Connection, address: PublicKey, limit = 50): Promise<WalletOverview> {
  const [info, spl, t22, signatures] = await Promise.all([
    connection.getAccountInfo(address),
    connection.getParsedTokenAccountsByOwner(address, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(address, { programId: TOKEN_2022_PROGRAM_ID }),
    connection.getSignaturesForAddress(address, { limit }),
  ]);
  return {
    address: address.toBase58(),
    lamports: info?.lamports ?? 0,
    executable: info?.executable ?? false,
    owner: info?.owner.toBase58() ?? null,
    holdings: [...toHoldings(spl.value, "SPL Token"), ...toHoldings(t22.value, "Token-2022")],
    signatures,
  };
}

export async function fetchProgramActivity(connection: Connection, programId: PublicKey, limit = 200) {
  return connection.getSignaturesForAddress(programId, { limit });
}
