import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ── Tempo wallet initialization ─────────────────────────────────────
// Agent wallet used for MPP session authorization on the Tempo chain.
// Funded with USDC (mainnet) or pathUSD (testnet) for micropayments.

export function getTempoWalletAddress(): string {
  const key = process.env.TEMPO_WALLET_KEY;
  if (!key?.startsWith("0x") || key.length < 66) return "0x0000...0000";
  try {
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch { return "0x0000...0000"; }
}

export function createTempoWalletClient() {
  const key = process.env.TEMPO_WALLET_KEY;
  if (!key) throw new Error("TEMPO_WALLET_KEY not set");
  const account = privateKeyToAccount(key as `0x${string}`);
  return createWalletClient({ account, transport: http() });
}
