# D-MEX Protocol — Changelog

All notable changes to the D-MEX Protocol are documented here, organized by development sprint.

---

## Sprint 11 — Security Hardening, ERC-8213/ERC-7730 & BattleChain (May 13, 2026)

### Added
- **ERC-7730 Clear Signing** (`contracts/core/ERC7730Descriptor.sol`) — On-chain registry for human-readable transaction descriptors. Wallets display "Lock Assets Into Swap" instead of raw hex calldata
- **ERC-7730 JSON Descriptor** (`erc7730/dmex-vault-descriptor.json`) — Off-chain JSON metadata for the ERC-7730 public registry, covering all 6 DMEXVault functions with Ledger screen flows
- **ERC-8213 Digest Display** (`contracts/core/ERC8213DigestDisplay.sol`) — Calldata digest verification using EIP-712 structured data. Users verify transaction integrity on a separate device before signing on hardware wallet
- **BattleChain Deployment Script** (`script/DeployBattleChain.s.sol`) — Full deployment script for Cyfrin's adversarial testing environment (Chain ID: 627), deploys vault + ERC-7730 + ERC-8213 in one transaction
- **BattleChain Config** — Added `battlechain` RPC endpoint and etherscan config to `foundry.toml`
- **Admin Events** — `GuardianSignerUpdated`, `TreasuryUpdated`, `PriceFeedUpdated` events now emitted on all state-changing admin functions for off-chain monitoring
- **ERC-721 Safe Receiver** — `onERC721Received()` handler added to DMEXVault for safe NFT transfer compatibility

### Security Fixes (23 findings from full audit)
- 🔴 **[C-1] Private Key Exposure** — Removed hardcoded Guardian private key from `guardian.js` and `check.js`. Key now required via `GUARDIAN_KEY` environment variable
- 🔴 **[C-2] Treasury Drain Prevention** — Added `dynamicTaxBps <= 1000` cap (max 10%) to prevent Guardian from redirecting 100% of assets to treasury
- 🔴 **[C-3] Signature Malleability** — Added EIP-2 `s` value range check and `v` value validation to `_validateArbiterSignature()`
- 🟠 **[H-1] DoS Prevention** — Added `myAssets.length <= 20` and `wantedAssets.length <= 20` bundle size limits to prevent gas exhaustion attacks
- 🟠 **[H-3] Zero-Address Guards** — `setGuardianSigner()` and `setTreasury()` now reject `address(0)`

### Changed
- `foundry.toml` — Added `battlechain` RPC endpoint and etherscan verification config
- `.env` — Added `BATTLECHAIN_RPC_URL`, `BATTLECHAIN_API_KEY`, and key rotation warning
- `DMEXVault.sol` — 7 security patches applied (see Security Fixes above)
- `guardian.js` — Private key now required from environment; crashes on startup if missing
- `check.js` — Private key now required from environment

---

## Sprint 10 — UI Polish & Severity Scoring (April 23–28, 2026)

### Added
- **Marketplace Persistence** — Assets synced from external platforms (Steam CS2 and UGC mints) now persist in the marketplace by merging local vault data with live Guardian API listings
- **Demo Mode Stability** — Resolved disappearing assets issue, ensuring demo-seeded data remains visible throughout presentation
- **Frontend Interactivity Fixes** — Debugged and restored wallet connection, swap proposal, and sidebar interactions that had become unresponsive

### Fixed
- Fixed `renderMarketplace()` to merge local sessionStorage vault data with live `/api/listings` response
- Resolved event listener conflicts causing UI freeze on modal open
- Fixed CSS z-index layering for Guardian sidebar overlapping marketplace cards

---

## Sprint 9 — Mobile Flutter Prototype (April 21–22, 2026)

### Added
- **Flutter Mobile App** (`mobile/`) — Complete glassmorphic mobile prototype with 6 screens:
  - `propose_intent_screen.dart` — Asset selector & swap submission
  - `market_screen.dart` — Live marketplace grid
  - `analytics_screen.dart` — KPI dashboard
  - `risk_breakdown_screen.dart` — Attack vector visualization
  - `cyber_arbiter_screen.dart` — Guardian AI monitor
  - `portfolio_settings_screen.dart` — User profile & settings
- **Bottom Navigation** (`bottom_nav.dart`) — iOS 26-inspired glassmorphic tab bar
- **App Theme** (`app_theme.dart`) — Unified dark theme with neon accent palette
- **Mobile Testing Guide** (`MOBILE_TESTING_GUIDE.md`) — Zero-install, web, and native emulator paths

---

## Sprint 8 — Arbiter Severity Scoring & CS2 Bridge (April 20–21, 2026)

### Added
- **Severity Scoring** — Guardian evaluation API now returns severity levels (Low/Medium/High/Critical) alongside numeric risk scores
- **CS2 Steam Bridge Simulation** — Mock Steam inventory sync that imports CS2 weapon skins into the D-MEX marketplace
- **UGC Upload-to-Mint Modal** — 3D asset simulation modal for user-generated content minting
- **Wallet Connection Comparative Modal** — Shows trade-offs between MetaMask and Direct RPC connection

### Changed
- Updated Arbiter Guardian analytics dashboard with dynamic data binding
- Refined asset marketplace iconography for unified iOS 26 glassmorphic design

---

## Sprint 7 — RPC Failover & Network Resilience (April 16–18, 2026)

### Added
- **Automatic RPC Failover** — Both frontend and Guardian server now cycle through multiple Scroll Sepolia RPC endpoints on failure
- **Connection Health Monitor** — Real-time RPC status indicator in the frontend header

### Fixed
- Resolved persistent "Failed to fetch" errors caused by single-RPC dependency
- Added retry logic with exponential backoff for all `eth_call` and `eth_sendRawTransaction` calls
- Fixed WebSocket reconnection on Guardian server restart

---

## Sprint 6 — Cross-Game Asset Integration (April 18–19, 2026)

### Added
- **50 Mock Traders** — Populated marketplace with diverse trader profiles and history
- **Cross-Game Assets** — Added real-world blockchain game contract mappings:
  - Loot (for Adventurers) — ERC-721
  - Gods Unchained Cards — ERC-1155
  - CryptoKitties — ERC-721
  - CS2 Weapon Skins — simulated via Steam Bridge
- **Mock Contracts** — `LootMock`, `GodsUnchainedMock`, `CryptoKittiesMock` added to `MockGameAssets.sol`
- **Asset Filters** — Searchable, filterable marketplace with holder profiles and monetary valuations

---

## Sprint 5 — Peer Discovery & Social Features (April 11–12, 2026)

### Added
- **Peer Discovery Tab** — Trader discovery grid with profile cards and reputation scores
- **Negotiation Chat Widget** — Real-time WebSocket-based messaging between traders
- **Friends List** — Historical swap tracking and past interaction records
- **In-Chat Calculator** — Utility calculator for negotiation and pricing operations

---

## Sprint 4 — Chainlink Oracle & Security Fixes (April 7–10, 2026)

### Added
- **Chainlink Fair Value Oracle** (`fairValueOracle.js`) — Integrates Chainlink Price Feeds and Reservoir API for real-time asset valuation
- **Analytics History Restore** — Analytics tab now fetches `/api/analytics` data on tab switch

### Fixed
- **`isActive=false` on Finalization** — Both `executeSwap()` and `refundSwap()` now explicitly set `isActive=false`, enabling EIP-3529 gas refund
- **SafeERC20 Yul Return-Value Fix** — Both Yul transfer paths now check `success AND (returndatasize==0 OR returned_word==true)` to handle USDT-style tokens

---

## Sprint 3 — Process Documentation & Bundle Testing (April 2026)

### Added
- **Process Documentation** (`PROCESS_DOCUMENTATION.md`) — Comprehensive FYP technical reference
- **Multi-Asset Bundle Fuzz Test** (`testFuzz_MultiAssetBundleAtomicity`) — 5,000 runs verifying 3-standard atomic swaps (ERC-20 + ERC-721 + ERC-1155)

---

## Sprint 2 — Guardian Server & Profile Integration (April 2026)

### Added
- **Guardian HTTP Server** (`guardian.js`) — Express server with WebSocket broadcast
- **Arbiter Engine** (`arbiter.js`) — 4-axis risk scoring (Value Drain, Reentrancy, Metadata Fraud, Sybil/Wash)
- **Profile Modal Live Data** — `GET /api/portfolio/:address` returns live on-chain balances and reputation
- **Psychology & Defaults Engine** — Detects Endowment Effect, Loss Aversion, Anchoring, and FOMO biases
- **WebSocket Real-Time Push** — Every evaluation broadcasts analytics to all connected clients

---

## Sprint 1 — Core Protocol (March–April 2026)

### Added
- **DMEXVault.sol** (315 LOC) — Core atomic swap vault with HTLC escrow, Peg-Defense tax, Anti-Spiral circuit breaker
- **MockGameAssets.sol** — GameCurrency (ERC-20), GameAssetUnique (ERC-721), GameCommodity (ERC-1155)
- **UniversalVault.sol** (Legacy) — Earlier architecture with FairValueGuard integration
- **FairValueGuard.sol** — Chainlink Functions consumer for on-chain fair-trade valuation
- **UUPS Proxy Deployment** — ERC1967 proxy pattern with `_disableInitializers()`
- **EIP-1153 Reentrancy Guard** — Transient storage-based lock (Cancun EVM)
- **5 Stateful Invariant Tests** — 640,000 random call sequences, 0 violations
- **7 Fuzz + Unit Tests** — Signature replay, atomic execution, refund, peg-defense, spiral halt, multi-asset bundle
- **Frontend** — Glassmorphic GameFi UI with Propose Intent, Open Market, and Analytics tabs
- **Live Deployment** — Deployed to Scroll Sepolia with verified `commitSwap` transaction

---

*D-MEX Protocol V3.0 — April 2026*
