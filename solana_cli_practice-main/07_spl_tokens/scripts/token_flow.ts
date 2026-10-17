import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  ExtensionType,
  getMintLen,
  createInitializeTransferFeeConfigInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

async function main() {
  console.log("============================================================");
  console.log("  MODULE 7: SPL Tokens and Token Extensions Pipeline");
  console.log("============================================================");

  // 1. Setup Connection and Payer Keypair
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  let payer: Keypair;
  if (fs.existsSync(keypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } else {
    payer = Keypair.generate();
    fs.mkdirSync(path.dirname(keypairPath), { recursive: true });
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(payer.secretKey)));
  }

  const endpoint = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  console.log(`[1] Connecting to Solana RPC: ${endpoint}`);
  console.log(`    Payer Public Key: ${payer.publicKey.toBase58()}`);

  const connection = new Connection(endpoint, "confirmed");

  let balance = await connection.getBalance(payer.publicKey);
  console.log(`    Payer SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log("    Payer balance low, attempting airdrop...");
    try {
      const airdropSig = await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature: airdropSig,
        ...latestBlockhash,
      });
      balance = await connection.getBalance(payer.publicKey);
      console.log(`    ✓ Airdrop confirmed! New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    } catch (e: any) {
      console.warn(`    ⚠️ Airdrop warning (rate limited): ${e.message}`);
    }
  }

  const receiver = Keypair.generate();
  console.log(`    Receiver Public Key: ${receiver.publicKey.toBase58()}`);

  // 2. Standard SPL Token Pipeline
  console.log("\n[2] Creating standard SPL Token Mint (Decimals: 6)...");
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey, // mintAuthority
    payer.publicKey, // freezeAuthority
    6,               // decimals
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log(`    ✓ Mint created successfully: ${mint.toBase58()}`);

  console.log("\n[3] Creating Associated Token Accounts (ATAs)...");
  const payerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  console.log(`    ✓ Payer ATA: ${payerAta.address.toBase58()}`);

  const receiverAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    receiver.publicKey
  );
  console.log(`    ✓ Receiver ATA: ${receiverAta.address.toBase58()}`);

  console.log("\n[4] Minting 1,000,000 tokens (1,000,000.000000) to Payer ATA...");
  const mintAmount = 1_000_000n * 1_000_000n; // 1M tokens with 6 decimals
  const mintTxSig = await mintTo(
    connection,
    payer,
    mint,
    payerAta.address,
    payer,
    mintAmount
  );
  console.log(`    ✓ Minted tokens. Tx Signature: ${mintTxSig}`);

  const payerAccountAfterMint = await getAccount(connection, payerAta.address);
  console.log(`    Payer ATA Balance: ${Number(payerAccountAfterMint.amount) / 1_000_000} Tokens`);

  console.log("\n[5] Transferring 250,000 tokens to Receiver ATA...");
  const transferAmount = 250_000n * 1_000_000n;
  const transferTxSig = await transfer(
    connection,
    payer,
    payerAta.address,
    receiverAta.address,
    payer,
    transferAmount
  );
  console.log(`    ✓ Transfer executed. Tx Signature: ${transferTxSig}`);

  const payerAccountFinal = await getAccount(connection, payerAta.address);
  const receiverAccountFinal = await getAccount(connection, receiverAta.address);

  console.log(`    Final Payer Balance:    ${Number(payerAccountFinal.amount) / 1_000_000} Tokens`);
  console.log(`    Final Receiver Balance: ${Number(receiverAccountFinal.amount) / 1_000_000} Tokens`);

  // 3. BONUS: Token-2022 Extension (Transfer Fee Configuration)
  console.log("\n[6] BONUS: Creating Token-2022 Mint with Transfer Fee Extension...");
  const token2022MintKeypair = Keypair.generate();
  const decimals = 9;
  const feeBasisPoints = 250; // 2.5% fee
  const maxFee = BigInt(5_000 * 10 ** decimals); // Max 5,000 tokens fee

  const extensions = [ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const token2022Tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: token2022MintKeypair.publicKey,
      space: mintLen,
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferFeeConfigInstruction(
      token2022MintKeypair.publicKey,
      payer.publicKey, // transferFeeConfigAuthority
      payer.publicKey, // withdrawWithheldAuthority
      feeBasisPoints,
      maxFee,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      token2022MintKeypair.publicKey,
      decimals,
      payer.publicKey,
      payer.publicKey,
      TOKEN_2022_PROGRAM_ID
    )
  );

  const token2022TxSig = await sendAndConfirmTransaction(
    connection,
    token2022Tx,
    [payer, token2022MintKeypair]
  );
  console.log(`    ✓ Token-2022 Mint created: ${token2022MintKeypair.publicKey.toBase58()}`);
  console.log(`    ✓ Token-2022 Tx Signature: ${token2022TxSig}`);

  // Summary Results
  const results = {
    module: "07_spl_tokens",
    status: "SUCCESS",
    cluster: endpoint,
    spl_token_mint: mint.toBase58(),
    payer_ata: payerAta.address.toBase58(),
    receiver_ata: receiverAta.address.toBase58(),
    mint_tx_signature: mintTxSig,
    transfer_tx_signature: transferTxSig,
    payer_final_balance: Number(payerAccountFinal.amount) / 1_000_000,
    receiver_final_balance: Number(receiverAccountFinal.amount) / 1_000_000,
    token_2022_mint: token2022MintKeypair.publicKey.toBase58(),
    token_2022_tx_signature: token2022TxSig,
  };

  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  console.log("\n✓ Results written to results.json");
  console.log("✓ MODULE 7 PIPELINE COMPLETED SUCCESSFULLY!\n");
}

main().catch((err) => {
  console.error("Module 7 Execution Error:", err);
  process.exit(1);
});
