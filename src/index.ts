import "dotenv/config";
import blessed from "blessed";
// @ts-ignore
import contrib from "blessed-contrib";
import { Client } from "@covalenthq/client-sdk";
import { startPairStream, type NewPair } from "./stream";
import { analyzeSafety, type ProgressField } from "./safety";
import {
  showStartupSequence,
  updateHeader,
  updateFeed,
  updateSafetyLoading,
  updateSafetyPanel,
  updateChart,
  updateStats,
  flashNewRow,
  freshLoadingState,
  showClusterTakeover,
  type SafetyLoadingState,
  fmtLiq,
  fmtTime,
  fmtUptime,
  type FeedRow,
  type Stats,
} from "./display";
import { loadCounters, saveCounters, saveSession, type Counters } from "./counters";

// ── env ──────────────────────────────────────────────────────────────
const API_KEY = process.env.GOLDRUSH_API_KEY;
if (!API_KEY) {
  console.error("ERROR: GOLDRUSH_API_KEY is not set in .env");
  process.exit(1);
}
const client = new Client(API_KEY);

// ── wallet balance ────────────────────────────────────────────────────
async function getWalletBalance(address: string): Promise<string> {
  try {
    const resp = await client.BalanceService.getTokenBalancesForWalletAddress(
      "base-mainnet", address
    );
    const items = resp?.data?.items ?? [];
    const usdc  = items.find((i) => i.contract_ticker_symbol?.toUpperCase() === "USDC");
    if (usdc) return (Number(usdc.balance ?? 0n) / 10 ** (usdc.contract_decimals ?? 6)).toFixed(2);
    return "0.00";
  } catch { return "--"; }
}

// ── main ──────────────────────────────────────────────────────────────
async function init() {
  const counters: Counters = loadCounters();

  // ── pre-fetch block height for startup sequence ───────────────────
  let blockHeight = 0;
  try {
    const br = await client.BaseService.getBlock("base-mainnet", "latest");
    blockHeight = br?.data?.items?.[0]?.height ?? 0;
  } catch { /* show 0 */ }

  // ── startup animation ─────────────────────────────────────────────
  await showStartupSequence(counters, blockHeight);

  // ── wallet address ────────────────────────────────────────────────
  let walletAddress = "0x0000...0000";
  if (process.env.AGENT_PRIVATE_KEY?.startsWith("0x") && process.env.AGENT_PRIVATE_KEY.length >= 66) {
    try {
      const { privateKeyToAccount } = await import("viem/accounts");
      walletAddress = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`).address;
    } catch { /* keep default */ }
  }

  let walletBalance = await getWalletBalance(walletAddress);

  // ── build blessed screen ──────────────────────────────────────────
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: "TEMPO × GOLDRUSH AGENT",
    dockBorders: true,
  });

  // HEADER
  const header = blessed.box({
    top: 0, left: 0, width: "100%", height: 3,
    tags: true,
    border: { type: "line" },
    style: { bg: "#0a0a0a", fg: "#e0e0e0", border: { fg: "#1a1a2e" } },
  });
  screen.append(header);

  // LEFT — PAIR FEED
  const feedBox = blessed.box({
    top: 3, left: 0, width: "50%", height: "72%",
    label: " {bold}⬡ TEMPO FEED{/bold} ",
    tags: true,
    border: { type: "line" },
    style: { bg: "#0a0a0a", fg: "#e0e0e0", border: { fg: "#1a1a2e" }, label: { fg: "#00ff88", bold: true } },
  });
  screen.append(feedBox);

  const feedTable = blessed.listtable({
    parent: feedBox,
    top: 0, left: 0, width: "100%-2", height: "100%-2",
    tags: true, align: "left",
    keys: false, mouse: false,
    noCellBorders: true, fillCellBorders: false,
    style: {
      bg: "#0a0a0a", fg: "#e0e0e0",
      header: { fg: "#00ff88", bold: true },
      cell: { fg: "#e0e0e0" },
    },
  });

  // RIGHT — SCANNER
  const safetyBox = blessed.box({
    top: 3, left: "50%", width: "50%", height: "72%",
    label: " {bold}TEMPO SCANNER{/bold} ",
    tags: true,
    border: { type: "line" },
    style: { bg: "#0a0a0a", fg: "#e0e0e0", border: { fg: "#1a1a2e" }, label: { fg: "#00ff88", bold: true } },
    content: "\n {#555555-fg}awaiting first pair...{/}",
  });
  screen.append(safetyBox);

  // CHART
  const chartBox = blessed.box({
    top: "75%", left: 0, width: "100%", height: "13%",
    label: " {bold}TEMPO LIQUIDITY RADAR{/bold} ",
    tags: true,
    border: { type: "line" },
    style: { bg: "#0a0a0a", fg: "#e0e0e0", border: { fg: "#1a1a2e" }, label: { fg: "#00ff88", bold: true } },
  });
  screen.append(chartBox);

  const sparkline = contrib.sparkline({
    parent: chartBox,
    top: 0, left: 0, width: "100%-2", height: "100%-2",
    tags: true,
    style: { bg: "#0a0a0a", fg: "#00ff88", titleFg: "#00ff88" },
    label: "liquidity",
  });

  // STATS BAR
  const statsBar = blessed.box({
    bottom: 0, left: 0, width: "100%", height: 3,
    tags: true,
    border: { type: "line" },
    style: { bg: "#0a0a0a", fg: "#e0e0e0", border: { fg: "#1a1a2e" } },
  });
  screen.append(statsBar);

  // ── runtime state ─────────────────────────────────────────────────
  const feedRows: FeedRow[]      = [];
  const liquidityHistory: number[] = [];
  const stats: Stats = {
    analyzed: 0, signals: 0, rugsAvoided: 0,
    x402Spent: 0, startTime: Date.now(),
  };

  let streamLive  = false;
  const analysisQueue: NewPair[] = [];
  let analyzing   = false;

  // ── analysis queue ────────────────────────────────────────────────
  async function drainQueue() {
    if (analyzing || analysisQueue.length === 0) return;
    analyzing = true;

    const pair = analysisQueue.shift()!;

    // Show loading state with fresh progress tracker
    let loadState: SafetyLoadingState = freshLoadingState();
    updateSafetyLoading(safetyBox, pair, loadState);
    screen.render();

    // Animation interval: ticks every 100ms
    const animInterval = setInterval(() => {
      loadState.animFrame++;
      updateSafetyLoading(safetyBox, pair, loadState);
      screen.render();
    }, 100);

    // Progress callback — fired as each API call resolves
    const onProgress = (field: ProgressField, ms: number) => {
      switch (field) {
        case "holders":  loadState.holders  = "done"; loadState.holders_ms  = ms; break;
        case "spam":     loadState.spam     = "done"; loadState.spam_ms     = ms; break;
        case "price":    loadState.price    = "done"; loadState.price_ms    = ms; break;
        case "deployer": loadState.deployer = "done"; loadState.deployer_ms = ms; break;
      }
      updateSafetyLoading(safetyBox, pair, loadState);
      screen.render();
    };

    const safety = await analyzeSafety(client, pair, onProgress);
    clearInterval(animInterval);

    const isSignal = safety.spam_score === "LOW" && safety.rug_signals.length === 0;

    stats.analyzed++;
    if (isSignal)                        stats.signals++;
    else if (safety.rug_signals.length > 0) stats.rugsAvoided++;
    if (safety.payment_made)             stats.x402Spent += 0.01;

    // Signal: terminal bell
    if (isSignal) process.stdout.write("\x07");

    // Update feed row status
    const row = feedRows.find((r) => r.pair === `${pair.token0_symbol}/${pair.token1_symbol}`);
    if (row) {
      row.risk   = safety.spam_score === "UNKNOWN" ? "LOW" : safety.spam_score;
      row.status = isSignal ? "SIGNAL" : "SKIP";
    }

    // Cluster takeover when 2+ rug signals detected
    if (safety.rug_signals.length >= 2) {
      showClusterTakeover(screen, pair, safety);
    }

    // Persist counters
    counters.total_analyzed++;
    if (isSignal)                        counters.total_signals++;
    else if (safety.rug_signals.length > 0) counters.total_rugs_avoided++;
    if (safety.payment_made)             counters.total_x402_spent += 0.01;
    saveCounters(counters);

    updateSafetyPanel(safetyBox, pair, safety, false);
    updateFeed(feedTable, feedRows);
    updateStats(statsBar, stats);
    screen.render();

    analyzing = false;
    setImmediate(drainQueue);
  }

  // ── on new pair ───────────────────────────────────────────────────
  function onNewPair(pair: NewPair) {
    const row: FeedRow = {
      time:   fmtTime(pair.created_at),
      pair:   `${pair.token0_symbol}/${pair.token1_symbol}`,
      liq:    pair.liquidity_usd > 0 ? fmtLiq(pair.liquidity_usd) : "--",
      risk:   "UNKNOWN",
      status: "...",
    };

    feedRows.unshift(row);
    if (feedRows.length > 20) feedRows.pop();

    if (pair.liquidity_usd > 0) {
      liquidityHistory.push(pair.liquidity_usd);
      if (liquidityHistory.length > 30) liquidityHistory.shift();
    }

    flashNewRow(feedTable, feedRows);
    updateFeed(feedTable, feedRows);
    updateChart(sparkline, liquidityHistory);
    screen.render();

    analysisQueue.push(pair);
    drainQueue();
  }

  // ── 1s stats tick ─────────────────────────────────────────────────
  setInterval(() => {
    updateStats(statsBar, stats);
    screen.render();
  }, 1000);

  // ── 30s balance refresh ───────────────────────────────────────────
  async function refreshBalance() {
    if (!walletAddress || walletAddress === "0x0000...0000") return;
    walletBalance = await getWalletBalance(walletAddress);
  }
  setInterval(refreshBalance, 30_000);

  // ── start header blink ────────────────────────────────────────────
  updateHeader(header, walletAddress, walletBalance, false);

  // ── start stream ──────────────────────────────────────────────────
  const stopStream = startPairStream(client, onNewPair, (status) => {
    streamLive = status === "live";
    updateHeader(header, walletAddress, walletBalance, streamLive);
    screen.render();
  });

  // ── quit ──────────────────────────────────────────────────────────
  screen.key(["escape", "q", "C-c"], () => {
    stopStream();
    screen.destroy();

    // Persist session
    counters.total_sessions++;
    saveCounters(counters);
    saveSession(counters, stats);

    const elapsed = fmtUptime(Date.now() - stats.startTime);
    console.log(`\n╔══════════════════════════════╗`);
    console.log(`║    ⬡  TEMPO  SESSION DONE    ║`);
    console.log(`╠══════════════════════════════╣`);
    console.log(`║  analyzed:     ${String(stats.analyzed).padEnd(14)}║`);
    console.log(`║  signals:      ${String(stats.signals).padEnd(14)}║`);
    console.log(`║  rugs avoided: ${String(stats.rugsAvoided).padEnd(14)}║`);
    console.log(`║  x402 spent:   $${String(stats.x402Spent.toFixed(2) + " USDC").padEnd(13)}║`);
    console.log(`║  uptime:       ${elapsed.padEnd(14)}║`);
    console.log(`╠══════════════════════════════╣`);
    console.log(`║  lifetime rugs: ${String(counters.total_rugs_avoided).padEnd(13)}║`);
    console.log(`║  lifetime x402: $${String(counters.total_x402_spent.toFixed(2) + " USDC").padEnd(12)}║`);
    console.log(`╚══════════════════════════════╝\n`);
    process.exit(0);
  });

  screen.render();
}

init().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
