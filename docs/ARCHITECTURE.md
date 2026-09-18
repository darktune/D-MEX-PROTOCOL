# D-MEX Protocol — System Architecture

> Deep-dive technical reference for the D-MEX Protocol architecture.

---

## 1. High-Level Component Diagram

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT LAYER                                       │
│                                                                               │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐          │
│  │   Web Frontend (PWA)        │    │   Flutter Mobile App         │          │
│  │   HTML/CSS/JS + ethers.js   │    │   Dart + web3dart            │          │
│  │   • Marketplace             │    │   • Marketplace              │          │
│  │   • Swap Propose            │    │   • Swap Propose             │          │
│  │   • Analytics Dashboard     │    │   • Risk Breakdown           │          │
│  │   • Peer Discovery/Chat     │    │   • Cyber Arbiter            │          │
│  │   • Friends List            │    │   • Portfolio/Settings       │          │
│  └──────────┬──────────────────┘    └──────────┬──────────────────┘          │
│             │                                   │                             │
└─────────────┼───────────────────────────────────┼─────────────────────────────┘
              │ HTTP REST + WebSocket              │ HTTP REST
              ▼                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                          MIDDLEWARE LAYER                                      │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                  AI Guardian Server (Node.js)                           │  │
│  │                                                                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │  │
│  │  │  Express API  │  │  DMEXArbiter │  │  FairValue   │  │  WebSocket│  │  │
│  │  │              │  │  (Risk Score) │  │  Oracle      │  │  Broadcast│  │  │
│  │  │ /api/evaluate│  │  L1: Drain   │  │  Chainlink   │  │  Real-time│  │  │
│  │  │ /api/sign    │  │  L2: Reentry │  │  Reservoir   │  │  Analytics│  │  │
│  │  │ /api/portfolio│ │  L3: Fraud   │  │  OpenSea     │  │  Events   │  │  │
│  │  │ /api/analytics│ │  A3: Sybil   │  │  DMarket     │  │           │  │  │
│  │  │ /api/settings│  │  Psychology  │  │              │  │           │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └───────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                          │
└────────────────────────────────────┼──────────────────────────────────────────┘
                                     │ JSON-RPC (ethers.js v6)
                                     ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                        BLOCKCHAIN LAYER                                       │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │              Scroll Sepolia L2 (Chain ID: 534351)                       │  │
│  │              BattleChain (Chain ID: 627) — Adversarial Testing           │  │
│  │                                                                         │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │  │
│  │  │   DMEXVault (UUPS Proxy)  0x39b845...28f0                      │   │  │
│  │  │   ┌───────────────┐ ┌───────────────┐ ┌────────────────┐      │   │  │
│  │  │   │ commitSwap()  │ │ executeSwap() │ │ refundSwap()   │      │   │  │
│  │  │   │ Lock → HTLC   │ │ Arbiter+HTLC  │ │ After expiry   │      │   │  │
│  │  │   └───────────────┘ └───────────────┘ └────────────────┘      │   │  │
│  │  │   Security: EIP-1153 TStore | ECDSA+EIP-2 | Peg-Defense | CEI│   │  │
│  │  └─────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                         │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │ ERC7730Descriptor — Clear Signing Registry (human-readable tx)  │  │  │
│  │  │ ERC8213DigestDisplay — Calldata Digest Verification (EIP-712)   │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐     │  │
│  │  │ GameCurrency  │  │ GameAsset    │  │ GameCommodity            │     │  │
│  │  │ ERC-20 (DGLD) │  │ ERC-721 (NFT)│  │ ERC-1155 (Multi-edition)│     │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘     │  │
│  │                                                                         │  │
│  │  Cross-Game Mocks: LootMock | CryptoKittiesMock | GodsUnchainedMock   │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow — Complete Swap Lifecycle

```
Phase 1: Discovery & Negotiation
────────────────────────────────
  User A browses Marketplace → finds asset held by User B
  User A opens Peer Discovery → views User B's profile & reputation
  User A initiates Chat → negotiates terms with User B
  Both parties agree on: assets to exchange, values, timing

Phase 2: Pre-Flight Risk Evaluation
────────────────────────────────────
  Frontend → POST /api/evaluate
  {
    tradeId, assetsOffered, assetsWanted, offerValue, wantedValue
  }
  
  Guardian:
    1. DMEXArbiter.evaluateAndSignSwap()
       → L1 (Value Drain):    offer/want ratio check     (35% weight)
       → L2 (Reentrancy):     contract analysis           (20% weight)
       → L3 (Metadata Fraud): URI / creator verification  (20% weight)
       → A3 (Sybil/Wash):     wallet history analysis     (25% weight)
    2. Psychology Engine
       → Endowment Effect:   offer > 2.5× wanted?
       → Loss Aversion:      commitment > $100?
       → Anchoring:          round-number ≥ 1,000?
       → FOMO:               ≥ 3 trades in 5 minutes?
    3. Return: { approved, riskScore, riskLevel, attackNodes, psychWarnings }
    4. WebSocket broadcast → all connected clients update analytics

Phase 3: Asset Commitment (HTLC Lock)
──────────────────────────────────────
  Frontend: ERC-20/721/1155.approve(vault, amount)
  Frontend → DMEXVault.commitSwap(swapId, counterparty, expiry, secretHash, myAssets, wantedAssets)
  
  On-chain:
    1. Validate: swapId not used, expiry > now
    2. Store: Swap struct (initiator, counterparty, expiry, secretHash)
    3. Store: initiatorBundles[swapId], counterpartyBundles[swapId]
    4. Transfer: Yul-optimised _batchTransferIn() → assets locked in vault
    5. Emit: SwapCommitted(swapId, initiator, counterparty)

Phase 4: Counterparty Execution
───────────────────────────────
  Counterparty → POST /api/sign (get Arbiter signature)
  Counterparty → DMEXVault.executeSwap(swapId, secret, payload, signature)
  
  On-chain verification stack:
    1. require(isActive && !isExecuted && !isRefunded)
    2. require(block.timestamp <= expiry)
    3. require(msg.sender == counterparty)
    4. HTLC:   sha256(secret) == secretHash
    5. ECDSA:  ecrecover(signature) == guardianSigner
    6. Guard:  payload.riskScore < 50
    7. Guard:  !payload.isSpiralHalt (else → revert circuit breaker)
    8. CEI:    isExecuted=true, isActive=false
    9. Tax:    if dynamicTaxBps > 0 → deduct & route to treasury
   10. Transfer: _batchTransferIn(counterparty assets)
   11. Transfer: _batchTransferOut(initiator assets → counterparty)
   12. Transfer: _batchTransferOut(counterparty assets → initiator)
   13. Emit: SwapExecuted(swapId, taxCollected)

Phase 5: Post-Execution
────────────────────────
  Frontend: re-reads balances via balanceOf() calls
  Guardian: WebSocket broadcast → analytics update
  Both profiles: reputation score incremented
```

---

## 3. Contract Architecture

### 3.1 Inheritance & Dependency Graph

```
                    ┌──────────────────────┐
                    │  Initializable (OZ)   │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │  UUPSUpgradeable (OZ) │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │ OwnableUpgradeable    │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │    DMEXVault.sol      │ ← Core V3.1 Protocol
                    │  (330 LOC, UUPS)     │
                    └──────────────────────┘

    ┌───────────────────┐     ┌───────────────────┐
    │ ERC7730Descriptor │     │ ERC8213Digest     │
    │ (Clear Signing)   │     │ (Digest Display)  │
    └───────────────────┘     └───────────────────┘


    ┌───────────────────┐     ┌───────────────────┐
    │ FunctionsClient   │     │ AggregatorV3      │
    │ (Chainlink mock)  │     │ Interface          │
    └────────┬──────────┘     └────────┬──────────┘
             │                         │
    ┌────────┴─────────────────────────┴──────────┐
    │           FairValueGuard.sol                  │
    │      (Chainlink oracle consumer)              │
    └────────────────────┬────────────────────────┘
                         │
    ┌────────────────────┴────────────────────────┐
    │          UniversalVault.sol (Legacy)          │
    │    (ReentrancyGuard, ECDSA, Yul batch)       │
    └──────────────────────────────────────────────┘
```

### 3.2 Storage Layout (DMEXVault)

| Slot | Variable | Type |
|---|---|---|
| Proxy | `_implementation` | `address` (ERC1967) |
| Proxy | `_admin` | `address` (ERC1967) |
| 0 | `_initialized` | `uint64` (Initializable) |
| 1 | `_owner` | `address` (OwnableUpgradeable) |
| 2 | `swaps` | `mapping(bytes32 => Swap)` |
| 3 | `initiatorBundles` | `mapping(bytes32 => Asset[])` |
| 4 | `counterpartyBundles` | `mapping(bytes32 => Asset[])` |
| 5 | `priceFeeds` | `mapping(address => address)` |
| 6 | `guardianSigner` | `address` |
| 7 | `protocolTreasury` | `address` |

---

## 4. API Reference

### Guardian Server Endpoints

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/evaluate` | Pre-flight risk evaluation | None |
| `POST` | `/api/sign` | Arbiter ECDSA signature | None |
| `GET` | `/api/portfolio/:address` | On-chain portfolio data | None |
| `GET` | `/api/analytics` | Aggregated risk analytics | None |
| `POST` | `/api/settings` | Update psychology mode | None |
| `GET` | `/api/listings` | Active marketplace listings | None |
| `WS` | `ws://host:3001` | Real-time evaluation events | None |

### WebSocket Event Schema

```json
{
  "type": "evaluation",
  "data": {
    "timestamp": "2026-04-10T14:22:10.000Z",
    "tradeId": "0x8776...",
    "score": 12,
    "riskLevel": "low",
    "severity": "LOW",
    "decision": "approve",
    "attackNodes": { "l1": 8, "l2": 1, "l3": 4, "a3": 5 },
    "psychWarnings": []
  },
  "analytics": {
    "total": 7,
    "approved": 6,
    "rejected": 1,
    "avgRisk": 18
  }
}
```

---

## 5. Cross-Game Asset Mapping

| Game | Token Standard | Mock Contract | D-MEX Asset Type |
|---|---|---|---|
| **D-MEX Native** | ERC-20 | `GameCurrency` (DGLD) | Currency |
| **D-MEX Native** | ERC-721 | `GameAssetUnique` (Swords) | Unique Item |
| **D-MEX Native** | ERC-1155 | `GameCommodity` (Wood/Iron) | Commodity |
| **Loot** | ERC-721 | `LootMock` | Adventurer Gear |
| **CryptoKitties** | ERC-721 | `CryptoKittiesMock` | Collectible |
| **Gods Unchained** | ERC-1155 | `GodsUnchainedMock` | Trading Cards |
| **CS2** | Simulated | Steam Bridge API | Weapon Skins |

---

## 6. Security Architecture

### 7-Layer Defence-in-Depth

```
Layer   Mechanism                          Attack Vector Defended
─────   ─────────────────────────────────  ───────────────────────
  L1    EIP-1153 Transient Storage Lock    Reentrancy
  L2    sha256 HTLC Secret Hash            Secret Leakage
  L3    Arbiter ECDSA (per-swap)           Unauthorized Execution
  L4    EIP-2 Signature Malleability       Signature Replay (s-value)
  L5    Peg-Defense Dynamic Tax (≤10%)     Value Drain Spirals
  L6    Anti-Spiral Circuit Breaker        Market Manipulation
  L7    UUPS Upgradeable Proxy (OZ)        Protocol Evolution
  L8    Checks-Effects-Interactions        State Corruption
  L9    ERC-7730 Clear Signing             Transaction Misrepresentation
  L10   ERC-8213 Calldata Digest           Hardware Wallet Phishing
```

### Risk Scoring Model

```
Composite Score = L1×0.35 + L2×0.20 + L3×0.20 + A3×0.25

Decision:
  score < 50  → APPROVE (Guardian signs)
  score ≥ 50  → REJECT  (no signature issued)

Severity Mapping:
  0–19   → LOW      (Green)
  20–39  → MEDIUM   (Yellow)
  40–59  → HIGH     (Orange)
  60–100 → CRITICAL (Red)
```

---

*Architecture Document — D-MEX Protocol V3.1 (Security Hardened), May 2026*
