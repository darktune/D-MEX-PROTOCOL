# D-MEX Protocol — Deployment Guide

> Step-by-step instructions for deploying the D-MEX Protocol to local, testnet, and BattleChain environments.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [Foundry](https://getfoundry.sh/) | Latest | Smart contract compilation, testing, deployment |
| [Node.js](https://nodejs.org/) | ≥ 18.x | Guardian server runtime |
| [MetaMask](https://metamask.io/) | Latest | Browser wallet (optional — Direct RPC fallback available) |
| [Git](https://git-scm.com/) | Latest | Version control |

### Optional (Mobile)
| Tool | Version | Purpose |
|---|---|---|
| [Flutter](https://flutter.dev/) | ≥ 3.x | Mobile prototype |
| [Android Studio](https://developer.android.com/studio) | Latest | Android emulator |

---

## 1. Environment Setup

### 1.1 Clone Repository

```bash
git clone <repo-url>
cd D_MEX\ PROTOCOL
```

### 1.2 Install Dependencies

```bash
# Root: OpenZeppelin contracts for Foundry
npm install

# Guardian: Express, ethers.js, ws, etc.
cd guardian && npm install && cd ..
```

### 1.3 Environment Variables

Create a `.env` file in the project root:

```env
# Required: Scroll Sepolia RPC URL
SCROLL_RPC_URL=https://sepolia-rpc.scroll.io

# Required: Deployer private key (testnet only!)
PRIVATE_KEY=0x<your-testnet-private-key>

# Optional: Scrollscan API key for verification
SCROLLSCAN_API_KEY=<your-api-key>

# Optional: Alternative RPC endpoints for failover
SCROLL_RPC_URL_2=https://scroll-sepolia.blockpi.network/v1/rpc/public
SCROLL_RPC_URL_3=https://rpc.ankr.com/scroll_sepolia_testnet

# BattleChain Deployment (Cyfrin adversarial testing, Chain ID: 627)
BATTLECHAIN_RPC_URL=<get-from-battlechain-dashboard>
BATTLECHAIN_API_KEY=<for-contract-verification>

# Guardian Server (required for backend)
GUARDIAN_KEY=0x<your-guardian-private-key>
```

> ⚠️ **NEVER commit private keys to git.** The `.env` file is already in `.gitignore`.
> 
> 🚨 **CRITICAL:** The Guardian private key must ONLY come from environment variables. Never hardcode keys in source files. Use `cast wallet import` for encrypted keystores.

---

## 2. Smart Contract Deployment

### 2.1 Local Testing (Anvil)

```bash
# Start local Ethereum node (Cancun EVM)
anvil --hardfork cancun

# In a new terminal:
forge script script/DMEXDeploy.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key $ANVIL_PRIVATE_KEY \
  -vvvv
```

### 2.2 Scroll Sepolia Testnet

```bash
# Load environment variables
source .env  # Linux/Mac
# or set manually on Windows

# Deploy all contracts (Vault + Mock Assets + Proxy)
forge script script/DMEXDeploy.s.sol \
  --rpc-url $SCROLL_RPC_URL \
  --broadcast \
  --private-key $PRIVATE_KEY \
  -vvvv

# Verify on Scrollscan (optional)
forge verify-contract <VAULT_ADDRESS> contracts/core/DMEXVault.sol:DMEXVault \
  --chain-id 534351 \
  --etherscan-api-key $SCROLLSCAN_API_KEY
```

### 2.3 Post-Deployment Checklist

After deployment, note the contract addresses printed in the console:

```
--- Mock Assets Deployed ---
DGLD Address:       0x...
NFT Sword Address:  0x...
Commodity Address:  0x...

--- Vault Logic Deployed ---
Implementation Address: 0x...

--- Vault Proxy Deployed ---
Proxy Address (Use this to interact!): 0x...
```

Update these addresses in:
- `frontend/app.js` — contract address constants
- `frontend/vault-abi.js` — if ABI has changed
- `guardian/guardian.js` — vault address for on-chain reads

---

## 3. Guardian Server

### 3.1 Configuration

The Guardian reads from the root `.env` file. Key variables:

```env
GUARDIAN_KEY=0x...         # Guardian signer key (MUST be set — no fallback!)
SCROLL_RPC_URL=https://... # Scroll Sepolia RPC
VAULT_PROXY=0x...          # Vault proxy address
PORT=3001                  # Server port (default: 3001)
```

> 🚨 **Sprint 11 Security Fix:** The Guardian now crashes on startup if `GUARDIAN_KEY` is not set. This prevents accidental use of any exposed default key.

### 3.2 Starting the Server

```bash
cd guardian
node guardian.js
```

Expected output:
```
[Guardian] Express server listening on http://localhost:3001
[Guardian] WebSocket server ready
[Guardian] Connected to Scroll Sepolia (534351)
[Guardian] Arbiter signer: 0x6492...2637
```

### 3.3 Verifying API Endpoints

```bash
# Health check
curl http://localhost:3001/api/analytics

# Test evaluation
curl -X POST http://localhost:3001/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "tradeId": "0xtest",
    "assetsOffered": [{"type": "ERC-20", "amount": "100"}],
    "assetsWanted": [{"type": "ERC-721", "amount": "1"}],
    "offerValue": 10.0,
    "wantedValue": 5.0
  }'
```

---

## 4. Frontend

### 4.1 Served via Guardian

The Guardian's Express server automatically serves the `frontend/` directory as static files:

```
http://localhost:3001        → index.html
http://localhost:3001/app.js → app.js
```

### 4.2 Standalone (without Guardian)

For UI-only development, you can serve the frontend with any static file server:

```bash
cd frontend
npx serve .
# → Available at http://localhost:3000
```

> Note: Without the Guardian, API calls will fail. The frontend falls back gracefully with demo data.

### 4.3 PWA Installation

The frontend includes `manifest.json` and `sw.js` for Progressive Web App support:
- **Mobile**: Open in Chrome/Safari → "Add to Home Screen"
- **Desktop**: Chrome → ⋮ → "Install D-MEX Protocol"

---

## 5. Mobile Prototype

### 5.1 Quick Test (Browser)

```bash
# No Flutter SDK needed — run in browser sandbox
# Visit https://zapp.run/ and paste the code from mobile/lib/
```

### 5.2 Flutter Development

```bash
cd mobile
flutter pub get
flutter run -d chrome        # Web preview
flutter run -d windows       # Desktop preview
flutter run                  # Connected device/emulator
```

See [mobile/MOBILE_TESTING_GUIDE.md](../mobile/MOBILE_TESTING_GUIDE.md) for detailed testing instructions.

---

## 6. Deployed Contract Addresses (Scroll Sepolia)

| Contract | Address | Standard |
|---|---|---|
| **DGLD (Gold)** | `0x789755ed4930b37372e9E838AdbF4280CDE7A576` | ERC-20 |
| **NFT Sword** | `0xdd2C163C8E0005deF0B1e70c93dF708998Be9bce` | ERC-721 |
| **Commodity** | `0xA62561F571c27c9c17D44fBCB6a931Ea55da594c` | ERC-1155 |
| **Vault Implementation** | `0x7C3D4Ce6FACae8F359000daa90378fF9b74D7bf2` | UUPS Logic |
| **Vault Proxy** | `0x39b845162051b643f0E883ef3F3382a0164528f0` | ERC1967 Proxy |
| **Deployer** | `0x64923E0ea77bA1Aeb5844a9FC041C26265CB2637` | EOA |

---

## 7. BattleChain Deployment (Adversarial Testing)

BattleChain is Cyfrin's pre-mainnet adversarial testing environment (Chain ID: **627**).

### 7.1 Create Encrypted Keystore

```bash
# Generate a FRESH wallet — never reuse the exposed testnet key
cast wallet import battlechain --interactive
```

### 7.2 Deploy Full Suite

```bash
forge script script/DeployBattleChain.s.sol \
  --rpc-url battlechain \
  --account battlechain \
  --broadcast \
  --verify \
  -vvvv
```

This deploys: DMEXVault (UUPS proxy), ERC-7730 Clear Signing Registry, ERC-8213 Digest Display, and all mock game assets.

### 7.3 Post-Deployment

1. Update `guardian.js` and `vault-abi.js` with new contract addresses
2. Create a **Safe Harbor agreement** on the BattleChain dashboard
3. Request **Attack Mode** for adversarial stress testing
4. Start the Guardian server with the new vault address

### 7.4 Safe Harbor Setup

1. Go to [battlechain.com/dashboard](https://battlechain.com/dashboard)
2. Click "Create Safe Harbor" → set contract address, bounty %, recovery address
3. Submit and sign the agreement on-chain

---

## 8. Security Standards Deployment

### 8.1 ERC-7730 (Clear Signing)

Deployed automatically by `DeployBattleChain.s.sol`. The on-chain registry stores human-readable function descriptors. The off-chain JSON descriptor is at `erc7730/dmex-vault-descriptor.json`.

### 8.2 ERC-8213 (Digest Display)

Deployed automatically. Users call `computeCommitSwapDigest()` or `computeExecuteSwapDigest()` to generate a 32-byte verification digest before signing on a hardware wallet.

---

## 9. Troubleshooting

| Issue | Solution |
|---|---|
| `forge build` fails | Run `npm install` to install OpenZeppelin. Ensure `foundry.toml` has correct `src` and `libs` paths. |
| Guardian crashes on startup | Ensure `GUARDIAN_KEY` environment variable is set. Sprint 11 removed the insecure fallback default. |
| Guardian "Failed to connect" | Check `.env` has valid `SCROLL_RPC_URL`. Try alternative RPC endpoints. |
| MetaMask wrong network | Frontend auto-switches to Scroll Sepolia (chain_id: `0x82750`). If manual: RPC `https://sepolia-rpc.scroll.io`, Chain ID `534351`. |
| Frontend blank page | Ensure Guardian is running on port 3001. Check browser console for errors. |
| Tests timeout | Invariant tests take ~2.6 hours. Use `--match-test` to run specific tests. |
| BattleChain deploy fails | Ensure `BATTLECHAIN_RPC_URL` is set in `.env` and `battlechain` keystore exists (`cast wallet list`). |

---

*Deployment Guide — D-MEX Protocol V3.1 (Security Hardened), May 2026*
