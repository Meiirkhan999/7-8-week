// Must be imported before @solana/web3.js / @coral-xyz/anchor: they use Node's Buffer.
import { Buffer } from "buffer";

(globalThis as any).Buffer ??= Buffer;
