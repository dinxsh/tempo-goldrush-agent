import type { SafetyResult } from "./safety";
import type { NewPair } from "./stream";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

function isConfigured(): boolean {
  return Boolean(BOT_TOKEN && CHAT_ID);
}

async function send(text: string): Promise<void> {
  if (!isConfigured()) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch { /* non-blocking — never crash the agent */ }
}

export async function alertRug(pair: NewPair, safety: SafetyResult): Promise<void> {
  if (!isConfigured()) return;

  const signals = safety.rug_signals.map((s) => `  ⚠️ ${s}`).join("\n");
  const age     = safety.deployer_age_days === 9999 ? "unknown" : `${safety.deployer_age_days}d`;
  const conc    = safety.top_10_concentration.toFixed(1);
  const mpp     = safety.payment_made ? `\n💸 <b>$0.01 USDC</b> paid via Tempo MPP` : "";

  const msg =
    `🚨 <b>RUG DETECTED — ${pair.token0_symbol}/${pair.token1_symbol}</b>\n\n` +
    `🔴 Risk: <b>${safety.spam_score}</b>\n` +
    `⚠️ Signals:\n${signals}\n\n` +
    `👥 Holders: ${safety.holders.toLocaleString()}\n` +
    `🔒 Top 10 conc: ${conc}%\n` +
    `📅 Deployer age: ${age}\n` +
    `📊 Volatility 24h: ${safety.volatility_24h.toFixed(1)}%\n` +
    mpp + `\n\n` +
    `🔗 <code>${pair.contract}</code>\n` +
    `🤖 <i>tempo-goldrush-agent · GoldRush intelligence</i>`;

  await send(msg);
}

export async function alertSignal(pair: NewPair, safety: SafetyResult): Promise<void> {
  if (!isConfigured()) return;

  const age  = safety.deployer_age_days === 9999 ? "unknown" : `${safety.deployer_age_days}d`;
  const conc = safety.top_10_concentration.toFixed(1);
  const mpp  = safety.payment_made ? `\n💸 <b>$0.01 USDC</b> paid via Tempo MPP` : "";

  const msg =
    `✅ <b>SIGNAL — ${pair.token0_symbol}/${pair.token1_symbol}</b>\n\n` +
    `🟢 Risk: <b>${safety.spam_score}</b>  ·  0 rug signals\n\n` +
    `👥 Holders: ${safety.holders.toLocaleString()}\n` +
    `🔒 Top 10 conc: ${conc}%\n` +
    `📅 Deployer age: ${age}\n` +
    `📊 Volatility 24h: ${safety.volatility_24h.toFixed(1)}%\n` +
    mpp + `\n\n` +
    `🔗 <code>${pair.contract}</code>\n` +
    `🤖 <i>tempo-goldrush-agent · GoldRush intelligence</i>`;

  await send(msg);
}

export async function alertSessionSummary(stats: {
  analyzed: number;
  signals: number;
  rugsAvoided: number;
  mppSpent: number;
  uptime: string;
  session: number;
}): Promise<void> {
  if (!isConfigured()) return;

  const msg =
    `⬡ <b>TEMPO SESSION COMPLETE</b>\n\n` +
    `📈 Analyzed: <b>${stats.analyzed}</b> pairs\n` +
    `▶️ Signals: <b>${stats.signals}</b>\n` +
    `💀 Rugs blocked: <b>${stats.rugsAvoided}</b>\n` +
    `💸 MPP spent: <b>$${stats.mppSpent.toFixed(2)} USDC</b> on Tempo\n` +
    `⏱ Uptime: ${stats.uptime}\n` +
    `🔢 Session #${stats.session}\n\n` +
    `🤖 <i>tempo-goldrush-agent · powered by GoldRush + Tempo MPP</i>`;

  await send(msg);
}
