/**
 * Minimal Solana Pay "transfer request" implementation (spec: docs.solanapay.com/spec).
 *
 *   solana:<recipient>?amount=<decimal>&spl-token=<mint>&reference=<pubkey>&label=..&message=..&memo=..
 *
 * The `reference` is a random public key added (read-only, non-signer) to the payment instruction.
 * It makes the payment discoverable with getSignaturesForAddress(reference) without any backend,
 * and links an on-chain payment to exactly one invoice.
 */
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";

export interface TransferRequest {
  recipient: PublicKey;
  amount: string; // decimal string in token units, e.g. "250.5" (never a float)
  splToken?: PublicKey;
  reference?: PublicKey[];
  label?: string;
  message?: string;
  memo?: string;
}

const DECIMAL = /^\d+(\.\d+)?$/;

export function encodeTransferRequest(r: TransferRequest): string {
  if (!DECIMAL.test(r.amount)) throw new Error(`Invalid amount "${r.amount}"`);
  const params = new URLSearchParams();
  params.append("amount", r.amount);
  if (r.splToken) params.append("spl-token", r.splToken.toBase58());
  for (const ref of r.reference ?? []) params.append("reference", ref.toBase58());
  if (r.label) params.append("label", r.label);
  if (r.message) params.append("message", r.message);
  if (r.memo) params.append("memo", r.memo);
  // URLSearchParams encodes spaces as '+'; the spec expects percent-encoding.
  return `solana:${r.recipient.toBase58()}?${params.toString().replace(/\+/g, "%20")}`;
}

export function parseTransferRequest(url: string): TransferRequest {
  if (!url.startsWith("solana:")) throw new Error("Not a solana: URL");
  const [path, query = ""] = url.slice("solana:".length).split("?");
  const params = new URLSearchParams(query);
  const amount = params.get("amount") ?? "";
  if (!DECIMAL.test(amount)) throw new Error(`Invalid amount "${amount}"`);
  return {
    recipient: new PublicKey(decodeURIComponent(path)),
    amount,
    splToken: params.get("spl-token") ? new PublicKey(params.get("spl-token")!) : undefined,
    reference: params.getAll("reference").map((r) => new PublicKey(r)),
    label: params.get("label") ?? undefined,
    message: params.get("message") ?? undefined,
    memo: params.get("memo") ?? undefined,
  };
}

/** Decimal string → integer base units, exact (no floating point). */
export function toBaseUnits(amount: string, decimals: number): bigint {
  if (!DECIMAL.test(amount)) throw new Error(`Invalid amount "${amount}"`);
  const [whole, frac = ""] = amount.split(".");
  if (frac.length > decimals) throw new Error(`Too many decimals: ${amount} (max ${decimals})`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export interface PaymentCheck {
  ok: boolean;
  received: bigint;
  reasons: string[];
}

/**
 * Merchant-side verification of a found transaction: it must have succeeded, include the reference
 * key, use the expected mint, and credit the recipient's token account with exactly the invoiced amount.
 */
export function validateTokenPayment(
  tx: ParsedTransactionWithMeta,
  req: TransferRequest,
  recipientTokenAccount: PublicKey,
  decimals: number
): PaymentCheck {
  const reasons: string[] = [];
  if (!tx.meta) return { ok: false, received: 0n, reasons: ["missing meta"] };
  if (tx.meta.err) reasons.push(`transaction failed: ${JSON.stringify(tx.meta.err)}`);

  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  for (const ref of req.reference ?? []) if (!keys.includes(ref.toBase58())) reasons.push(`reference ${ref.toBase58()} not in tx`);

  const idx = keys.indexOf(recipientTokenAccount.toBase58());
  const find = (arr: typeof tx.meta.preTokenBalances) => arr?.find((b) => b.accountIndex === idx);
  const pre = find(tx.meta.preTokenBalances);
  const post = find(tx.meta.postTokenBalances);
  if (idx < 0 || !post) reasons.push("recipient token account not credited");
  if (req.splToken && post && post.mint !== req.splToken.toBase58()) reasons.push(`wrong mint ${post.mint}`);

  const received = BigInt(post?.uiTokenAmount.amount ?? "0") - BigInt(pre?.uiTokenAmount.amount ?? "0");
  const expected = toBaseUnits(req.amount, decimals);
  if (received !== expected) reasons.push(`amount mismatch: received ${received}, expected ${expected}`);
  return { ok: reasons.length === 0, received, reasons };
}
