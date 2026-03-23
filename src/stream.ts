import { Client } from "@covalenthq/client-sdk";
// Debug logging — set DEBUG=1 to enable
const LOG = process.env.DEBUG
  ? (s: string) => process.stderr.write(new Date().toISOString() + " " + s + "\n")
  : (_s: string) => {};

export interface NewPair {
  contract: string;
  token0_symbol: string;
  token1_symbol: string;
  token0_address: string;
  token1_address: string;
  token0_contract_address: string;
  dex_name: string;
  liquidity_usd: number;
  tx_hash: string;
  created_at: string;
  block_height: number;
}

type PairCallback = (pair: NewPair) => void;
type StatusCallback = (status: "live" | "reconnecting") => void;

// Uniswap V3 PoolCreated(address,address,uint24,int24,address)
const TOPIC_V3 = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";
// Uniswap V2 / Aerodrome PairCreated(address,address,address,uint256)
const TOPIC_V2 = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9";

// Base produces ~2 blocks/second
const LOOKBACK_BLOCKS_INIT = 1000;  // ~8 min of history for initial seed
const LOOKBACK_BLOCKS_POLL = 50;    // ~25 sec of new blocks per poll
const POLL_INTERVAL_MS = 15_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getLatestBlock(client: Client): Promise<number> {
  const resp = await client.BaseService.getBlock("base-mainnet", "latest");
  return resp?.data?.items?.[0]?.height ?? 0;
}

async function fetchSymbol(client: Client, address: string): Promise<string> {
  if (!address) return "???";
  try {
    const resp = await client.PricingService.getTokenPrices(
      "base-mainnet",
      "USD",
      address
    );
    const sym = resp?.data?.[0]?.contract_ticker_symbol;
    if (sym) return sym;
  } catch { /* fall through */ }
  // Fallback: short address
  return address.slice(0, 6) + "…" + address.slice(-4);
}

async function fetchPoolsFromLogs(
  client: Client,
  startBlock: number,
  topic: string,
  isV3: boolean
): Promise<
  { pool: string; token0: string; token1: string; block: number; ts: string; tx: string }[]
> {
  const resp = await client.BaseService.getLogs("base-mainnet", {
    startingBlock: startBlock,
    endingBlock: "latest",
    topics: topic,
    skipDecode: false,
  });

  const items = resp?.data?.items ?? [];
  LOG(`getLogs(topic=${topic.slice(0, 10)}, from=${startBlock}): ${items.length} events`);

  if (items.length > 0) {
    const first = items[0];
    LOG(`  first event: block=${first.block_height} tx=${first.tx_hash?.slice(0, 10)} decoded=${JSON.stringify(first.decoded?.params?.map(p => ({ name: p.name, value: String(p.value).slice(0, 20) })))}`);
  }

  const pools: { pool: string; token0: string; token1: string; block: number; ts: string; tx: string }[] = [];

  for (const ev of items) {
    const params = ev.decoded?.params ?? [];
    if (isV3) {
      // PoolCreated(token0, token1, fee, tickSpacing, pool)
      const token0 = params.find((p) => p.name === "token0")?.value ?? params[0]?.value ?? "";
      const token1 = params.find((p) => p.name === "token1")?.value ?? params[1]?.value ?? "";
      const pool   = params.find((p) => p.name === "pool")?.value  ?? params[4]?.value ?? "";
      if (pool && token0 && token1) {
        pools.push({ pool, token0, token1, block: ev.block_height, ts: ev.block_signed_at?.toISOString() ?? new Date().toISOString(), tx: ev.tx_hash ?? "" });
      }
    } else {
      // PairCreated(token0, token1, pair, allPairsLength)
      const token0 = params.find((p) => p.name === "token0")?.value ?? params[0]?.value ?? "";
      const token1 = params.find((p) => p.name === "token1")?.value ?? params[1]?.value ?? "";
      const pool   = params.find((p) => p.name === "pair")?.value  ?? params[2]?.value ?? "";
      if (pool && token0 && token1) {
        pools.push({ pool, token0, token1, block: ev.block_height, ts: ev.block_signed_at?.toISOString() ?? new Date().toISOString(), tx: ev.tx_hash ?? "" });
      }
    }
  }

  return pools;
}

export function startPairStream(
  client: Client,
  onPair: PairCallback,
  onStatus: StatusCallback
): () => void {
  let stopped = false;
  let retryDelay = 2000;
  const seenPools = new Set<string>();
  let lastBlock = 0;
  let isFirstPoll = true;

  async function poll() {
    if (stopped) return;

    try {
      const latestBlock = await getLatestBlock(client);
      if (latestBlock === 0) throw new Error("could not get latest block");
      LOG(`latest block: ${latestBlock}`);

      const startBlock = isFirstPoll
        ? latestBlock - LOOKBACK_BLOCKS_INIT
        : Math.max(lastBlock + 1, latestBlock - LOOKBACK_BLOCKS_POLL);

      lastBlock = latestBlock;

      // Fetch V3 and V2 pair creation events in parallel
      const [v3Pools, v2Pools] = await Promise.all([
        fetchPoolsFromLogs(client, startBlock, TOPIC_V3, true).catch((e) => {
          LOG(`v3 fetchLogs error: ${e}`);
          return [];
        }),
        fetchPoolsFromLogs(client, startBlock, TOPIC_V2, false).catch((e) => {
          LOG(`v2 fetchLogs error: ${e}`);
          return [];
        }),
      ]);

      const allRaw = [...v3Pools, ...v2Pools];
      LOG(`allRaw pools: ${allRaw.length}`);

      // Dedupe by pool address and against seenPools
      const novel = allRaw.filter((p) => p.pool && !seenPools.has(p.pool));
      LOG(`novel (unseen) pools: ${novel.length}`);

      // On first poll cap at 5 for initial seed
      const toEmit = isFirstPoll ? novel.slice(-5) : novel;
      isFirstPoll = false;

      for (const p of toEmit) {
        seenPools.add(p.pool);
      }

      onStatus("live");
      retryDelay = 2000;

      // For each novel pool: resolve symbols in parallel then emit
      for (const p of toEmit) {
        if (stopped) break;

        const [sym0, sym1] = await Promise.all([
          fetchSymbol(client, p.token0),
          fetchSymbol(client, p.token1),
        ]);

        const pair: NewPair = {
          contract: p.pool,
          token0_symbol: sym0,
          token1_symbol: sym1,
          token0_address: p.token0,
          token1_address: p.token1,
          token0_contract_address: p.token0,
          dex_name: "base-mainnet",
          liquidity_usd: 0, // newly created pools start with 0 liquidity
          tx_hash: p.tx,
          created_at: p.ts,
          block_height: p.block,
        };

        LOG(`emitting pair: ${sym0}/${sym1} pool=${p.pool.slice(0, 10)}`);
        onPair(pair);
        await sleep(150);
      }
    } catch (e) {
      LOG(`poll error: ${e}`);
      if (stopped) return;
      onStatus("reconnecting");
      await sleep(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 8000);
      if (!stopped) setImmediate(poll);
      return;
    }

    if (!stopped) {
      await sleep(POLL_INTERVAL_MS);
      if (!stopped) setImmediate(poll);
    }
  }

  poll();

  return () => {
    stopped = true;
  };
}
