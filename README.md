# tempo-goldrush-agent

The first real-world agent using **MPP (Machine Payments Protocol)** to pay for onchain intelligence autonomously.

Built on:
- **Tempo MPP** — agent pays for each GoldRush query automatically via Tempo blockchain
- **GoldRush** — real-time token streaming + safety intelligence
- **mppx** — handles the 402 → authorize → pay → retry flow

---

## What It Does

An autonomous agent that opens an MPP session on Tempo, pays **$0.01 USDC per GoldRush safety check**, signals safe tokens, and blocks rugs. All autonomously — no human in the loop.

Token launches on Base mainnet are the data source. **Tempo MPP is the story.**

---

## How MPP Works Here

```
1. Agent streams new pairs via GoldRush
2. For each pair: calls GoldRush safety endpoint
3. GoldRush returns HTTP 402 with Tempo payment challenge
4. mppx auto-authorizes from agent's Tempo wallet
5. Payment settles instantly on Tempo blockchain
6. GoldRush returns safety intelligence + MPP receipt
7. Agent signals or blocks based on result
```

MPP Sessions primitive — authorize once, pre-deposit funds, stream micropayments per call automatically. No separate on-chain transaction per API call. Think: OAuth for payments. Thousands of calls aggregate into one settlement.

---

## Quick Start

```bash
npm install
cp .env.example .env
# Add GOLDRUSH_API_KEY + TEMPO_WALLET_KEY
npm start
```

---

## Environment

| Variable | Required | Description |
|---|---|---|
| `GOLDRUSH_API_KEY` | yes | Covalent GoldRush API key |
| `TEMPO_WALLET_KEY` | for MPP | Agent wallet private key (0x-prefixed) |
| `MPP_MODE` | no | `true` to enable Tempo MPP micropayments |
| `TEMPO_TESTNET` | no | `true` to use pathUSD on Tempo testnet |
| `TEMPO_SESSION_LIMIT` | no | Max USDC authorized per session (default: 1.00) |

---

## Cost

**$0.01 USDC per safety check** via Tempo MPP session.

Sessions aggregate thousands of micropayments into one settlement — internet-scale pay-per-use intelligence for autonomous agents.

---

## Stack

- TypeScript + tsx
- GoldRush SDK (`@covalenthq/client-sdk`) — streaming + safety data
- mppx — MPP client, handles 402 challenge → pay → retry
- blessed + blessed-contrib — terminal dashboard UI
- viem — wallet client for Tempo MPP authorization

---

## Architecture

```
[Tempo MPP Agent]
    ↓ opens session · pre-authorizes USDC on Tempo chain
[GoldRush stream.ts]
    ↓ streams token launches (Base mainnet, every 15s)
[index.ts queue]
    ↓ sequential analysis per pair
[safety.ts analyzeSafety()]
    ├─ parallel: holders, spam, price, deployer age (GoldRush SDK)
    └─ MPP: mppx.fetch() → 402 challenge → Tempo pay → receipt
[display.ts]
    └─ terminal dashboard: feed table, scanner panel, mpp stats
```

---

## The Story

This is not a tool running on Base.

**MPP is the payment layer. Tempo is the settlement chain. GoldRush is the intelligence being paid for. Base is where the tokens launch.**

Every GoldRush API call in MPP mode is a live demonstration of machine-to-machine micropayments — an agent autonomously authorizing, paying, and receiving premium data without any human interaction. That is the x402 successor in production.
