import blessed from "blessed";
import chalk from "chalk";
import type { NewPair } from "./stream";
import type { SafetyResult } from "./safety";
import type { Counters } from "./counters";

// ── palette ─────────────────────────────────────────────────────────
const C = {
  green:  "#00ff88",
  red:    "#ff4444",
  amber:  "#ffaa00",
  text:   "#e0e0e0",
  muted:  "#555555",
  dim:    "#333333",
  bg:     "#0a0a0a",
  border: "#1a1a2e",
};

// ── helpers ──────────────────────────────────────────────────────────
function stripTags(s: string): string {
  return s.replace(/\{[^}]+\}/g, "");
}

function layoutRow(left: string, center: string, right: string, width: number): string {
  const lLen = stripTags(left).length;
  const cLen = stripTags(center).length;
  const rLen = stripTags(right).length;
  const pad  = Math.max(0, width - lLen - cLen - rLen);
  const lPad = Math.max(1, Math.floor(pad / 2));
  const rPad = Math.max(1, pad - lPad);
  return left + " ".repeat(lPad) + center + " ".repeat(rPad) + right;
}

export function fmtLiq(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0")).join(":");
}

export function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [h, m, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

// ── startup sequence ─────────────────────────────────────────────────
export async function showStartupSequence(
  counters: Counters,
  blockHeight: number
): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const W     = Math.min(process.stdout.columns || 80, 80);
  const line  = chalk.hex(C.muted)("─".repeat(W));
  const g     = (s: string) => chalk.hex(C.green)(s);
  const w     = (s: string) => chalk.white.bold(s);
  const dim   = (s: string) => chalk.hex(C.muted)(s);
  const a     = (s: string) => chalk.hex(C.amber)(s);
  const check = g("  ✓  ");

  process.stdout.write("\x1b[2J\x1b[H");
  console.log("");
  console.log(line);
  console.log("  " + g("⬡") + "  " + w("TEMPO") + "  " + dim("× GoldRush Intelligence"));
  console.log(line);
  console.log("");
  await sleep(180);

  console.log(check + dim("goldrush api ")       + g("connected"));
  await sleep(180);
  console.log(check + dim("base mainnet  ·  block ") + w(blockHeight.toLocaleString()));
  await sleep(250);
  console.log(check + dim("spam intelligence ") + g("ready"));
  await sleep(180);
  console.log(check + dim(`session `) + w(`#${counters.total_sessions + 1}`) + dim("  ·  agent online"));
  await sleep(180);
  console.log(check + g("streaming") + dim(" for new pairs on base mainnet..."));
  await sleep(400);

  console.log("");
  console.log(line);

  if (counters.total_analyzed > 0) {
    const rugs = w(counters.total_rugs_avoided.toLocaleString());
    const cost = g(`$${counters.total_x402_spent.toFixed(2)}`);
    console.log("  " + a("lifetime  ") + rugs + dim(" rugs flagged  ·  ") + cost + dim(" x402 spent"));
  } else {
    console.log("  " + dim("first session  ·  history will accumulate here"));
  }

  console.log(line);
  console.log("");
  await sleep(500);
  console.log("  " + dim("launching dashboard..."));
  await sleep(700);

  process.stdout.write("\x1b[2J\x1b[H");
}

// ── header ──────────────────────────────────────────────────────────
let _dot      = true;
let _dotTimer: ReturnType<typeof setInterval> | null = null;
let _isLive   = false;
let _wallet   = "";
let _balance  = "0.00";

export function updateHeader(
  box: blessed.Widgets.BoxElement,
  wallet: string,
  balance: string,
  isLive: boolean
): void {
  _isLive  = isLive;
  _wallet  = wallet;
  _balance = balance;

  if (!_dotTimer) {
    _dotTimer = setInterval(() => {
      _dot = !_dot;
      const dot    = _dot ? `{#00ff88-fg}●{/}` : `{#333333-fg}●{/}`;
      const status = _isLive
        ? `${dot} {bold}LIVE · BASE MAINNET{/bold}`
        : `{#ffaa00-fg}◌ RECONNECTING...{/}`;
      const short  = _wallet.length > 12
        ? _wallet.slice(0, 6) + "..." + _wallet.slice(-4)
        : _wallet;
      const W = (box.screen?.width as number) ?? 100;
      box.setContent(layoutRow(
        ` {#00ff88-fg}{bold}⬡ TEMPO{/bold}{/} {#555555-fg}× GoldRush{/}`,
        status,
        `{#555555-fg}agent:{/} ${short}  {#00ff88-fg}${parseFloat(_balance).toFixed(2)} USDC{/} `,
        W
      ));
      box.screen?.render();
    }, 800);
  }
}

// ── feed table ───────────────────────────────────────────────────────
export interface FeedRow {
  time: string;
  pair: string;
  liq:  string;
  risk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  status: "SIGNAL" | "SKIP" | "...";
}

export function updateFeed(
  table: blessed.Widgets.ListTableElement,
  rows:  FeedRow[]
): void {
  const headers = ["TIME", "PAIR", "LIQ", "RISK", "STATUS"];
  const data = rows.slice(0, 20).map((r) => {
    const riskTag =
      r.risk === "LOW"     ? `{#00ff88-fg}✓ LOW{/}` :
      r.risk === "MEDIUM"  ? `{#ffaa00-fg}⚠ MED{/}` :
      r.risk === "HIGH"    ? `{#ff4444-fg}💀 HIGH{/}` :
                             `{#555555-fg}···{/}`;

    const statusTag =
      r.status === "SIGNAL" ? `{#00ff88-fg}▶ SIGNAL{/}` :
      r.status === "SKIP" && r.risk === "HIGH" ? `{#ff4444-fg}💀 RUG{/}` :
      r.status === "SKIP"   ? `{#ff4444-fg}✗ SKIP{/}` :
                              `{#555555-fg}···{/}`;

    return [r.time, r.pair, r.liq, riskTag, statusTag];
  });

  table.setData([headers, ...data]);
  table.screen?.render();
}

export function flashNewRow(
  table: blessed.Widgets.ListTableElement,
  rows:  FeedRow[]
): void {
  updateFeed(table, rows);
  setTimeout(() => updateFeed(table, rows), 300);
}

// ── safety panel: loading state with parallel progress bars ──────────
export interface SafetyLoadingState {
  holders:    "pending" | "done" | "error";
  holders_ms: number;
  spam:       "pending" | "done" | "error";
  spam_ms:    number;
  price:      "pending" | "done" | "error";
  price_ms:   number;
  deployer:   "pending" | "done" | "error";
  deployer_ms: number;
  animFrame:  number;
}

export function freshLoadingState(): SafetyLoadingState {
  return {
    holders: "pending", holders_ms: 0,
    spam:    "pending", spam_ms:    0,
    price:   "pending", price_ms:   0,
    deployer:"pending", deployer_ms:0,
    animFrame: 0,
  };
}

function progBar(state: "pending" | "done" | "error", frame: number, ms: number): string {
  const W = 20;
  if (state === "done") {
    return `{#00ff88-fg}${"▓".repeat(W)}{/}  {#555555-fg}✓ ${ms}ms{/}`;
  }
  if (state === "error") {
    return `{#ff4444-fg}${"▓".repeat(W)}{/}  {#ff4444-fg}✗ err{/}`;
  }
  // Animated fill: ramps up to 95% over ~2s (frame increments at 100ms)
  const fill = Math.min(Math.floor((frame / 20) * W), W - 1);
  return `{#555555-fg}${"▓".repeat(fill)}${"░".repeat(W - fill)}{/}  {#555555-fg}…{/}`;
}

export function updateSafetyLoading(
  box:   blessed.Widgets.BoxElement,
  pair:  NewPair,
  state: SafetyLoadingState
): void {
  const name    = `${pair.token0_symbol}/${pair.token1_symbol}`;
  const short   = pair.contract.length > 10
    ? pair.contract.slice(0, 6) + "..." + pair.contract.slice(-4)
    : pair.contract;
  const f = state.animFrame;

  const x402line = process.env.GOLDRUSH_X402_MODE === "true"
    ? ` {#ffaa00-fg}⊕ x402 payment pending...{/}\n`
    : "";

  box.setContent(
    `\n {bold}{#e0e0e0-fg}${name}{/bold}{/}\n` +
    ` {#555555-fg}${short} · ${pair.dex_name || "base-mainnet"}{/}\n\n` +
    ` {#555555-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}\n\n` +
    ` {#555555-fg}holders    {/}${progBar(state.holders,  f, state.holders_ms)}\n` +
    ` {#555555-fg}spam       {/}${progBar(state.spam,     f, state.spam_ms)}\n` +
    ` {#555555-fg}price hist {/}${progBar(state.price,    f, state.price_ms)}\n` +
    ` {#555555-fg}deployer   {/}${progBar(state.deployer, f, state.deployer_ms)}\n\n` +
    x402line +
    ` {#555555-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}\n`
  );
  box.screen?.render();
}

// ── safety panel: results ────────────────────────────────────────────
export function riskBar(
  score: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN",
  filled = 10
): { bar: string; color: string } {
  const levels = { LOW: 3, MEDIUM: 6, HIGH: 10, UNKNOWN: 0 };
  const level  = levels[score] ?? 0;
  const bar    = "▓".repeat(level) + "░".repeat(filled - level);
  const color  =
    score === "LOW"    ? C.green :
    score === "MEDIUM" ? C.amber :
    score === "HIGH"   ? C.red   : C.muted;
  return { bar, color };
}

export function updateSafetyPanel(
  box:      blessed.Widgets.BoxElement,
  pair:     NewPair,
  safety:   SafetyResult | null,
  isLoading: boolean
): void {
  if (isLoading || !safety) return; // loading handled by updateSafetyLoading

  const name  = `${pair.token0_symbol}/${pair.token1_symbol}`;
  const short = pair.contract.length > 10
    ? pair.contract.slice(0, 6) + "..." + pair.contract.slice(-4)
    : pair.contract;

  const { bar, color } = riskBar(safety.spam_score);
  const barTag = `{${color}-fg}${bar}{/}`;

  const isSignal = safety.spam_score === "LOW" && safety.rug_signals.length === 0;

  const signals = safety.rug_signals.length > 0
    ? safety.rug_signals.map((s) => `  {#ff4444-fg}⚠  ${s}{/}`).join("\n")
    : `  {#00ff88-fg}✓  none detected{/}`;

  const x402line = safety.payment_made
    ? ` {#ffaa00-fg}⊕ x402 · $0.01 USDC · tx: ${safety.payment_tx.slice(0, 10)}...{/}\n`
    : "";

  const verdict = isSignal
    ? `\n   {#00ff88-fg}{bold}▶  SIGNAL DETECTED{/bold}{/}\n`
    : `\n   {#ff4444-fg}{bold}💀  RUG AVOIDED{/bold}{/}\n`;

  const age  = safety.deployer_age_days === 9999 ? "--" : `${safety.deployer_age_days}d`;
  const conc = safety.top_10_concentration.toFixed(1);
  const vol  = safety.volatility_24h.toFixed(1);

  box.setContent(
    `\n {bold}{#e0e0e0-fg}${name}{/bold}{/}\n` +
    ` {#555555-fg}${short} · ${pair.dex_name || "base-mainnet"}{/}\n\n` +
    ` {#555555-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}\n\n` +
    ` {#555555-fg}RISK      {/}${barTag}  {bold}${safety.spam_score}{/bold}\n` +
    ` {#555555-fg}HOLDERS   {/}{#e0e0e0-fg}${safety.holders.toLocaleString()}{/}\n` +
    ` {#555555-fg}TOP 10    {/}{#e0e0e0-fg}${conc}% conc{/}\n` +
    ` {#555555-fg}DEPLOYER  {/}{#e0e0e0-fg}${age} old{/}\n` +
    ` {#555555-fg}VOLATIL   {/}{#e0e0e0-fg}${vol}%{/}\n\n` +
    ` {#555555-fg}RUG SIGNALS:{/}\n${signals}\n\n` +
    x402line +
    ` {#555555-fg}goldrush: ${safety.fetch_time_ms}ms{/}\n` +
    ` {#555555-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}` +
    verdict
  );
  box.screen?.render();
}

// ── rug pattern alert (takeover overlay) ─────────────────────────────
let _clusterThrottleUntil = 0;

export function showClusterTakeover(
  screen: blessed.Widgets.Screen,
  pair:   NewPair,
  safety: SafetyResult
): void {
  if (safety.rug_signals.length < 2) return;
  if (Date.now() < _clusterThrottleUntil) return;
  _clusterThrottleUntil = Date.now() + 30_000; // throttle to once per 30s

  const overlay = blessed.box({
    parent: screen,
    top:    "center",
    left:   "center",
    width:  "65%",
    height: Math.min(6 + safety.rug_signals.length * 2, 20),
    tags:   true,
    border: { type: "line" },
    style: {
      bg:     C.bg,
      fg:     C.red,
      border: { fg: C.red },
      label:  { fg: C.red, bold: true },
    },
    label: " {#ff4444-fg}⚠  RUG PATTERN DETECTED{/} ",
  });

  const flags = safety.rug_signals
    .map((s) => `\n  {#ff4444-fg}⚠{/}  {#e0e0e0-fg}${s}{/}`)
    .join("");

  overlay.setContent(
    `\n  {bold}{#e0e0e0-fg}${pair.token0_symbol}/${pair.token1_symbol}{/bold}{/}` +
    `  {#555555-fg}${pair.contract.slice(0, 10)}...{/}` +
    flags +
    `\n\n  {#ff4444-fg}recommendation: DO NOT TRANSACT{/}`
  );

  screen.render();

  // Ring terminal bell
  process.stdout.write("\x07");

  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    overlay.destroy();
    screen.render();
  }, 3000);
}

// ── chart ─────────────────────────────────────────────────────────────
export function updateChart(
  sparkline: { setData: (labels: string[], data: number[][]) => void },
  history:   number[]
): void {
  if (history.length === 0) return;
  const min  = Math.min(...history);
  const max  = Math.max(...history);
  const range = max - min || 1;
  const norm  = history.map((v) => Math.round(((v - min) / range) * 100));
  sparkline.setData(
    [`min:${fmtLiq(min)}  max:${fmtLiq(max)}  cur:${fmtLiq(history[history.length - 1])}`],
    [norm]
  );
}

// ── stats bar ─────────────────────────────────────────────────────────
export interface Stats {
  analyzed:    number;
  signals:     number;
  rugsAvoided: number;
  x402Spent:   number;
  startTime:   number;
}

export function updateStats(box: blessed.Widgets.BoxElement, stats: Stats): void {
  const uptime = fmtUptime(Date.now() - stats.startTime);
  const W      = (box.screen?.width as number) ?? 100;

  const left =
    ` {#555555-fg}analyzed:{/} {#e0e0e0-fg}{bold}${stats.analyzed}{/bold}{/}` +
    `  {#555555-fg}signals:{/} {#00ff88-fg}{bold}${stats.signals}{/bold}{/}` +
    `  {#555555-fg}rugs:{/} {#ff4444-fg}{bold}${stats.rugsAvoided}{/bold}{/}`;

  const center = `{#ffaa00-fg}x402: $${stats.x402Spent.toFixed(2)} USDC{/}`;

  const right  = `{#555555-fg}uptime:{/} {#00ff88-fg}${uptime}{/} `;

  box.setContent(layoutRow(left, center, right, W));
  box.screen?.render();
}
