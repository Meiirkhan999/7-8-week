import { describe, expect, it } from "vitest";
import {
  bucketSignatures,
  explorerUrl,
  formatBucketLabel,
  pickBucketSeconds,
  successRate,
  toHoldings,
} from "./solana";
import { TIP_JAR_IDL, TIP_JAR_PROGRAM_ID, parseEventsFromLogs } from "./events";
import tipTx from "./__fixtures__/tip_tx_logs.json";

describe("bucketSignatures", () => {
  it("groups by bucket, splits ok/failed and keeps empty gaps", () => {
    const sigs = [
      { blockTime: 3600 * 10 + 5, err: null },
      { blockTime: 3600 * 10 + 50, err: { InstructionError: [0, "x"] } },
      { blockTime: 3600 * 12 + 1, err: null },
      { blockTime: null, err: null }, // no block time → ignored
    ];
    expect(bucketSignatures(sigs as any, 3600)).toEqual([
      { start: 36000, ok: 1, failed: 1 },
      { start: 39600, ok: 0, failed: 0 },
      { start: 43200, ok: 1, failed: 0 },
    ]);
  });

  it("returns [] when nothing has a block time", () => {
    expect(bucketSignatures([{ blockTime: null, err: null }] as any, 60)).toEqual([]);
  });

  it("total of buckets equals input count", () => {
    const sigs = Array.from({ length: 100 }, (_, i) => ({ blockTime: 1_700_000_000 + i * 97, err: i % 7 === 0 ? {} : null }));
    const b = bucketSignatures(sigs as any, pickBucketSeconds(sigs as any));
    expect(b.reduce((n, x) => n + x.ok + x.failed, 0)).toBe(100);
    expect(b.length).toBeLessThanOrEqual(48);
  });
});

describe("pickBucketSeconds", () => {
  it("targets at most 48 bars", () => {
    expect(pickBucketSeconds([{ blockTime: 0 }, { blockTime: 600 }] as any)).toBe(60);
    expect(pickBucketSeconds([{ blockTime: 0 }, { blockTime: 86400 }] as any)).toBe(3600);
    expect(pickBucketSeconds([{ blockTime: 0 }, { blockTime: 30 * 86400 }] as any)).toBe(86400);
    expect(pickBucketSeconds([] as any)).toBe(3600);
  });
});

describe("toHoldings", () => {
  it("normalizes parsed token accounts, drops empty ones and sorts by amount", () => {
    const acc = (mint: string, ui: string, decimals = 6) => ({
      pubkey: `acc-${mint}`,
      account: { data: { parsed: { info: { mint, tokenAmount: { uiAmountString: ui, decimals } } } } },
    });
    const h = toHoldings([acc("A", "1.5"), acc("B", "0"), acc("C", "250000")], "SPL Token");
    expect(h.map((x) => [x.mint, x.amount])).toEqual([
      ["C", 250000],
      ["A", 1.5],
    ]);
    expect(h[0]).toMatchObject({ account: "acc-C", decimals: 6, program: "SPL Token" });
  });
});

describe("misc helpers", () => {
  it("successRate", () => {
    expect(successRate([])).toBe(0);
    expect(successRate([{ err: null }, { err: {} }, { err: null }, { err: null }] as any)).toBe(0.75);
  });

  it("explorer links per cluster", () => {
    expect(explorerUrl("tx", "sig", "mainnet-beta", "")).toBe("https://explorer.solana.com/tx/sig");
    expect(explorerUrl("tx", "sig", "devnet", "")).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
    expect(explorerUrl("address", "a", "localnet", "http://127.0.0.1:8899")).toBe(
      "https://explorer.solana.com/address/a?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899"
    );
  });

  it("bucket labels", () => {
    expect(formatBucketLabel(0, 86400)).toMatch(/^\d\d\.\d\d$/);
    expect(formatBucketLabel(0, 3600)).toMatch(/^\d\d:\d\d$/);
  });
});

describe("Anchor event decoding", () => {
  it("decodes TipReceivedEvent from real tip_jar transaction logs", () => {
    const events = parseEventsFromLogs(TIP_JAR_PROGRAM_ID, TIP_JAR_IDL, tipTx.logs);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("TipReceivedEvent");
    expect(events[0].data).toMatchObject({
      amount: "53355425",
      message: "$5.00 tip @ $93.71/SOL (Pyth)",
      total_tips: "1",
      recipient: "8xH9d5NZVshAHqKiF1QCPHeFn1fa516wqtFDwgQXpa41",
    });
  });

  it("ignores logs from other programs", () => {
    expect(parseEventsFromLogs(TIP_JAR_PROGRAM_ID, TIP_JAR_IDL, ["Program 11111111111111111111111111111111 invoke [1]", "Program 11111111111111111111111111111111 success"])).toEqual([]);
  });
});
