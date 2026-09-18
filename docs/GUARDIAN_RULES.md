# DMEX Guardian Rules: The Utmost Priority Protocol

*Generated for the Universal Vault Architecture (Q3 2026)*

## Core Philosophy: Security is Paramount
The ultimate goal of this project is a flawless, mathematically immune "Escrow Standard" for digital ownership exchange. 

**Rule Zero:** The Solidity Smart Contract limits what the system *can* do. The AI Guardian limits what the system *should* do. AI functions are **not paramount** to the Solidity contract. They are supportive. The AI must never be able to override cryptographic guarantees, bypass Pull-Payment locks, or execute arbitary code logic. Security is evaluated based on **Context, Impact, and Time** — preventing hacks is the irreversible bottleneck that commands utmost priority.

---

## 🛡️ Node L1: Value Drain Detection
**Goal:** Prevent unauthorized extraction of assets beyond the intended swap parameters.
- **Paramount Solidity Guard:** `msg.sender` checks. Only the initiator can refund. Only the counterparty can execute. `_batchTransferYul` must have strict bounds checks before pointer manipulation.
- **AI Support Constraint:** The AI must simulate the swap locally and compare `Vault.balanceOf(asset)` pre and post-swap. If `Value(post) < ExpectedValue(post)`, the AI flags an L1 Drain Attempt.

## 🔒 Node L2: Reentrancy Exploitation
**Goal:** Prevent cross-function recursion manipulating the escrow pipeline.
- **Paramount Solidity Guard:** Implement `nonReentrant` modifiers (Checks-Effects-Interactions) across `commitSwap`, `executeSwap`, and `refundSwap`. All state updates must happen **before** external calls (transfers).
- **AI Support Constraint:** The AI strictly analyzes external token contracts in the `wantedAssets`/`myAssets` arrays. If the contract has malicious fallback logic or `selfdestruct` hooks, tag as L2 Risk.

## 📜 Node L3: Metadata Fraud
**Goal:** Prevent attackers from swapping a "Fake Sword" with identical images to the "Real Sword".
- **Paramount Solidity Guard:** Enforce an exact `assetContract` match in the `executeSwap` loop against the committed `wantedAssets`.
- **AI Support Constraint:** The AI Guardian runs off-chain metadata scraping on ERC-721/1155 URIs. If the asset matches visually but originates from an unauthorized creator address, flag as L3 Fraud and reject the execution signature.

## 🚨 Node A3: Sybil Pumping & Wash Trading
**Goal:** Prevent fake volume from inflating asset valuations to bypass fair-trade checks.
- **Paramount Solidity Guard:** The Contract simply accepts numerical valuations passed by a Chainlink-signed payload (or a `FairValueGuard.sol`).
- **AI Support Constraint:** The Guardian acts as the Chainlink Function oracle. It checks the specific wallet's history across the network. If 90% of a skin's trading volume comes from a small cluster of interconnected wallets, the AI classifies the market as "Sybil Pumped" and applies a hard "Exit Tax" or outright swap rejection logic depending on user settings.

---

*These rules must be referenced during the active audit phase of the UniversalVault.sol implementation.*
