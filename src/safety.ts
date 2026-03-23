import { Client } from "@covalenthq/client-sdk";
import type { NewPair } from "./stream";
import { privateKeyToAccount } from "viem/accounts";

// @ts-ignore — no types
import { isERC20Spam, Networks, Confidence } from "@covalenthq/goldrush-enhanced-spam-lists";
// @ts-ignore — no types
import { Mppx, tempo } from "mppx/client";

export interface SafetyResult {
  spam_score: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  holders: number;
  top_10_concentration: number;
  deployer_age_days: number;
  volatility_24h: number;
  rug_signals: string[];
  payment_made: boolean;
  payment_tx: string;
  fetch_time_ms: number;
}

// ── progress callbacks ──────────────────────────────────────────────
export type ProgressField = "holders" | "spam" | "price" | "deployer";
export type ProgressCallback = (field: ProgressField, ms: number) => void;

const CHAIN = "base-mainnet";
const GOLDRUSH_SAFETY_ENDPOINT = "https://goldrush-x402.vercel.app/v1/base-mainnet/tokens/";

// ── MPP client factory ──────────────────────────────────────────────
// Call once at startup — authorize a session on Tempo, then reuse for every
// GoldRush query. Each mppx.fetch() streams a voucher, no extra on-chain tx.
export function createMppxClient(privateKey: string) {
  const account      = privateKeyToAccount(privateKey as `0x${string}`);
  const sessionLimit = process.env.TEMPO_SESSION_LIMIT ?? "1.00";

  return Mppx.create({
    methods: [
      tempo({
        account,
        deposit: sessionLimit,  // pre-authorized USDC deposited into Tempo escrow
      }),
    ],
  });
}

export type MppxClient = ReturnType<typeof createMppxClient>;

export async function analyzeSafety(
  client: Client,
  pair: NewPair,
  onProgress?: ProgressCallback,
  mppxClient?: MppxClient
): Promise<SafetyResult> {
  const start    = Date.now();
  const contract = pair.contract;

  // ── holders ────────────────────────────────────────────────────────
  const holdersPromise = (async () => {
    const t = Date.now();
    const items: { balance: bigint | null }[] = [];
    try {
      for await (const h of client.BalanceService.getTokenHoldersV2ForTokenAddress(
        CHAIN, contract, { pageSize: 100 }
      )) {
        items.push(h as { balance: bigint | null });
        if (items.length >= 100) break;
      }
    } catch { /* fail open */ }
    onProgress?.("holders", Date.now() - t);
    return items;
  })();

  // ── spam ────────────────────────────────────────────────────────────
  const spamPromise = (async () => {
    const t = Date.now();
    let high = false, maybe = false;
    try {
      [high, maybe] = await Promise.all([
        isERC20Spam(contract.toLowerCase(), Networks.BASE_MAINNET, Confidence.YES)
          .then(Boolean).catch(() => false),
        isERC20Spam(contract.toLowerCase(), Networks.BASE_MAINNET, Confidence.MAYBE)
          .then(Boolean).catch(() => false),
      ]);
    } catch { /* fail open */ }
    onProgress?.("spam", Date.now() - t);
    return { high, maybe };
  })();

  // ── price history ───────────────────────────────────────────────────
  const pricePromise = (async () => {
    const t = Date.now();
    try {
      const now       = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const result    = await client.PricingService.getTokenPrices(CHAIN, "USD", contract, {
        from: yesterday.toISOString().slice(0, 10),
        to:   now.toISOString().slice(0, 10),
      });
      onProgress?.("price", Date.now() - t);
      return result;
    } catch {
      onProgress?.("price", Date.now() - t);
      return null;
    }
  })();

  // ── deployer age ────────────────────────────────────────────────────
  const deployerPromise = (async () => {
    const t = Date.now();
    try {
      for await (const tx of client.TransactionService.getAllTransactionsForAddress(
        CHAIN, contract, { blockSignedAtAsc: true, noLogs: true }
      )) {
        const signedAt = (tx as { block_signed_at?: Date }).block_signed_at;
        if (signedAt) {
          const age = Math.floor((Date.now() - signedAt.getTime()) / (1000 * 60 * 60 * 24));
          onProgress?.("deployer", Date.now() - t);
          return age;
        }
        break;
      }
    } catch { /* fail open */ }
    onProgress?.("deployer", Date.now() - t);
    return 9999;
  })();

  const [holderItems, spam, priceResp, deployerAge] = await Promise.all([
    holdersPromise, spamPromise, pricePromise, deployerPromise,
  ]);

  // ── process holders ─────────────────────────────────────────────────
  let holders            = holderItems.length;
  let top_10_concentration = 0;
  if (holderItems.length > 0) {
    const sorted = [...holderItems].sort(
      (a, b) => Number(b.balance ?? 0n) - Number(a.balance ?? 0n)
    );
    const total  = sorted.reduce((s, h) => s + Number(h.balance ?? 0n), 0);
    const top10  = sorted.slice(0, 10).reduce((s, h) => s + Number(h.balance ?? 0n), 0);
    if (total > 0) top_10_concentration = (top10 / total) * 100;
  }

  // ── process price ───────────────────────────────────────────────────
  let volatility_24h = 0;
  if (priceResp) {
    const priceData = priceResp?.data as
      | { prices?: { price: number }[]; items?: { price: number }[] }[]
      | undefined;
    const list = priceData?.[0]?.prices ?? priceData?.[0]?.items ?? [];
    const vals = list.map((p) => p.price).filter((v) => v > 0);
    if (vals.length >= 2) {
      const min = Math.min(...vals), max = Math.max(...vals);
      if (min > 0) volatility_24h = ((max - min) / min) * 100;
    }
  }

  const deployer_age_days = deployerAge;

  // ── rug signals ─────────────────────────────────────────────────────
  const rug_signals: string[] = [];
  if (spam.high)                       rug_signals.push("spam list");
  if (top_10_concentration > 80)       rug_signals.push("concentration >80%");
  if (deployer_age_days < 7)           rug_signals.push("new deployer");
  if (volatility_24h > 50)             rug_signals.push("high volatility");
  if (holders > 0 && holders < 50)     rug_signals.push("low holders");

  let spam_score: SafetyResult["spam_score"] = "LOW";
  if (spam.high)                                   spam_score = "HIGH";
  else if (spam.maybe || top_10_concentration > 60) spam_score = "MEDIUM";

  // ── MPP payment — pay for GoldRush intelligence via Tempo MPP session ─
  // Uses the pre-authorized session client (created once at startup).
  // Each call signs a voucher off-chain — no extra on-chain transaction.
  let payment_made = false, payment_tx = "";
  if (mppxClient) {
    try {
      const endpoint = `${GOLDRUSH_SAFETY_ENDPOINT}${contract}/safety`;
      const response = await mppxClient.fetch(endpoint);
      const receipt  = response.headers.get("MPP-Receipt");
      if (response.ok || receipt) {
        payment_made = true;
        payment_tx   = receipt ?? "mpp-session";
      }
    } catch { /* fail open — continue with API key mode */ }
  }

  return {
    spam_score, holders, top_10_concentration,
    deployer_age_days, volatility_24h, rug_signals,
    payment_made, payment_tx,
    fetch_time_ms: Date.now() - start,
  };
}
