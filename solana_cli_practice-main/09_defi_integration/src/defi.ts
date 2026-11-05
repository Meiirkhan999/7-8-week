/**
 * DeFi building blocks used by the Tip Jar:
 *   - Pyth oracle: read the SOL/USD PriceUpdateV2 account written by the Pyth Solana Receiver program
 *   - Jupiter aggregator: quote SOL → USDC through real AMMs (Raydium, Orca, Meteora, ...)
 *   - Conversion: USD amount → lamports with a cross-source sanity check (oracle vs market quote)
 */
import { Connection, PublicKey } from "@solana/web3.js";

// --- Constants (mainnet) ---------------------------------------------------------------------
export const PYTH_RECEIVER_PROGRAM = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/** Sponsored SOL/USD push-oracle account (shard 0), continuously updated by Pyth. */
export const PYTH_SOL_USD_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
export const PYTH_SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
export const LAMPORTS_PER_SOL = 1_000_000_000n;

// --- Pyth -------------------------------------------------------------------------------------
export interface PythPrice {
  feedId: string;
  price: bigint; // integer mantissa
  conf: bigint; // confidence interval, same exponent
  exponent: number; // e.g. -8
  publishTime: number; // unix seconds
  verification: "Full" | "Partial";
  usd: number; // price * 10^exponent, for display only
}

/**
 * Decode an Anchor `PriceUpdateV2` account (pyth-solana-receiver-sdk):
 *   [8] discriminator | [32] write_authority | VerificationLevel (Partial{u8}=2 bytes | Full=1 byte)
 *   PriceFeedMessage { [32] feed_id, i64 price, u64 conf, i32 exponent, i64 publish_time, ... } | u64 posted_slot
 */
export function decodePriceUpdateV2(data: Buffer): PythPrice {
  let o = 8 + 32;
  const tag = data[o];
  if (tag !== 0 && tag !== 1) throw new Error(`Unknown verification level tag ${tag}`);
  o += tag === 0 ? 2 : 1;
  const feedId = data.subarray(o, o + 32).toString("hex");
  o += 32;
  const price = data.readBigInt64LE(o);
  o += 8;
  const conf = data.readBigUInt64LE(o);
  o += 8;
  const exponent = data.readInt32LE(o);
  o += 4;
  const publishTime = Number(data.readBigInt64LE(o));
  return {
    feedId,
    price,
    conf,
    exponent,
    publishTime,
    verification: tag === 1 ? "Full" : "Partial",
    usd: Number(price) * 10 ** exponent,
  };
}

export interface PriceChecks {
  maxAgeSeconds: number;
  maxConfidenceRatio: number; // conf / price, e.g. 0.01 = 1%
  nowSeconds?: number;
}

/** Oracle hygiene: right feed, fully verified, fresh, and a tight confidence interval. */
export function validatePythPrice(p: PythPrice, expectedFeedId: string, checks: PriceChecks): void {
  const now = checks.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (p.feedId !== expectedFeedId) throw new Error(`Wrong feed: ${p.feedId}`);
  if (p.verification !== "Full") throw new Error("Price update is only partially verified");
  if (p.price <= 0n) throw new Error("Non-positive price");
  if (now - p.publishTime > checks.maxAgeSeconds) throw new Error(`Stale price: ${now - p.publishTime}s old`);
  const ratio = Number(p.conf) / Number(p.price);
  if (ratio > checks.maxConfidenceRatio) throw new Error(`Confidence too wide: ${(ratio * 100).toFixed(3)}%`);
}

export async function fetchPythSolUsd(mainnet: Connection, checks: PriceChecks): Promise<PythPrice> {
  const info = await mainnet.getAccountInfo(PYTH_SOL_USD_ACCOUNT);
  if (!info) throw new Error("Pyth SOL/USD account not found");
  if (!info.owner.equals(PYTH_RECEIVER_PROGRAM)) throw new Error(`Unexpected owner ${info.owner.toBase58()}`);
  const p = decodePriceUpdateV2(info.data);
  validatePythPrice(p, PYTH_SOL_USD_FEED_ID, checks);
  return p;
}

// --- Jupiter ----------------------------------------------------------------------------------
export interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: { percent: number; swapInfo: { label: string; ammKey: string } }[];
}

export async function fetchJupiterQuote(inputMint: string, outputMint: string, amount: bigint, slippageBps = 50): Promise<JupiterQuote> {
  const url = `${JUPITER_QUOTE_URL}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jupiter quote HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as JupiterQuote;
}

/** USD per SOL implied by a SOL→USDC quote (USDC has 6 decimals). */
export function impliedUsdPerSol(q: JupiterQuote): number {
  return Number(q.outAmount) / 1e6 / (Number(q.inAmount) / 1e9);
}

export function routeLabels(q: JupiterQuote): string[] {
  return q.routePlan.map((r) => `${r.swapInfo.label} (${r.percent}%)`);
}

// --- Conversion ----------------------------------------------------------------------------------
/**
 * USD → lamports in integer math: lamports = usdCents * 10^9 * 10^-exp / (price * 100).
 * Rounds down so the tipper never pays more than the quoted USD amount.
 */
export function usdToLamports(usd: number, p: Pick<PythPrice, "price" | "exponent">): bigint {
  if (!(usd > 0)) throw new Error("USD amount must be positive");
  const cents = BigInt(Math.round(usd * 100));
  const scale = 10n ** BigInt(-p.exponent);
  return (cents * LAMPORTS_PER_SOL * scale) / (p.price * 100n);
}

/** Relative deviation |a-b| / b. */
export function deviation(a: number, b: number): number {
  return Math.abs(a - b) / b;
}

/** Upper bound for the transfer: amount + slippage tolerance, used as a client-side guard. */
export function maxLamportsWithSlippage(lamports: bigint, slippageBps: number): bigint {
  return (lamports * BigInt(10_000 + slippageBps)) / 10_000n;
}
