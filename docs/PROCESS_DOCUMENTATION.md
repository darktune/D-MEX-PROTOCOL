# D-MEX Protocol — Full System Documentation
> **Final Year Project (FYP) Technical Reference**  
> **Protocol:** D-MEX Vault V3.0 — Atomic Multi-Asset GameFi Barter  
> **Chain:** Scroll Sepolia (testnet) → Mainnet-ready architecture  
> **Date:** April 2026  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Smart Contract Layer](#3-smart-contract-layer)
4. [AI Guardian Server](#4-ai-guardian-server)
5. [Frontend Application](#5-frontend-application)
6. [Test Evidence](#6-test-evidence)
7. [Live Deployment Records](#7-live-deployment-records)
8. [Security Model](#8-security-model)
9. [Swap Execution — Step-by-Step Walkthrough](#9-swap-execution--step-by-step-walkthrough)
10. [Questions & Future Work](#10-questions--future-work)
11. [Cross-Game Asset Integration](#11-cross-game-asset-integration-sprint-6)
12. [Peer Discovery & Social Features](#12-peer-discovery--social-features-sprint-5)
13. [CS2 Steam Bridge & UGC Minting](#13-cs2-steam-bridge--ugc-minting-sprint-8)
14. [RPC Failover & Severity Scoring](#14-rpc-failover--severity-scoring-sprint-7-8)
15. [Mobile Flutter Prototype](#15-mobile-flutter-prototype-sprint-9)
16. [Demo Mode & Marketplace Persistence](#16-demo-mode--marketplace-persistence-sprint-10)

---

## 1. Project Overview

D-MEX (Decentralised Multi-Asset Exchange) is a trustless, AI-supervised atomic barter protocol designed for the GameFi and traditional gaming ecosystems. It allows two parties to atomically exchange heterogeneous digital assets — ERC-20 tokens, ERC-721 NFTs, and ERC-1155 multi-edition items — in a single on-chain transaction, with no central intermediary.

### Problem Statement

Traditional gaming economies are siloed: assets minted in-game cannot be transferred cross-game, and peer-to-peer trades rely on trust (scam risk) or centralised escrow services (custodial risk). Blockchain-native game asset markets (e.g. OpenSea, Blur) only support NFT-for-ETH swaps and are not optimised for multi-standard bundle barters.

### Solution

D-MEX introduces:

| Feature | Description |
|---|---|
| **Atomic Multi-Asset Swap** | All assets move in one transaction or none — eliminates partial-fill risk |
| **HTLC Secret-Hash Escrow** | Hash Time-Locked Contracts lock assets until the counterparty reveals a secret |
| **AI Arbiter Guardian** | Off-chain AI evaluates each swap for risk before issuing a cryptographic approval signature |
| **Psychology & Defaults Engine** | Detects behavioural biases (FOMO, Anchoring, Endowment Effect) and warns users pre-swap |
| **Peg-Defense Dynamic Tax** | Protocol-applied exit tax (variable basis points) to suppress value-drain spirals |
| **Anti-Spiral Circuit Breaker** | Guardian can halt all swaps in a market crash scenario |
| **Yul (Inline Assembly) Transfers** | Gas-optimised ERC-20 `transferFrom` paths; ~2,000 gas saved per transfer |
| **UUPS Upgradeable Proxy** | Allows guardian key rotation and logic upgrades without contract migration |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            USER BROWSER                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  D-MEX Frontend (HTML/CSS/JS — glassmorphic GameFi UI)               │  │
│  │  • Propose Intent tab  • Open Market tab  • Analytics Dashboard       │  │
│  │  • Profile modal (live on-chain data)  • Guardian AI Settings         │  │
│  └───────────────────────┬──────────────┬────────────────────────────────┘  │
│                          │  MetaMask /  │  ethers.js v6                      │
│                          │  Direct RPC  │                                    │
└──────────────────────────┼──────────────┼────────────────────────────────────┘
                           │              │
          HTTP REST + WS   │              │ JSON-RPC (eth_call, eth_sendRawTx)
                           ▼              ▼
        ┌──────────────────────────────────────────────────────────────┐
        │              D-MEX AI Guardian Server (Node.js)              │
        │  Express HTTP  •  WebSocket broadcast  •  ethers.js reads   │
        │                                                              │
        │  POST /api/evaluate  ─── DMEXArbiter.evaluateAndSignSwap()  │
        │  POST /api/sign      ─── Arbiter ECDSA signing              │
        │  GET  /api/portfolio ─── On-chain balance + event history    │
        │  GET  /api/analytics ─── In-memory risk score stream        │
        │  POST /api/settings  ─── Psychology mode toggle             │
        │  WS broadcast        ─── Real-time evaluation push          │
        └──────────────────────────────────────────────────────────────┘
                           │
         JSON-RPC reads    │  eth_getLogs, balanceOf, ownerOf
                           ▼
        ┌──────────────────────────────────────────────────────────────┐
        │          Scroll Sepolia L2 (Chain ID: 534351)                │
        │                                                              │
        │  ┌──────────────────────────────────────────────────────┐   │
        │  │   DMEXVault (UUPS Proxy)  0x39b845...28f0            │   │
        │  │   ├─ commitSwap()  — lock assets into HTLC escrow    │   │
        │  │   ├─ executeSwap() — Arbiter-signed atomic release   │   │
        │  │   └─ refundSwap()  — initiator recovery after expiry │   │
        │  └──────────────────────────────────────────────────────┘   │
        │                                                              │
        │  GameCurrency (ERC-20)  • GameAssetUnique (ERC-721)         │
        │  GameCommodity (ERC-1155) — mock game asset contracts        │
        └──────────────────────────────────────────────────────────────┘
```

### Data Flow for a Swap

```
1. User fills Propose Intent form (offer/receive assets + amounts)
   ↓
2. Frontend calls Guardian POST /api/evaluate (pre-flight risk check)
   ↓
3. Guardian's DMEXArbiter scores risk; returns riskScore + decision + psych warnings
   ↓
4. If approved: Frontend calls ERC-20/721/1155 approve(), then DMEXVault.commitSwap()
   ↓
5. Assets locked in vault. Frontend shows expiry timer.
   ↓
6. Counterparty calls executeSwap(secret, arbiterPayload, aiSignature)
   ↓
7. Vault verifies: secret hash, Arbiter ECDSA signature, expiry, anti-spiral halt
   ↓
8. If all pass: assets atomically transferred. Guardian broadcasts WS evaluation event.
   ↓
9. Frontend re-reads balances. Analytics tab updates in real-time.
```

---

## 3. Smart Contract Layer

### 3.1 `DMEXVault.sol` (315 LOC)

The core protocol contract. Key data structures and functions:

```solidity
struct Asset {
    AssetType assetType;  // ERC20=0, ERC721=1, ERC1155=2
    address token;
    uint256 id;           // token ID for ERC-721/1155
    uint256 amount;       // amount for ERC-20/1155
}

struct SwapIntent {
    address initiator;
    address counterparty;
    uint256 expiry;
    bytes32 secretHash;   // sha256 hash of the HTLC secret
    Asset[] myAssets;
    Asset[] wantedAssets;
    bool isExecuted;
    bool isRefunded;
    bool isActive;
}

struct ArbiterPayload {
    uint8  riskScore;        // 0-100
    uint256 dynamicTaxBps;  // 0-10000 (Peg-Defense exit tax)
    bool   isSpiralHalt;    // Anti-Spiral circuit breaker
}
```

**Security mechanisms:**

| Mechanism | Implementation |
|---|---|
| Reentrancy Guard | EIP-1153 Transient Storage (`tstore`/`tload`) — auto-resets per TX |
| HTLC Secret Hash | `sha256` of secret stored at commit; verified at execute |
| Arbiter Signature | ECDSA: `keccak256(swapId, riskScore, taxBps, spiralHalt)` signed by guardian |
| CEI Pattern | All checks and state mutations precede external asset transfers |
| Peg-Defense Tax | ERC-20 exit tax deducted and routed to `protocolTreasury` |
| Anti-Spiral Halt | `isSpiralHalt=true` reverts before any state change |
| UUPS Upgrade | Owner can upgrade logic and rotate guardian key |

### 3.2 `MockGameAssets.sol` (49 LOC)

Three test token standards used for all local and testnet deployments:

| Contract | Standard | Name/Symbol |
|---|---|---|
| `GameCurrency` | ERC-20 | DGLD (Gold), USDC (mock) |
| `GameAssetUnique` | ERC-721 | NFT Sword (auto-incrementing ID) |
| `GameCommodity` | ERC-1155 | Wood/Commodity (ID #1) |

### 3.3 `UniversalVault.sol` (214 LOC) — Legacy

Earlier architecture with `FairValueGuard.sol` (Chainlink Functions consumer). Kept for reference; `DMEXVault.sol` supersedes it for the V3 protocol.

---

## 4. AI Guardian Server

### 4.1 Architecture (`guardian/guardian.js`)

Node.js Express server with four subsystems:

```
guardian.js
├── Express HTTP server        — serves frontend + API endpoints
├── WebSocket server (ws)      — real-time analytics push to browser
├── DMEXArbiter instance       — risk scoring engine
└── ethers.js JsonRpcProvider  — read-only on-chain queries
```

### 4.2 Risk Scoring — `DMEXArbiter` (`arbiter.js`)

The Arbiter evaluates each swap across four attack node axes:

| Node | Axis | Weight | Detection |
|---|---|---|---|
| **L1** | Value Drain | 35% | Offer/want ratio > threshold |
| **L2** | Reentrancy Attempt | 20% | On-chain: EIP-1153 handles; AI monitors |
| **L3** | Metadata Fraud | 20% | `metadataHash` mismatch / known fraud patterns |
| **A3** | Sybil / Wash Trade | 25% | Identical offer/want assets; rapid-repeat trading |

**Composite risk score** = L1×0.35 + L2×0.20 + L3×0.20 + A3×0.25

Decision threshold: score < 50 → `approve`, score ≥ 50 → `reject`

### 4.3 Peg-Defense & Tax Automation (De-pegging Logic)

The Guardian monitors the stability of native game currencies (like DGLD) against their intended peg ($0.10). 

**Mechanism:**
1. **Detection**: If the currency value drops below the `DEPEG_THRESHOLD` (e.g., $0.08), the Arbiter identifies a "De-pegging Event."
2. **Taxation**: The Arbiter automatically calculates a `dynamicTaxBps` (Basis Points) to be applied to all exit trades (sellers).
3. **Prevention**: This tax discourages panic-selling and routes "defense fees" to the protocol treasury, which can be used to buy back the currency and restore the peg.
4. **Circuit Breaker**: In extreme cases where volatility exceeds 20%, the `Anti-Spiral Circuit Breaker` (A3 Node) can halt all outgoing swaps entirely to preserve system integrity.

*Note: For the FYP demonstration, these parameters are active in the code logic but the "live crash" simulation is disabled to ensure a stable presentation environment. The logic remains fully documented and verifiable via the audit trail.*

### 4.3 Psychology & Defaults Engine

When enabled (default: ON), the Guardian applies four heuristic checks before every swap:

| Bias | Detection Condition | Warning Severity |
|---|---|---|
| **Endowment Effect** | Offer value > 2.5× wanted value | Warning |
| **Loss Aversion** | Commitment > $100 equivalent | Caution |
| **Anchoring Bias** | Round-number offers ≥ 1,000 units | Info |
| **FOMO / Urgency** | ≥ 3 trades submitted in 5 minutes | Warning |

Warnings are returned in the `/api/evaluate` response and displayed as an AI intervention modal before the user can proceed.

### 4.4 WebSocket Real-Time Push

Every `/api/evaluate` call triggers a WebSocket broadcast to all connected browser clients:

```json
{
  "type": "evaluation",
  "data": {
    "timestamp": "2026-04-10T14:22:10.000Z",
    "tradeId": "0x8776...",
    "score": 12,
    "riskLevel": "low",
    "decision": "approve",
    "attackNodes": { "l1": 8, "l2": 1, "l3": 4, "a3": 5 },
    "psychWarnings": []
  },
  "analytics": { "total": 7, "approved": 6, "rejected": 1, "avgRisk": 18 }
}
```

The Analytics dashboard receives this event and updates KPIs, the risk score line chart, and the evaluation history table in real-time — without polling.

---

## 5. Frontend Application

### 5.1 Tech Stack

| Layer | Technology |
|---|---|
| UI | HTML5, Vanilla CSS (glassmorphism, CSS variables) |
| JavaScript | ethers.js v6 (browser ESM build) |
| Charts | Canvas API (custom donut + line chart — no Chart.js dependency) |
| Transport | Fetch API (HTTP) + WebSocket API |
| Fonts | Google Fonts — Outfit, Courier New |

### 5.2 Tabs & Views

| Tab | Function |
|---|---|
| **Propose Intent** | Asset selector dropdowns, amount input, submit swap, heuristic AI banner |
| **Open Market** | Live order cards showing all active swap intents with Scrollscan links |
| **Analytics** | KPI counters, donut chart (approve/reject), risk score line chart, evaluation table, attack node bars, AI intervention feed |

### 5.3 Wallet Connection Flow

```
1. Click "Connect MetaMask"
   → eth_requestAccounts via window.ethereum
   → Auto-switch to Scroll Sepolia (chain_id: 0x82750)
   → If MetaMask fails: user clicks "Use Direct RPC"
      → ethers.JsonRpcProvider + burner Wallet (testnet only)

2. On connection: read 3 on-chain balances (ERC-20, ERC-721, ERC-1155)
3. Profile modal: fetch /api/portfolio/:address — live on-chain data
4. WebSocket: auto-connect to Guardian for live analytics push
```

---

## 6. Test Evidence

### 6.1 Full Test Suite Summary

```
Ran 3 test suites:
  DMEXVaultInvariant.t.sol  — 5 stateful invariants, 640,000 calls total
  DMEXVault.t.sol           — 7 tests (2 unit + 5 fuzz × 5,000 runs each)
  UniversalVault.t.sol      — 2 tests (1 fuzz × 5,000 run + 1 unit)

Result: 14 tests passed, 0 failed, 0 skipped
```

### 6.2 Invariant Test Results (`DMEXVaultInvariant.t.sol`)

Each invariant ran **256 sequences of 500 calls** (128,000 total calls per invariant).

| Invariant | Property Tested | Result |
|---|---|---|
| `invariant_vaultSolvency` | Vault balance ≥ all locked ghost amounts | ✅ 128,000 calls |
| `invariant_noDoubleFinalization` | `isExecuted` XOR `isRefunded` forever | ✅ 128,000 calls |
| `invariant_executedSwapIsIrreversible` | Once executed, `isRefunded` stays false | ✅ 128,000 calls |
| `invariant_activeSwapHasInitiator` | Every active swap has non-zero initiator | ✅ 128,000 calls |
| `invariant_swapExpiryIsNonZero` | Committed swap always has non-zero expiry | ✅ 128,000 calls |

### 6.3 Fuzz Test Results (`DMEXVault.t.sol`)

| Test | Attack / Property | Runs | Result |
|---|---|---|---|
| `test_barter_with_peg_defense` | 5% exit tax routed to treasury correctly | 1 | ✅ |
| `test_spiral_halt_revert` | `isSpiralHalt=true` reverts before state change | 1 | ✅ |
| `testFuzz_SignatureReplay` | Signature from swapId₁ rejected on swapId₂ | 5,000 | ✅ |
| `testFuzz_AtomicExecution` | Random amounts → exact final balances, vault=0 | 5,000 | ✅ |
| `testFuzz_RefundAfterExpiry` | Initiator recovers exact amount after expiry | 5,000 | ✅ |
| `testFuzz_MultiAssetBundleAtomicity` | ERC-20+ERC-721+ERC-1155 atomic; vault holds 0 residual | 5,000 | ✅ |

### 6.4 Gas Profiling

| Function | Min Gas | Avg Gas | Max Gas | Notes |
|---|---|---|---|---|
| `commitSwap` | 282,739 | 295,709 | 444,366 | Max with 3-standard bundle |
| `executeSwap` | 20,254 | 83,302 | 305,259 | Min = validation revert path |
| `refundSwap` | 37,900 | 37,900 | 37,900 | Constant — single path |
| Multi-asset bundle | — | ~431,225 | — | ERC-20 + ERC-721 + ERC-1155 combined |

All operations are within Scroll L2's 30M gas block limit.

---

## 7. Live Deployment Records

### 7.1 Deployed Contract Addresses (Scroll Sepolia)

| Contract | Address | Standard |
|---|---|---|
| **DGLD (Gold ERC-20)** | `0x789755ed4930b37372e9E838AdbF4280CDE7A576` | ERC-20 |
| **NFT Sword (ERC-721)** | `0xdd2C163C8E0005deF0B1e70c93dF708998Be9bce` | ERC-721 |
| **Commodity (ERC-1155)** | `0xA62561F571c27c9c17D44fBCB6a931Ea55da594c` | ERC-1155 |
| **Vault Implementation** | `0x7C3D4Ce6FACae8F359000daa90378fF9b74D7bf2` | UUPS Logic |
| **Vault Proxy** | `0x39b845162051b643f0E883ef3F3382a0164528f0` | ERC1967 Proxy |
| **Deployer** | `0x64923E0ea77bA1Aeb5844a9FC041C26265CB2637` | EOA |

### 7.2 Verified Live Transaction

| Field | Value |
|---|---|
| **Tx Hash** | `0x352eedacb59fde3...b390` |
| **Block** | 17,389,813 |
| **Gas Used** | 324,901 |
| **Action** | `commitSwap` — 100 DGLD locked for NFT Sword |
| **Explorer** | https://sepolia.scrollscan.com/tx/0x352eedacb59fde3... |
| **Post-Balance** | DGLD: 99,900 (100 deducted to escrow) |

### 7.3 Deployment Command Reference

```bash
# Deploy with Foundry broadcast (Scroll Sepolia)
forge script script/Deploy.s.sol \
  --rpc-url https://sepolia-rpc.scroll.io \
  --broadcast \
  --private-key $DEPLOYER_KEY \
  -vvvv

# Start Guardian server
cd guardian && node guardian.js

# Run full test suite
forge test -vv

# Run invariant tests only (256 sequences, 500 calls each)
forge test --match-contract DMEXVaultInvariant -vv

# Run fuzz tests with custom runs
forge test --match-test "testFuzz" --fuzz-runs 5000 -vv
```

---

## 8. Security Model

### 8.1 Threat Model (7-Layer Defence)

```
Attack Surface         Layer   Mechanism
──────────────────────────────────────────────────────────────────────
Reentrancy            L1    EIP-1153 Transient Storage (tstore/tload)
HTLC secret theft     L2    sha256 hash pre-image binding per swap
Unauthorised execute  L3    Arbiter ECDSA signature (per-swap, non-replayable)
Value drain           L4    Peg-Defense dynamic exit tax (0–100%)
Market manipulation   L5    Anti-Spiral circuit breaker (isSpiralHalt)
Logic vulnerabilities L6    UUPS Upgradeable Proxy + OpenZeppelin
State corruption      L7    Checks-Effects-Interactions pattern throughout
```

### 8.2 Reentrancy Guard (EIP-1153 Transient Storage)

```solidity
modifier nonReentrantTransient() {
    assembly {
        if tload(0) { mstore(0x00, 0x3ee5aeb5); revert(0x1c, 0x04) }
        tstore(0, 1)
    }
    _;
    assembly { tstore(0, 0) }
}
```

Uses `TSTORE`/`TLOAD` opcodes (EIP-1153, live on Ethereum/Scroll post-Cancun). Unlike storage-based reentrancy guards, transient storage resets automatically at the end of every transaction — eliminating the risk of lock-state persistence bugs and saving ~5,000 gas on cold slot writes.

### 8.3 Signature Non-Replayability

The Arbiter signature commits to `(swapId, riskScore, dynamicTaxBps, isSpiralHalt)`. Each `swapId` is a freshly generated `keccak256(randomBytes(32))`. A signature from swap A **cannot** be used on swap B — verified by `testFuzz_SignatureReplay` (5,000 runs, 0 counterexamples).

### 8.4 Known Risks & Mitigations

| Risk | Severity | Status |
|---|---|---|
| Arbiter key compromise | 🔴 Critical | `setGuardianSigner()` allows key rotation; recommend multi-sig |
| `isActive=true` after execute | 🟡 Medium | `isExecuted=true` prevents re-execution; invariant-tested safe |
| Chainlink oracle staleness | 🟡 Medium | FairValueGuard: `stalenessTolerance=1h`; stale prices revert |
| ERC-20 non-standard return | 🟡 Medium | Yul paths check `success`; all deployed tokens are standard-compliant |
| `dynamicTaxBps` > 10000 | 🟢 Low | Would underflow; Guardian validates off-chain before signing |
| Front-running executeSwap | 🟢 Low | Only `counterparty` can call; non-counterparty calls revert |

---

## 9. Swap Execution — Step-by-Step Walkthrough

### Phase 1: System Initialisation

```
[SYS] Vault Initialized...
[AI]  zkML Threat Matrix: OK
```

The frontend loads. The DMEXVault UUPS proxy (`0x39b845...28f0`) is live on Scroll Sepolia. The Guardian's zkML threat detector shows no active attack nodes.

### Phase 2: Wallet Connection

```
[WALLET] Trying MetaMask...
[WALLET] MetaMask failed: wallet must have at least one account
[WALLET] Falling back to Direct RPC...
[WALLET] Connecting via Direct RPC to Scroll Sepolia...
[WALLET] Direct RPC connected: 0x6492...2637
[CHAIN]  Scroll Sepolia (534351)
```

MetaMask connection attempted. On failure, the frontend automatically falls back to a Direct RPC connection using `ethers.JsonRpcProvider` with the testnet deployer wallet — no user action required.

### Phase 3: Balance Fetch

```
[BALANCE] DGLD: 100000.0 | NFTs: 1 | Commodities: 500
```

Live balances read directly from the three deployed token contracts via `balanceOf()`.

### Phase 4: AI Pre-Evaluation

Before submitting to the chain, the frontend calls `POST /api/evaluate`:

```json
Request:
{
  "tradeId": "0x8776...",
  "assetsOffered": [{ "type": "ERC-20", "amount": "100" }],
  "assetsWanted":  [{ "type": "ERC-721", "amount": "1"  }],
  "offerValue": 10.0,
  "wantedValue": 5.0
}

Response:
{
  "approved": true,
  "riskScore": 12,
  "riskLevel": "low",
  "decision": "approve",
  "attackNodes": { "l1": 8, "l2": 1, "l3": 2, "a3": 4 },
  "psychWarnings": []
}
```

### Phase 5: Allowance Check & commitSwap

```
[TX] Checking DGLD allowance...
[TX] Submitting commitSwap to Vault...
[TX] Broadcast: 0x352e...b390
[TX] ✓ Mined in block 17389813 (Gas: 324,901)
[VAULT] SwapId: 0x8776...fadb
```

The `commitSwap` function:
1. Validates swap uniqueness (`swapId` not already used)
2. Records `initiator`, `counterparty`, `expiry`, `secretHash`
3. Transfers offered assets into the vault (via Yul-optimised `transferFrom`)
4. Emits `SwapCommitted(swapId, initiator, counterparty)`

### Phase 6: Counterparty Execution

The counterparty calls `executeSwap(swapId, secret, arbiterPayload, aiSignature)`:

1. **HTLC check:** `sha256(secret) == secretHash`
2. **Arbiter check:** ECDSA recover from signature matches `guardianSigner`
3. **Anti-Spiral:** Revert if `isSpiralHalt=true`
4. **CEI:** All state sets (`isExecuted=true`, `isActive=true`) before transfers
5. **Asset transfers:** Atomic cross-transfer using Yul batch loops

### Phase 7: Post-Execution

```
[BALANCE] DGLD: 99900.0 | NFTs: 1 | Commodities: 500
[AI] Guardian: score=12, decision=approve
[WS] Analytics updated — total=1, approved=1, avgRisk=12
```

Balance deduction confirmed. Analytics tab updates in real-time via WebSocket broadcast.

---

## 10. Questions & Future Work

### 10.1 Profile Metrics Not Updating After Transactions

**Root cause:** The profile modal showed hardcoded HTML values. The fix (implemented in Sprint 2) connects the modal to `GET /api/portfolio/:address`, which reads live on-chain data:
- `ERC20.balanceOf()` — DGLD balance
- `ERC721.balanceOf()` — NFT sword count
- `ERC1155.balanceOf(addr, 0)` — commodity count
- `provider.getBalance()` — native ETH balance
- `vaultContract.queryFilter(TradeProposed)` — swap history → reputation score

The profile now updates dynamically on every modal open.

### 10.2 Mobile & Desktop Application (PWA / Electron)

**Mobile (PWA):** The current frontend is already mobile-responsive (CSS flexbox/grid). Adding a `manifest.json` and service worker converts it into a **Progressive Web App (PWA)** installable on iOS/Android — no App Store required.

**Desktop (Electron):** Wrapping the frontend in an Electron shell produces a native Windows/macOS/Linux application. The Guardian server would run as a background process spawned by Electron.

**Recommended path:** PWA first (zero build overhead), then Electron for an offline-capable desktop release.

### 10.3 Product Variants

Based on the core D-MEX Vault architecture, the protocol can be extended into three distinct product variants:

**Variant 1: Shared Global Order Book Integration**  
Instead of relying solely on peer-to-peer OTC intent links, user market listings can be pooled into a **Shared Global Order Book** (similar to the Reservoir protocol or 0x). 
- **Mechanism:** Makers sign off-chain intents (using EIP-712). These are indexed by a decentralized relayer network. Takers can browse the global order book and fill these intents. 
- **AI integration:** The Guardian Risk Engine scores the matched intent *just before* it is submitted to the Scroll L2 sequencer, ensuring global liquidity remains safe from value-drain attacks.

**Variant 2: Bittensor Decentralized AI (TAO)**  
Currently, the AI Guardian runs on a centralized Node.js server. By integrating with a **Bittensor (TAO) Subnet**, the risk computation and database become fully decentralized.
- **Mechanism:** When a swap is proposed, the intent is broadcast to a dedicated Bittensor L2 subnet. Miners on the subnet independently calculate the L1/L2/L3 risk scores and run the psychology heuristics. 
- **Consensus:** A subnet validator aggregates the scores. If consensus is reached, a threshold signature (or securely aggregated Arbiter signature) is produced. This removes the single point of failure (the `guardianSigner` private key) and makes the AI completely censorship-resistant.

**Variant 3: Native Mobile Application Ecosystem**  
Transforming the glassmorphic web UI into a fully native mobile application (iOS/Android) connected to the smart contracts.
- **Mechanism:** Utilizing React Native or Flutter, leveraging `web3dart` or `viem` for mobile wallet connection.
- **Dual Connection Strategy:** The mobile app will support a hybrid wallet connection approach:
  1. **Local Private Key Import:** Used primarily for testnet prototyping. A burner key is stored securely in the device enclave for zero-friction interaction without jumping between apps.
  2. **WalletConnect v2:** Used for mainnet production. The user scans a QR code or deep-links directly to the MetaMask mobile app to sign off on swap intents securely.
- **UX Parallels:** This version acts as a mobile GameFi Asset Marketplace (combining the UI aesthetics of modern apps like Robinhood with the asset depth of OpenSea/Sketchfab), sending push notifications when the Guardian detects severe psych warnings or when a barter clears.

### 10.4 Uses for Psychology & Defaults Mode

The Psychology & Defaults engine has real utility beyond user protection:

| Use Case | Mechanism |
|---|---|
| **Regulatory compliance** | "Treating Customers Fairly" (FCA rules) — documented bias detection |
| **Research data** | Bias frequency analytics reveal market manipulation patterns |
| **Exchange operator settings** | A marketplace can enforce stricter defaults (e.g. always warn on >50% portfolio commitment) |
| **MEV / front-run protection** | FOMO detection slows down rapid re-trading that exploits gas fee races |
| **Responsible gambling parallels** | Same heuristics used by regulated gambling platforms for harm reduction |

### 10.5 Existing Game Asset Marketplaces & Price Feed Sources

**Existing platforms:**

| Platform | Type | Notes |
|---|---|---|
| **Immutable X** | Layer 2 (StarkEx) — GameFi NFT marketplace | Fortnite/Gods Unchained assets; gas-free trades |
| **Fractal** | Solana-based gaming NFT market | Focus on AAA gaming studios |
| **OpenSea / Blur** | General NFT | Supports game assets but not optimised for bundles |
| **Enjin Marketplace** | ERC-1155 focused | Designed for game items (multi-edition assets) |
| **DMarket** | Traditional gaming | CS:GO, Rust, Dota 2 skins — centralised but large |
| **WAX (Worldwide Asset eXchange)** | Purpose-built blockchain for gaming | Atomic Assets standard (similar to ERC-1155) |

**Open price feed sources:**

| Source | Data | Access |
|---|---|---|
| **Chainlink Price Feeds** | ETH/USD, ERC-20 pairs | On-chain; free read via `latestRoundData()` |
| **DMarket Public API** | Real CS:GO / Rust skin prices | REST API; free tier |
| **OpenSea API** | NFT floor prices, collection stats | REST; freemium |
| **CryptoSlam** | GameFi NFT sales volume | Public API |
| **Reservoir API** | Aggregated NFT market depth | Free tier; supports Scroll |
| **GeckoTerminal / CoinGecko** | DeFi token prices | Free API; high rate limit |

**Recommended approach for D-MEX:** Use Chainlink Functions (already integrated in `FairValueGuard.sol`) to fetch DMarket/OpenSea floor prices off-chain and push them on-chain as reference prices. The Guardian's `evaluateAndSignSwap()` then uses this data for L1 (value drain) scoring — creating a fully data-driven, real-time fair-value enforcement layer.

---

*Documentation generated: April 2026 | D-MEX Protocol V3.0 | Scroll Sepolia*

---

## 11. Cross-Game Asset Integration (Sprint 6)

D-MEX supports cross-game asset barter by mapping real blockchain game contracts to the protocol's multi-standard swap engine.

| Game | Standard | Contract | Assets |
|---|---|---|---|
| **Loot** | ERC-721 | `LootMock` | Adventurer Gear bags |
| **Gods Unchained** | ERC-1155 | `GodsUnchainedMock` | Trading cards |
| **CryptoKitties** | ERC-721 | `CryptoKittiesMock` | Collectible cats |
| **CS2** | Simulated | Steam Bridge | Weapon skins |

Mock contracts in `contracts/mocks/MockGameAssets.sol`. 50 mock traders with diversified portfolios.

---

## 12. Peer Discovery & Social Features (Sprint 5)

Marketplace Peer Discovery tab with trader grid, reputation scores, and "Negotiate" buttons. Real-time WebSocket chat widget with in-chat calculator, asset preview, and swap shortcut. Friends List tracking historical swap partners with trust scores.

---

## 13. CS2 Steam Bridge & UGC Minting (Sprint 8)

CS2 Bridge simulates Steam inventory sync. UGC Upload-to-Mint modal for custom asset creation and NFT minting.

---

## 14. RPC Failover & Severity Scoring (Sprint 7-8)

Multi-RPC failover with exponential backoff. Guardian returns severity levels (LOW/MEDIUM/HIGH/CRITICAL) alongside numeric risk scores.

---

## 15. Mobile Flutter Prototype (Sprint 9)

6-screen Flutter mobile prototype: Propose Intent, Market, Analytics, Risk Breakdown, Cyber Arbiter, Portfolio Settings. Dark glassmorphic theme.

---

## 16. Demo Mode & Marketplace Persistence (Sprint 10)

Demo Mode seeds 50 traders. Persistence merges sessionStorage with Guardian API via renderMarketplace().

---

*Documentation updated: April 28, 2026 | D-MEX Protocol V3.0 | Scroll Sepolia*

