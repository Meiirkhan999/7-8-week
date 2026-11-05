import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { encodeTransferRequest, parseTransferRequest, toBaseUnits, validateTokenPayment } from "../src/solana_pay";

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "invoice_payment.json"), "utf-8"));
/** JSON turned PublicKeys into strings; rehydrate the fields the validator reads. */
function loadTx(): any {
  const tx = structuredClone(fixture.tx);
  tx.transaction.message.accountKeys = tx.transaction.message.accountKeys.map((k: any) => ({ ...k, pubkey: new PublicKey(k.pubkey) }));
  return tx;
}

test("encode → parse round-trips and percent-encodes text fields per the spec", () => {
  const recipient = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const refs = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  const url = encodeTransferRequest({ recipient, amount: "0.01", splToken: mint, reference: refs, label: "Café & Co", message: "Order #1", memo: "INV-1" });
  assert.ok(url.startsWith(`solana:${recipient.toBase58()}?amount=0.01&spl-token=${mint.toBase58()}`));
  assert.ok(url.includes("label=Caf%C3%A9%20%26%20Co"), url);
  assert.ok(!url.includes("+"));
  const r = parseTransferRequest(url);
  assert.ok(r.recipient.equals(recipient));
  assert.ok(r.splToken!.equals(mint));
  assert.deepEqual(r.reference!.map((x) => x.toBase58()), refs.map((x) => x.toBase58()));
  assert.equal(r.label, "Café & Co");
  assert.equal(r.memo, "INV-1");
});

test("rejects malformed amounts and non-solana URLs", () => {
  const recipient = Keypair.generate().publicKey;
  for (const amount of ["", "-1", "1e3", "1,5", ".5"]) assert.throws(() => encodeTransferRequest({ recipient, amount }), /Invalid amount/);
  assert.throws(() => parseTransferRequest("https://example.com"), /Not a solana/);
});

test("toBaseUnits is exact (no floating point)", () => {
  assert.equal(toBaseUnits("250.50", 6), 250_500_000n);
  assert.equal(toBaseUnits("0.000001", 6), 1n);
  assert.equal(toBaseUnits("1000", 6), 1_000_000_000n);
  assert.equal(toBaseUnits("0.1", 9) + toBaseUnits("0.2", 9), toBaseUnits("0.3", 9)); // 0.1 + 0.2 === 0.3 here
  assert.throws(() => toBaseUnits("1.0000001", 6), /Too many decimals/);
});

test("validates the real on-chain invoice payment captured from the prototype", () => {
  const req = parseTransferRequest(fixture.invoice_url);
  const check = validateTokenPayment(loadTx(), req, new PublicKey(fixture.merchant_token_account), 6);
  assert.deepEqual(check.reasons, []);
  assert.equal(check.ok, true);
  assert.equal(check.received, 250_500_000n);
});

test("detects underpayment, wrong mint, missing reference and failed transactions", () => {
  const req = parseTransferRequest(fixture.invoice_url);
  const merchantAta = new PublicKey(fixture.merchant_token_account);

  const under = validateTokenPayment(loadTx(), { ...req, amount: "300" }, merchantAta, 6);
  assert.equal(under.ok, false);
  assert.match(under.reasons.join(), /amount mismatch/);

  const wrongMint = validateTokenPayment(loadTx(), { ...req, splToken: Keypair.generate().publicKey }, merchantAta, 6);
  assert.match(wrongMint.reasons.join(), /wrong mint/);

  const otherRef = validateTokenPayment(loadTx(), { ...req, reference: [Keypair.generate().publicKey] }, merchantAta, 6);
  assert.match(otherRef.reasons.join(), /reference .* not in tx/);

  const failedTx = loadTx();
  failedTx.meta.err = { InstructionError: [1, { Custom: 17 }] };
  assert.match(validateTokenPayment(failedTx, req, merchantAta, 6).reasons.join(), /transaction failed/);

  const wrongRecipient = validateTokenPayment(loadTx(), req, Keypair.generate().publicKey, 6);
  assert.match(wrongRecipient.reasons.join(), /not credited/);
});
