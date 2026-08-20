// Account-wallet operations: balance, deposits, withdrawals, and signing the
// swaps that back a basket position. All on-chain, all real.
import { getDb } from "./db";
import { CustodyError, isValidAddress, loadSigner } from "./custody";
import { rpcUrl, verifySignature } from "./swap";

export const LAMPORTS_PER_SOL = 1_000_000_000;
// leave enough for rent + a few signatures so an account never bricks itself
export const WITHDRAW_RESERVE_LAMPORTS = 5_000_000; // 0.005 SOL

export type AccountWallet = { address: string; encryptedKey: string };

export function getAccountWallet(userId: number): AccountWallet | null {
  const row = getDb()
    .prepare("SELECT wallet_address, wallet_key FROM users WHERE id = ?")
    .get(userId) as { wallet_address: string | null; wallet_key: string | null } | undefined;
  if (!row?.wallet_address || !row.wallet_key) return null;
  return { address: row.wallet_address, encryptedKey: row.wallet_key };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`rpc ${method} ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? `rpc ${method} failed`);
  return json.result as T;
}

/** On-chain SOL balance of the account wallet, in lamports. */
export async function getSolBalance(address: string): Promise<number> {
  const r = await rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
  return r?.value ?? 0;
}

/**
 * Withdraw SOL from the account wallet to any address the user names.
 * Signed server-side with the account's own key — the user's funds, moved only
 * on their explicit instruction.
 */
export async function withdrawSol(
  userId: number,
  destination: string,
  amountSol: number
): Promise<{ signature: string; lamports: number }> {
  if (!isValidAddress(destination)) throw new CustodyError("That doesn't look like a Solana address");
  if (!Number.isFinite(amountSol) || amountSol <= 0) throw new CustodyError("Enter an amount");

  const wallet = getAccountWallet(userId);
  if (!wallet) throw new CustodyError("This account has no wallet yet");
  if (destination === wallet.address) throw new CustodyError("That's this account's own address");

  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const balance = await getSolBalance(wallet.address);
  if (lamports + WITHDRAW_RESERVE_LAMPORTS > balance) {
    const max = Math.max(0, balance - WITHDRAW_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL;
    throw new CustodyError(
      `Not enough SOL — you can withdraw up to ${max.toFixed(4)} (a small reserve stays for fees)`
    );
  }

  const { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } =
    await import("@solana/web3.js");
  const conn = new Connection(rpcUrl(), "confirmed");
  const signer = loadSigner(wallet.encryptedKey);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");

  const msg = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey(destination),
        lamports,
      }),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  tx.sign([signer]);
  const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

  // transactions.amount is a USD column everywhere else — record the USD value
  // of the withdrawal, with the SOL quantity in the detail text. 0 if the SOL
  // price is momentarily unavailable (detail still carries the truth).
  const { solPriceUsd } = await import("./treasury");
  const solUsd = (await solPriceUsd()) ?? 0;
  getDb()
    .prepare(
      "INSERT INTO transactions (user_id, type, basket_id, amount, detail, created_at) VALUES (?, 'withdraw', NULL, ?, ?, ?)"
    )
    .run(
      userId,
      amountSol * solUsd,
      `Withdrew ${amountSol} SOL to ${destination.slice(0, 4)}…${destination.slice(-4)} · ${signature}`,
      Date.now()
    );

  return { signature, lamports };
}

/**
 * Sign, send AND CONFIRM one transaction with the account wallet.
 *
 * Confirmation is mandatory: an RPC that accepts a transaction is not a
 * transaction that landed. Callers record ledger rows only for signatures this
 * function returned, so a dropped or failed swap can never become a phantom
 * holding. Throws if the transaction did not confirm.
 */
export async function signSendConfirmOne(userId: number, base64Tx: string): Promise<string> {
  const wallet = getAccountWallet(userId);
  if (!wallet) throw new CustodyError("This account has no wallet yet");
  const { Connection, VersionedTransaction } = await import("@solana/web3.js");
  const conn = new Connection(rpcUrl(), "confirmed");
  const signer = loadSigner(wallet.encryptedKey);

  const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
  tx.sign([signer]);
  const latest = await conn.getLatestBlockhash("confirmed");
  const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const res = await conn.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed"
  );
  if (res.value.err) {
    throw new CustodyError(`Transaction failed on-chain (${signature})`);
  }
  return signature;
}

/**
 * Sign and send several transactions, confirming each before moving on.
 * Stops at the first failure and reports what actually landed, so the caller
 * can persist exactly the legs that executed.
 */
export async function signAndSendForAccount(
  userId: number,
  base64Txs: string[]
): Promise<string[]> {
  const signatures: string[] = [];
  for (const b64 of base64Txs) {
    signatures.push(await signSendConfirmOne(userId, b64));
  }
  return signatures;
}

export { verifySignature };
