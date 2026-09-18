# D-MEX Protocol

> **Decentralised Multi-Asset Exchange** — Trustless, AI-Supervised Atomic Barter for GameFi & Beyond

[![Solidity](https://img.shields.io/badge/Solidity-0.8.27-363636?logo=solidity)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Built_with-Foundry-FFDB1C?logo=ethereum)](https://getfoundry.sh/)
[![Chain](https://img.shields.io/badge/Scroll_Sepolia-534351-EB7106)](https://sepolia.scrollscan.com/)
[![BattleChain](https://img.shields.io/badge/BattleChain-Ready-ff4444)](https://battlechain.com/)
[![Tests](https://img.shields.io/badge/Tests-14_passed,_0_failed-brightgreen)]()
[![Security](https://img.shields.io/badge/Audit-23_findings,_all_fixed-blue)](docs/AUDIT.md)
[![License](https://img.shields.io/badge/License-MIT-blue)]()

---

## Overview

D-MEX is a **trustless atomic barter protocol** that enables two parties to exchange heterogeneous digital assets — **ERC-20 tokens, ERC-721 NFTs, and ERC-1155 multi-edition items** — in a single on-chain transaction. An AI-powered **Guardian Arbiter** evaluates every swap for risk, behavioural biases, and market manipulation before issuing a cryptographic approval signature.

### Key Features

| Feature | Description |
|---|---|
| **Atomic Multi-Asset Swap** | All assets transfer in one TX, or none — zero partial-fill risk |
| **HTLC Escrow** | Hash Time-Locked Contracts protect assets until counterparty reveals a secret |
| **AI Arbiter Guardian** | Off-chain AI scores every swap across 4 attack vectors before signing |
| **ERC-7730 Clear Signing** | Human-readable transaction descriptions for hardware wallets (Ledger, MetaMask) |
| **ERC-8213 Digest Display** | 32-byte calldata digest verification for enterprise signers on separate devices |
| **Psychology Engine** | Detects FOMO, anchoring, endowment, and loss aversion biases |
| **Peg-Defense Tax** | Dynamic exit tax (max 10%) to suppress value-drain spirals |
| **Anti-Spiral Circuit Breaker** | Guardian can halt all swaps during market panic |
| **Cross-Game Assets** | Trade across Loot, Gods Unchained, CryptoKitties, CS2 ecosystems |
| **Yul-Optimised Transfers** | ~2,000 gas saved per ERC-20 transfer via inline assembly |
| **UUPS Upgradeable** | Guardian key rotation and logic upgrades without contract migration |
| **BattleChain Ready** | Pre-mainnet adversarial testing via Cyfrin's BattleChain (Chain ID: 627) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER BROWSER / MOBILE                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  D-MEX Frontend (HTML/CSS/JS — Glassmorphic GameFi UI)    │  │
│  │  • Marketplace  • Swap Propose  • Analytics  • Chat       │  │
│  └─────────────┬──────────────────┬──────────────────────────┘  │
│                │ HTTP + WebSocket  │ ethers.js v6                 │
└────────────────┼──────────────────┼──────────────────────────────┘
                 │                  │
                 ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│              D-MEX AI Guardian Server (Node.js)                  │
│  POST /api/evaluate  — Risk scoring & psychology checks          │
│  POST /api/sign      — ECDSA arbiter signature                   │
│  GET  /api/portfolio — On-chain balance & reputation             │
│  WS broadcast        — Real-time analytics push                  │
└────────────────────────┬─────────────────────────────────────────┘
                         │ JSON-RPC
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│           Scroll Sepolia L2 (Chain ID: 534351)                   │
│  DMEXVault (UUPS Proxy)  0x39b845...28f0                        │
│  ├─ commitSwap()   — Lock assets into HTLC escrow               │
│  ├─ executeSwap()  — Arbiter-signed atomic release               │
│  └─ refundSwap()   — Initiator recovery after expiry             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
D_MEX PROTOCOL/
├── contracts/                 # Solidity smart contracts
│   ├── core/                  #   DMEXVault.sol, UniversalVault.sol, ERC7730Descriptor.sol, ERC8213DigestDisplay.sol
│   ├── mocks/                 #   MockGameAssets.sol (ERC-20/721/1155)
│   ├── oracles/               #   FairValueGuard.sol (Chainlink consumer)
│   └── interfaces/            #   ChainlinkInterfaces.sol
├── erc7730/                   # ERC-7730 off-chain JSON descriptors
│   └── dmex-vault-descriptor.json
├── test/                      # Foundry tests (unit, fuzz, invariant)
├── script/                    # Foundry deploy scripts (Scroll Sepolia + BattleChain)
├── frontend/                  # Web frontend (HTML/CSS/JS, PWA)
├── guardian/                  # AI Guardian server (Node.js/Express/WS)
├── mobile/                    # Flutter mobile prototype
├── docs/                      # Full documentation suite
│   ├── PROCESS_DOCUMENTATION.md
│   ├── AUDIT.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── TESTING.md
│   ├── GUARDIAN_RULES.md
│   └── design/                # UI/UX design mockups
├── assets/                    # Screenshots & recordings
├── foundry.toml               # Foundry configuration (Scroll + BattleChain)
└── README.md                  # ← You are here
```

---

## Quick Start

### Prerequisites

- [Foundry](https://getfoundry.sh/) (for smart contracts)
- [Node.js ≥ 18](https://nodejs.org/) (for Guardian server)
- [MetaMask](https://metamask.io/) browser extension (optional)

### 1. Clone & Install

```bash
git clone <repo-url>
cd D_MEX\ PROTOCOL

# Install OpenZeppelin dependencies
npm install

# Install Guardian dependencies
cd guardian && npm install && cd ..
```

### 2. Build & Test Smart Contracts

```bash
# Compile all contracts
forge build

# Run full test suite (14 tests: unit + fuzz + invariant)
forge test -vv

# Run only invariant tests (640,000 random call sequences)
forge test --match-contract DMEXVaultInvariant -vv

# Run only fuzz tests with 5,000 runs each
forge test --match-test "testFuzz" -vv
```

### 3. Start the Guardian Server

```bash
cd guardian
cp ../.env .env   # Ensure RPC URL and private key are set
node guardian.js
# → Server starts on http://localhost:3001
# → WebSocket on ws://localhost:3001
```

### 4. Open the Frontend

```bash
# The Guardian serves the frontend as static files
# Navigate to http://localhost:3001 in your browser
```

---

## Deployed Contracts (Scroll Sepolia)

| Contract | Address |
|---|---|
| **DGLD (ERC-20)** | `0x789755ed4930b37372e9E838AdbF4280CDE7A576` |
| **NFT Sword (ERC-721)** | `0xdd2C163C8E0005deF0B1e70c93dF708998Be9bce` |
| **Commodity (ERC-1155)** | `0xA62561F571c27c9c17D44fBCB6a931Ea55da594c` |
| **Vault Proxy** | `0x39b845162051b643f0E883ef3F3382a0164528f0` |
| **Vault Logic** | `0x7C3D4Ce6FACae8F359000daa90378fF9b74D7bf2` |

---

## Test Results Summary

| Suite | Tests | Type | Result |
|---|---|---|---|
| `DMEXVault.t.sol` | 7 | Unit + Fuzz (5,000 runs each) | ✅ All passed |
| `DMEXVaultInvariant.t.sol` | 5 | Stateful Invariant (640,000 calls) | ✅ All passed |
| `UniversalVault.t.sol` | 2 | Legacy Fuzz | ✅ All passed |
| **Total** | **14** | | **0 failures** |

---

## Documentation

| Document | Description |
|---|---|
| [Process Documentation](docs/PROCESS_DOCUMENTATION.md) | Full FYP technical reference |
| [Security Audit](docs/AUDIT.md) | 23-finding security audit + invariant & fuzz test results |
| [Architecture](docs/ARCHITECTURE.md) | System architecture deep-dive + ERC-7730/8213 integration |
| [Deployment Guide](docs/DEPLOYMENT.md) | Step-by-step deployment for Scroll Sepolia + BattleChain |
| [Testing Guide](docs/TESTING.md) | Test strategy & verification plan |
| [Guardian Rules](docs/GUARDIAN_RULES.md) | AI Guardian security philosophy |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.27, OpenZeppelin 5.6, Foundry |
| Security Standards | ERC-7730 (Clear Signing), ERC-8213 (Digest Display), EIP-2, EIP-1153 |
| Chain | Scroll Sepolia L2 (EVM Cancun) + BattleChain (Chain ID: 627) |
| Backend | Node.js, Express, ethers.js v6, WebSocket |
| Frontend | HTML5, Vanilla CSS (glassmorphism), Canvas API |
| Mobile | Flutter / Dart |
| Testing | Foundry Fuzz + Invariant (640K+ calls) |

---

## Security

The protocol implements a **10-layer defence-in-depth** model:

1. **L1** — EIP-1153 Transient Storage reentrancy guard
2. **L2** — HTLC `sha256` secret hash binding
3. **L3** — Arbiter ECDSA signature (per-swap, non-replayable)
4. **L4** — EIP-2 signature malleability protection (`s` value range + `v` validation)
5. **L5** — Peg-Defense dynamic exit tax (capped at 10%)
6. **L6** — Anti-Spiral circuit breaker
7. **L7** — UUPS upgradeable proxy (OpenZeppelin)
8. **L8** — Checks-Effects-Interactions pattern
9. **L9** — ERC-7730 Clear Signing (human-readable transaction verification)
10. **L10** — ERC-8213 Calldata Digest Display (independent digest verification)

See [docs/AUDIT.md](docs/AUDIT.md) for the complete security audit report (23 findings, all patched).

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

*D-MEX Protocol V3.1 — Security Hardened Edition, May 2026*
