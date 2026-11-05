/**
 * Week 13 — RWA, stablecoins & payments: prototype of the product in PRODUCT_DESIGN.md.
 *
 *  1. Issue "tUSD": a permissioned Token-2022 stablecoin with extensions
 *       - MetadataPointer + TokenMetadata  (name/symbol/uri + issuer, jurisdiction, reserve attestation)
 *       - DefaultAccountState = Frozen     (every new account is frozen until KYC passes)
 *       - PermanentDelegate                (court-order / sanctions clawback by the issuer)
 *  2. KYC: issuer thaws the merchant's and the payer's accounts
 *  3. Mint tUSD to the payer (fiat on-ramp)
 *  4. Merchant issues an invoice as a Solana Pay transfer-request URL with a unique reference key
 *  5. Payer pays it (transferChecked + reference + memo); merchant finds and validates the payment
 *  6. Compliance: transfer to a non-KYC account fails; issuer claws back funds via the permanent delegate
 *
 *   solana-test-validator --reset --quiet     # terminal 1   (or SOLANA_RPC_URL=https://api.devnet.solana.com)
 *   npx tsx scripts/stablecoin.ts             # terminal 2
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AccountState,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  burnChecked,
  createAssociatedTokenAccountIdempotent,
  createInitializeDefaultAccountStateInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getMintLen,
  getTokenMetadata,
  mintTo,
  thawAccount,
} from "@solana/spl-token";
import { createInitializeInstruction, createUpdateFieldInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { encodeTransferRequest, parseTransferRequest, toBaseUnits, validateTokenPayment } from "../src/solana_pay";

const DECIMALS = 6;
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const fmt = (units: bigint) => (Number(units) / 10 ** DECIMALS).toLocaleString("en-US", { minimumFractionDigits: 2 });

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
  console.log("============================================================");
  console.log("  MODULE 13: Permissioned stablecoin + Solana Pay invoicing");
  console.log("============================================================");
  const endpoint = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
  const connection = new Connection(endpoint, "confirmed");

  const issuer = loadWallet(); // regulated issuer: mint, freeze (KYC) and permanent-delegate authority
  const merchant = Keypair.generate(); // e.g. a freelancer invoicing a foreign client
  const payer = Keypair.generate(); // the client paying the invoice
  const outsider = Keypair.generate(); // a wallet that never passed KYC
  if ((await connection.getBalance(issuer.publicKey)) < LAMPORTS_PER_SOL) await airdrop(connection, issuer.publicKey, 5);
  for (const kp of [merchant, payer, outsider]) {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: kp.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })),
      [issuer]
    );
  }
  console.log(`[0] RPC ${endpoint}\n    issuer ${issuer.publicKey.toBase58()}\n    merchant ${merchant.publicKey.toBase58()}\n    payer ${payer.publicKey.toBase58()}`);

  // ---- 1. Issue the stablecoin -------------------------------------------------------------
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const metadata: TokenMetadata = {
    mint,
    name: "Test USD (Week 13)",
    symbol: "tUSD",
    uri: "https://example.com/tusd.json",
    additionalMetadata: [
      ["issuer", "Demo Payments Ltd (sandbox)"],
      ["jurisdiction", "sandbox / not a real license"],
      ["reserve_attestation", "monthly, independent auditor (simulated)"],
    ],
  };
  const extensions = [ExtensionType.MetadataPointer, ExtensionType.DefaultAccountState, ExtensionType.PermanentDelegate];
  const mintLen = getMintLen(extensions);
  const metadataLen = 2 + 2 + pack(metadata).length; // TYPE_SIZE + LENGTH_SIZE + data
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: issuer.publicKey, newAccountPubkey: mint, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint, issuer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    createInitializeDefaultAccountStateInstruction(mint, AccountState.Frozen, TOKEN_2022_PROGRAM_ID),
    createInitializePermanentDelegateInstruction(mint, issuer.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint, DECIMALS, issuer.publicKey, issuer.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: issuer.publicKey,
      mint,
      mintAuthority: issuer.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
    ...metadata.additionalMetadata.map(([field, value]) =>
      createUpdateFieldInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: issuer.publicKey, field, value })
    )
  );
  const mintTxSig = await sendAndConfirmTransaction(connection, createMintTx, [issuer, mintKp]);
  const onchainMeta = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(`\n[1] Minted ${onchainMeta?.symbol} (${mint.toBase58()})`);
  console.log(`    extensions: MetadataPointer, TokenMetadata, DefaultAccountState=Frozen, PermanentDelegate`);
  console.log(`    on-chain metadata: ${onchainMeta?.name}; ${onchainMeta?.additionalMetadata.map(([k, v]) => `${k}=${v}`).join("; ")}`);

  // ---- 2. Accounts start frozen; KYC = thaw -------------------------------------------------
  const ata = (owner: Keypair) => createAssociatedTokenAccountIdempotent(connection, issuer, mint, owner.publicKey, { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const merchantAta = await ata(merchant);
  const payerAta = await ata(payer);
  const outsiderAta = await ata(outsider);
  const stateOf = async (a: PublicKey) => ((await getAccount(connection, a, "confirmed", TOKEN_2022_PROGRAM_ID)).isFrozen ? "frozen" : "active");
  console.log(`\n[2] New token accounts: merchant ${await stateOf(merchantAta)}, payer ${await stateOf(payerAta)}, outsider ${await stateOf(outsiderAta)}`);
  for (const a of [merchantAta, payerAta]) await thawAccount(connection, issuer, a, mint, issuer, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  console.log(`    KYC approved (thaw): merchant ${await stateOf(merchantAta)}, payer ${await stateOf(payerAta)}; outsider stays ${await stateOf(outsiderAta)}`);

  // ---- 3. On-ramp: payer buys 1,000 tUSD ------------------------------------------------------
  await mintTo(connection, issuer, mint, payerAta, issuer, toBaseUnits("1000", DECIMALS), [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  console.log(`\n[3] On-ramp: minted 1,000.00 tUSD to the payer`);

  // ---- 4. Invoice as a Solana Pay URL ---------------------------------------------------------
  const reference = Keypair.generate().publicKey;
  const invoiceId = `INV-2026-${Math.floor(Math.random() * 9000 + 1000)}`;
  const invoiceUrl = encodeTransferRequest({
    recipient: merchant.publicKey,
    amount: "250.50",
    splToken: mint,
    reference: [reference],
    label: "Freelance Studio",
    message: "Landing page design, November",
    memo: invoiceId,
  });
  console.log(`\n[4] Invoice ${invoiceId}:\n    ${invoiceUrl}`);

  // ---- 5. Payer's wallet parses the URL and pays -------------------------------------------
  const req = parseTransferRequest(invoiceUrl);
  const amount = toBaseUnits(req.amount, DECIMALS);
  const transferIx = createTransferCheckedInstruction(payerAta, req.splToken!, merchantAta, payer.publicKey, amount, DECIMALS, [], TOKEN_2022_PROGRAM_ID);
  for (const ref of req.reference ?? []) transferIx.keys.push({ pubkey: ref, isSigner: false, isWritable: false });
  const payTx = new Transaction().add(
    new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(req.memo ?? "", "utf-8") }),
    transferIx
  );
  const paySig = await sendAndConfirmTransaction(connection, payTx, [payer], { commitment: "confirmed" });
  console.log(`\n[5] Payer paid ${req.amount} tUSD: ${paySig}`);

  // Merchant side: discover the payment by reference only, then validate it.
  const found = await connection.getSignaturesForAddress(reference, {}, "confirmed");
  if (found.length !== 1) throw new Error(`Expected exactly 1 payment for the reference, found ${found.length}`);
  const parsed = await connection.getParsedTransaction(found[0].signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const check = validateTokenPayment(parsed!, req, merchantAta, DECIMALS);
  if (!check.ok) throw new Error(`Payment invalid: ${check.reasons.join("; ")}`);
  console.log(`    ✓ Merchant found tx by reference and validated: ${fmt(check.received)} tUSD received, invoice ${invoiceId} = PAID`);

  // ---- 6. Compliance controls ----------------------------------------------------------------
  let kycBlockError = "";
  try {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(createTransferCheckedInstruction(payerAta, mint, outsiderAta, payer.publicKey, toBaseUnits("10", DECIMALS), DECIMALS, [], TOKEN_2022_PROGRAM_ID)),
      [payer]
    );
    throw new Error("Transfer to a non-KYC account unexpectedly succeeded");
  } catch (e: any) {
    const logs: string[] = e.logs ?? e.transactionLogs ?? [];
    kycBlockError = logs.find((l) => /frozen/i.test(l)) ?? String(e.message).split("\n")[0];
    if (!/frozen|0x11/i.test(kycBlockError + e.message)) throw e;
    console.log(`\n[6] ✓ Transfer to non-KYC wallet blocked: ${kycBlockError}`);
  }

  // Sanctions / court order: issuer burns 50 tUSD from the payer WITHOUT the payer's signature.
  const before = (await getAccount(connection, payerAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const clawbackSig = await burnChecked(connection, issuer, payerAta, mint, issuer, toBaseUnits("50", DECIMALS), DECIMALS, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const after = (await getAccount(connection, payerAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  console.log(`    ✓ Permanent-delegate clawback: payer ${fmt(before)} → ${fmt(after)} tUSD (${clawbackSig.slice(0, 16)}…)`);

  const merchantBal = (await getAccount(connection, merchantAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const results = {
    module: "13_rwa_payments",
    status: "SUCCESS",
    cluster: endpoint,
    mint: mint.toBase58(),
    symbol: onchainMeta?.symbol,
    extensions: ["MetadataPointer", "TokenMetadata", "DefaultAccountState(Frozen)", "PermanentDelegate"],
    mint_tx_signature: mintTxSig,
    invoice_id: invoiceId,
    invoice_url: invoiceUrl,
    payment_tx_signature: paySig,
    payment_validated: check.ok,
    merchant_balance: fmt(merchantBal),
    kyc_block_error: kycBlockError,
    clawback_tx_signature: clawbackSig,
    payer_balance_after_clawback: fmt(after),
  };
  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  console.log("\n✓ results.json written — MODULE 13 COMPLETED SUCCESSFULLY!");
}

main().catch((e) => {
  console.error("Module 13 Execution Error:", e.message ?? e, e.logs ?? "");
  process.exit(1);
});
