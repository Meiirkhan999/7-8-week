import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  PYTH_SOL_USD_FEED_ID,
  decodePriceUpdateV2,
  deviation,
  impliedUsdPerSol,
  maxLamportsWithSlippage,
  usdToLamports,
  validatePythPrice,
} from "../src/defi";

const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", f), "utf-8"));
const pythFixture = fixture("pyth_sol_usd.json");
const pythData = Buffer.from(pythFixture.data_base64, "base64");

test("decodes a real mainnet Pyth PriceUpdateV2 account", () => {
  const p = decodePriceUpdateV2(pythData);
  assert.equal(p.feedId, PYTH_SOL_USD_FEED_ID);
  assert.equal(p.exponent, -8);
  assert.equal(p.verification, "Full");
  assert.ok(p.usd > 1 && p.usd < 10_000, `implausible SOL price ${p.usd}`);
  assert.ok(Math.abs(p.publishTime * 1000 - Date.parse(pythFixture.captured_at)) < 10 * 60_000);
});

test("price validation rejects stale, wrong-feed, partial and low-confidence prices", () => {
  const p = decodePriceUpdateV2(pythData);
  const fresh = { maxAgeSeconds: 60, maxConfidenceRatio: 0.01, nowSeconds: p.publishTime + 10 };
  assert.doesNotThrow(() => validatePythPrice(p, PYTH_SOL_USD_FEED_ID, fresh));
  assert.throws(() => validatePythPrice(p, PYTH_SOL_USD_FEED_ID, { ...fresh, nowSeconds: p.publishTime + 61 }), /Stale/);
  assert.throws(() => validatePythPrice(p, "00".repeat(32), fresh), /Wrong feed/);
  assert.throws(() => validatePythPrice({ ...p, verification: "Partial" }, PYTH_SOL_USD_FEED_ID, fresh), /partially/);
  assert.throws(() => validatePythPrice({ ...p, conf: p.price / 50n }, PYTH_SOL_USD_FEED_ID, fresh), /Confidence/);
  assert.throws(() => validatePythPrice({ ...p, price: 0n }, PYTH_SOL_USD_FEED_ID, fresh), /Non-positive/);
});

test("decoder handles the Partial verification layout (2-byte enum)", () => {
  const full = decodePriceUpdateV2(pythData);
  const partial = Buffer.concat([pythData.subarray(0, 40), Buffer.from([0, 3]), pythData.subarray(41)]);
  const p = decodePriceUpdateV2(partial);
  assert.equal(p.verification, "Partial");
  assert.equal(p.feedId, full.feedId);
  assert.equal(p.price, full.price);
});

test("usdToLamports uses integer math and rounds down", () => {
  // $100/SOL with expo -8 → $5 = 0.05 SOL
  assert.equal(usdToLamports(5, { price: 10_000_000_000n, exponent: -8 }), 50_000_000n);
  // $93.41133974/SOL → $1 = 10_705_338.37… lamports, rounded down
  assert.equal(usdToLamports(1, { price: 9_341_133_974n, exponent: -8 }), 10_705_338n);
  assert.throws(() => usdToLamports(0, { price: 1n, exponent: -8 }), /positive/);
});

test("Jupiter quote fixture implies a price consistent with Pyth", () => {
  const q = fixture("jupiter_quote_sol_usdc.json");
  const market = impliedUsdPerSol(q);
  const oracle = decodePriceUpdateV2(pythData).usd;
  assert.ok(deviation(market, oracle) < 0.02, `market ${market} vs oracle ${oracle}`);
});

test("slippage ceiling", () => {
  assert.equal(maxLamportsWithSlippage(1_000_000n, 100), 1_010_000n);
  assert.equal(maxLamportsWithSlippage(1_000_000n, 0), 1_000_000n);
});
