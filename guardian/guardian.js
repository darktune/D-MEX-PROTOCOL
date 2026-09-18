// ====================================================================
// D-MEX Guardian Server V3.0
// Express HTTP + WebSocket • AI Arbiter • Real-Time Analytics Push
// ====================================================================

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const http     = require('http');
const fs       = require('fs');
const { WebSocketServer } = require('ws');
const { ethers } = require('ethers');
const DMEXArbiter    = require('./arbiter');
const FairValueOracle = require('./fairValueOracle');

require('dotenv').config();

// ─── Secure Ledger Storage ──────────────────────────────────────────
const LEDGER_FILE = path.join(__dirname, 'ledger.json');
let evaluationLedger = {};
if (fs.existsSync(LEDGER_FILE)) {
    try {
        evaluationLedger = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
    } catch(e) { console.error('[GUARDIAN] Error reading ledger', e); }
}

function saveToLedger(tradeId, data) {
    evaluationLedger[tradeId] = data;
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(evaluationLedger, null, 2));
}

// ─── Configuration ─────────────────────────────────────────────────
const PORT           = process.env.PORT || 3000;
// SECURITY: Key MUST come from environment — never hardcode private keys in source
const GUARDIAN_KEY   = process.env.GUARDIAN_KEY;
if (!GUARDIAN_KEY) {
    console.error('[GUARDIAN] ❌ FATAL: GUARDIAN_KEY environment variable is required.');
    console.error('[GUARDIAN]    Set it via: export GUARDIAN_KEY=0xYourPrivateKey');
    process.exit(1);
}
const VAULT_PROXY    = process.env.VAULT_PROXY || '0xbD8c5247504ecA82Dbb6A7C78bE5B55131402dF8';
const CHAIN_ID       = 534351;

// Multiple RPCs for reliability — public endpoints are often rate-limited
const RPC_URLS = [
    process.env.RPC_URL || 'https://sepolia-rpc.scroll.io',
    'https://scroll-sepolia.chainstacklabs.com',
    'https://rpc.ankr.com/scroll_sepolia_testnet',
    'https://scroll-sepolia-rpc.publicnode.com'
];

// ─── Initialize Services ──────────────────────────────────────────
const app     = express();
const server  = http.createServer(app);
const wss     = new WebSocketServer({ server });
const arbiter = new DMEXArbiter(GUARDIAN_KEY);

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.json());
app.use(cors());

// Provider for on-chain reads — try RPCs in order, fallback gracefully
let provider, guardianWallet;

async function initProvider() {
    for (const url of RPC_URLS) {
        try {
            const p = new ethers.JsonRpcProvider(url, CHAIN_ID);
            await p.getNetwork();
            provider = p;
            guardianWallet = new ethers.Wallet(GUARDIAN_KEY, provider);
            console.log(`[GUARDIAN] RPC connected: ${url.replace('https://','').slice(0,40)}`);
            initContractsAndListeners();
            return;
        } catch (e) {
            console.log(`[GUARDIAN] RPC failed: ${url.replace('https://','').slice(0,35)}`);
        }
    }
    // All failed — start with first anyway (will retry on demand)
    console.log('[GUARDIAN] ⚠ All RPCs failed — starting with default (will retry)');
    provider = new ethers.JsonRpcProvider(RPC_URLS[0], CHAIN_ID);
    guardianWallet = new ethers.Wallet(GUARDIAN_KEY, provider);
    initContractsAndListeners();
}

function initContractsAndListeners() {
    vaultContract     = new ethers.Contract(CONTRACTS.VAULT_PROXY, VAULT_ABI, provider);
    dgldContract      = new ethers.Contract(CONTRACTS.DGLD, ERC20_ABI, provider);
    swordContract     = new ethers.Contract(CONTRACTS.NFT_SWORD, ERC721_ABI, provider);
    commodityContract = new ethers.Contract(CONTRACTS.COMMODITY, ERC1155_ABI, provider);

    // =================================================================
    // WS3: Double-Spend Prevention / Atomic Respawn Listeners
    // =================================================================
    const tokenContracts = [dgldContract, swordContract, commodityContract];
    
    // Helper to resolve asset type string based on contract address
    const resolveAssetType = (address) => {
        if (address === CONTRACTS.DGLD) return 'DGLD';
        if (address === CONTRACTS.NFT_SWORD) return 'NFT_SWORD';
        if (address === CONTRACTS.COMMODITY) return 'COMMODITY';
        return 'UNKNOWN';
    };

    tokenContracts.forEach(contract => {
        // Listen for Transfer (ERC20/ERC721) and TransferSingle (ERC1155)
        const isERC1155 = contract.target === CONTRACTS.COMMODITY;

        if (isERC1155) {
            contract.on('TransferSingle', async (operator, from, to, id, value, event) => {
                if (from === CONTRACTS.VAULT_PROXY || to === CONTRACTS.VAULT_PROXY) {
                    const spawnInstruction = {
                        type: 'asset_spawn',
                        recipient: to,
                        asset: resolveAssetType(contract.target),
                        amount: value.toString(),
                        tokenId: id.toString(),
                        txHash: event.log.transactionHash,
                        timestamp: Date.now()
                    };
                    broadcastWS(spawnInstruction);
                    console.log(`[GUARDIAN] Broadcasted WS3 SPAWN: ${spawnInstruction.amount} ${spawnInstruction.asset} to ${to.slice(0,8)}`);
                }
            });
        } else {
            contract.on('Transfer', async (from, to, valueOrTokenId, event) => {
                if (from === CONTRACTS.VAULT_PROXY || to === CONTRACTS.VAULT_PROXY) {
                    const isERC721 = contract.target === CONTRACTS.NFT_SWORD;
                    const spawnInstruction = {
                        type: 'asset_spawn',
                        recipient: to,
                        asset: resolveAssetType(contract.target),
                        amount: isERC721 ? '1' : ethers.formatUnits(valueOrTokenId, 18),
                        tokenId: isERC721 ? valueOrTokenId.toString() : null,
                        txHash: event.log.transactionHash,
                        timestamp: Date.now()
                    };
                    broadcastWS(spawnInstruction);
                    console.log(`[GUARDIAN] Broadcasted WS3 SPAWN: ${spawnInstruction.amount} ${spawnInstruction.asset} to ${to.slice(0,8)}`);
                }
            });
        }
    });
}

const fairValueOracle = new FairValueOracle(provider); // Task 3: real-time asset valuation

// ─── Contract ABIs for on-chain reads ──────────────────────────────
const VAULT_ABI = [
    'function guardianSigner() view returns (address)',
    'function protocolTreasury() view returns (address)',
    'function trades(bytes32) view returns (address partyA, address partyB, bytes32 offeredHash, bytes32 wantedHash, bool partyALocked, bool partyBLocked, bool active, bytes32 metadataHash)',
    'event TradeProposed(bytes32 indexed tradeId, address indexed partyA, address indexed partyB)',
    'event AtomicSwapExecuted(bytes32 indexed tradeId)',
    'event TradeCancelled(bytes32 indexed tradeId)'
];

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function mint(address to, uint256 amount)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const ERC721_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function name() view returns (string)',
    'function mint(address to) returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];

const ERC1155_ABI = [
    'function balanceOf(address, uint256) view returns (uint256)',
    'function mint(address to, uint256 id, uint256 amount)',
    'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
];

// Deployed contract addresses
const CONTRACTS = {
    VAULT_PROXY: VAULT_PROXY,
    DGLD:        '0x789755ed4930b37372e9E838AdbF4280CDE7A576',
    NFT_SWORD:   '0xdd2C163C8E0005deF0B1e70c93dF708998Be9bce',
    COMMODITY:   '0xA62561F571c27c9c17D44fBCB6a931Ea55da594c'
};

let vaultContract, dgldContract, swordContract, commodityContract;

// ─── In-Memory Analytics Store ─────────────────────────────────────
const analytics = {
    total: 0,
    approved: 0,
    rejected: 0,
    evaluations: [],
    riskScores: []
};

// ─── Psychology & Defaults Mode ────────────────────────────────────
let psychologyMode = true;

function applyPsychologyHeuristics(assetsOffered, assetsWanted, offerValue, wantedValue) {
    const warnings = [];

    if (!psychologyMode) return warnings;

    // Endowment Effect: overvaluing own assets
    if (offerValue > 0 && wantedValue > 0 && offerValue > wantedValue * 2.5) {
        warnings.push({
            bias: 'Endowment Effect',
            message: `You're offering assets worth ~$${offerValue.toFixed(2)} for items worth ~$${wantedValue.toFixed(2)}. You may be overvaluing your own holdings.`,
            severity: 'warning'
        });
    }

    // Loss Aversion: large % of portfolio at risk
    if (offerValue > 100) {
        warnings.push({
            bias: 'Loss Aversion',
            message: `This trade commits $${offerValue.toFixed(2)} worth of assets. Consider if you can afford to lose this amount.`,
            severity: 'caution'
        });
    }

    // Anchoring: suspicious round numbers
    if (assetsOffered?.length === 1 && assetsOffered[0].amount % 100 === 0 && assetsOffered[0].amount >= 1000) {
        warnings.push({
            bias: 'Anchoring Bias',
            message: 'Round-number offers (1000, 5000, etc.) are often anchored to psychological comfort rather than fair market value.',
            severity: 'info'
        });
    }

    // FOMO: rapid re-trading
    const recentTrades = analytics.evaluations.filter(e =>
        Date.now() - new Date(e.timestamp).getTime() < 5 * 60 * 1000
    );
    if (recentTrades.length >= 3) {
        warnings.push({
            bias: 'FOMO / Urgency',
            message: `You've submitted ${recentTrades.length} trades in the last 5 minutes. Consider slowing down to avoid impulsive decisions.`,
            severity: 'warning'
        });
    }

    return warnings;
}

// ─── Middleware ─────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── Routes ────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        guardian: guardianWallet.address,
        vault: VAULT_PROXY,
        network: 'Scroll Sepolia',
        uptime: process.uptime(),
        analytics: {
            total: analytics.total,
            approved: analytics.approved,
            rejected: analytics.rejected
        }
    });
});

// ─── POST /api/evaluate ────────────────────────────────────────────
// Runs Arbiter risk analysis, returns score + attack node breakdown
app.post('/api/evaluate', async (req, res) => {
    try {
        const { tradeId, metadataHash, offeredHash, wantedHash,
                assetsOffered, assetsWanted, offerValue, wantedValue, mode } = req.body;

        if (!tradeId) return res.status(400).json({ error: 'tradeId is required' });

        console.log(`\n[GUARDIAN] ► Evaluating trade: ${tradeId.substring(0, 10)}...`);

        // Run Arbiter analysis
        const result = await arbiter.evaluateAndSignSwap(
            tradeId,
            metadataHash || ethers.ZeroHash,
            offeredHash  || ethers.ZeroHash,
            wantedHash   || ethers.ZeroHash,
            assetsOffered || [],
            assetsWanted  || []
        );

        // Compute attack node scores — L1 is now data-driven via FairValueOracle
        let l1Score = result.reason === 'L1_VALUE_DRAIN_RISK' ? 90 : Math.floor(Math.random() * 15);
        let offeredUSD = offerValue || 0;
        let wantedUSD  = wantedValue || 0;

        // Run FairValueOracle for data-driven L1 scoring (async, non-blocking)
        try {
            const fairVal = await fairValueOracle.computeL1RiskScore(
                assetsOffered || [],
                assetsWanted  || [],
                mode || 'demo'
            );
            l1Score   = fairVal.l1Score;
            offeredUSD = fairVal.offeredUSD;
            wantedUSD  = fairVal.wantedUSD;
        } catch (oracleErr) {
            console.warn('[GUARDIAN] FairValueOracle fallback:', oracleErr.message?.slice(0, 50));
        }

        const attackNodes = {
            l1: l1Score,
            l2: Math.floor(Math.random() * 5),   // EIP-1153 handles this on-chain
            l3: result.reason === 'L3_METADATA_FRAUD' ? 80 : Math.floor(Math.random() * 10),
            a3: result.reason === 'A3_SYBIL_MARKET' ? 60 : Math.floor(Math.random() * 20)
        };

        // Composite risk score (weighted)
        const compositeRisk = Math.min(100, Math.round(
            attackNodes.l1 * 0.35 +
            attackNodes.l2 * 0.20 +
            attackNodes.l3 * 0.20 +
            attackNodes.a3 * 0.25
        ));

        // Psychology warnings
        const psychWarnings = applyPsychologyHeuristics(
            assetsOffered, assetsWanted,
            offerValue || 0, wantedValue || 0
        );

        const riskLevel = compositeRisk < 20 ? 'low' : compositeRisk < 50 ? 'medium' : 'high';

        // Multi-Operator Threshold Logic (WS2)
        // If risk is high, require human co-signer instead of auto-rejecting or approving
        let finalDecision = result.approved ? 'approve' : 'reject';
        if (compositeRisk >= 50 && result.approved) {
            finalDecision = 'pending_co_signer';
        }

        const evaluation = {
            timestamp: new Date().toISOString(),
            tradeId: tradeId.substring(0, 10) + '...',
            score: compositeRisk,
            riskLevel,
            decision: finalDecision,
            attackNodes,
            psychWarnings,
            reason: result.reason || 'PASS'
        };

        analytics.total++;
        if (finalDecision === 'approve') analytics.approved++;
        else if (finalDecision === 'reject') analytics.rejected++;
        
        analytics.riskScores.push(compositeRisk);
        analytics.evaluations.unshift(evaluation);

        // Keep last 100 evaluations
        if (analytics.evaluations.length > 100) analytics.evaluations.pop();

        // Broadcast to all WebSocket clients
        broadcastWS({
            type: 'evaluation',
            data: evaluation,
            analytics: {
                total: analytics.total,
                approved: analytics.approved,
                rejected: analytics.rejected,
                avgRisk: Math.round(analytics.riskScores.reduce((a,b) => a+b, 0) / analytics.riskScores.length)
            }
        });

        // Compute advisory severity score (never blocks, only warns)
        let severityData = { severity: 0, level: 'fair', color: 'green', countermeasures: [] };
        try {
            severityData = await fairValueOracle.computeSeverityScore(
                assetsOffered || [],
                assetsWanted  || [],
                mode || 'demo'
            );
        } catch (sevErr) {
            console.warn('[GUARDIAN] Severity scoring fallback:', sevErr.message?.slice(0, 50));
        }

        console.log(`[GUARDIAN] ← Result: ${finalDecision.toUpperCase()} (risk: ${compositeRisk}, level: ${riskLevel}, severity: ${severityData.severity}/100)`);

        // Immediate Secure Storage (Zero Tamper Window)
        saveToLedger(tradeId, {
            timestamp: new Date().toISOString(),
            tradeId,
            score: compositeRisk,
            riskLevel,
            decision: finalDecision,
            attackNodes,
            psychWarnings,
            reason: result.reason || 'PASS',
            severity: severityData,
            signature: result.signature,
            offeredUSD,
            wantedUSD,
            assetsOffered,
            assetsWanted
        });

        res.json({
            approved: finalDecision === 'approve',
            requiresCoSigner: finalDecision === 'pending_co_signer',
            riskScore: compositeRisk,
            riskLevel,
            decision: finalDecision,
            attackNodes,
            psychWarnings,
            fairValue: { offeredUSD: offeredUSD.toFixed(2), wantedUSD: wantedUSD.toFixed(2) },
            severity: severityData,
            signature: finalDecision === 'approve' ? result.signature : null,
            reason: finalDecision === 'pending_co_signer' ? 'MULTI_SIG_REQUIRED' : (result.reason || 'PASS')
        });

    } catch (err) {
        console.error('[GUARDIAN] Evaluation error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/sign ────────────────────────────────────────────────
// Direct signing for pre-approved swaps
app.post('/api/sign', async (req, res) => {
    try {
        const { tradeId, metadataHash, offeredHash, wantedHash } = req.body;

        if (!tradeId) return res.status(400).json({ error: 'tradeId is required' });

        const messageHash = ethers.solidityPackedKeccak256(
            ['bytes32', 'bytes32', 'bytes32', 'bytes32'],
            [tradeId, metadataHash, offeredHash, wantedHash]
        );

        const signature = await guardianWallet.signMessage(ethers.getBytes(messageHash));

        console.log(`[GUARDIAN] Signed trade: ${tradeId.substring(0, 10)}...`);
        res.json({ signature, signer: guardianWallet.address });
    } catch (err) {
        console.error('[GUARDIAN] Signing error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/faucet ──────────────────────────────────────────────
// Mints testnet tokens to new users for live testing
app.post('/api/faucet', async (req, res) => {
    try {
        const { address } = req.body;
        if (!ethers.isAddress(address)) return res.status(400).json({ error: 'Invalid address' });

        console.log(`[GUARDIAN] Faucet request for ${address.substring(0, 10)}...`);

        // Connect contracts to the guardian wallet (which has minting rights)
        const dgld = dgldContract.connect(guardianWallet);
        const sword = swordContract.connect(guardianWallet);
        const commodity = commodityContract.connect(guardianWallet);

        // Mint 1000 DGLD
        const tx1 = await dgld.mint(address, ethers.parseUnits("1000", 18));
        // Mint 1 NFT Sword
        const tx2 = await sword.mint(address);
        // Mint 50 Commodities (ID 0)
        const tx3 = await commodity.mint(address, 0, 50);

        // Wait for all txs to be mined
        await Promise.all([tx1.wait(), tx2.wait(), tx3.wait()]);

        res.json({
            success: true,
            message: "Successfully minted testnet assets",
            assets: { dgld: 1000, nftSwords: 1, commodities: 50 }
        });
    } catch (err) {
        console.error('[GUARDIAN] Faucet error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/rpc ─────────────────────────────────────────────────
// Proxies RPC requests to bypass browser CORS or adblockers
app.post('/api/rpc', async (req, res) => {
    try {
        let lastErr;
        let lastStatus = 502;
        let lastText = '';
        for (const url of RPC_URLS) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(req.body)
                });
                if (!response.ok) {
                    lastStatus = response.status;
                    lastText = await response.text();
                    console.error(`[RPC Proxy] ${url} returned ${response.status}: ${lastText}`);
                    continue;
                }
                const data = await response.json();
                return res.json(data);
            } catch (err) {
                lastErr = err;
                console.error(`[RPC Proxy] ${url} network error: ${err.message}`);
            }
        }
        res.status(lastStatus).json({ error: 'All upstream RPCs failed', details: lastErr?.message || lastText });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/portfolio/:address ───────────────────────────────────
// Returns on-chain balances and swap history for a wallet
app.get('/api/portfolio/:address', async (req, res) => {
    try {
        const addr = req.params.address;
        if (!ethers.isAddress(addr)) return res.status(400).json({ error: 'Invalid address' });

        console.log(`[GUARDIAN] Portfolio query: ${addr.substring(0, 10)}...`);

        // Check if we have seeded reputation data for this address (marketplace mock traders)
        const seededRep = holderReputations[addr.toLowerCase()] || holderReputations[addr];

        // On-chain balance reads
        let dgldBal = 0n, swordBal = 0n, commodityBal = 0n, ethBal = 0n;
        try {
            [dgldBal, swordBal, commodityBal, ethBal] = await Promise.all([
                dgldContract.balanceOf(addr).catch(() => 0n),
                swordContract.balanceOf(addr).catch(() => 0n),
                commodityContract.balanceOf(addr, 0).catch(() => 0n),
                provider.getBalance(addr).catch(() => 0n)
            ]);
        } catch (e) {
            console.log('[GUARDIAN] Balance reads failed (RPC may be down):', e.message?.substring(0, 50));
        }

        // Query on-chain events for this address
        let totalSwaps = 0, successfulSwaps = 0, cancelledSwaps = 0;

        try {
            const proposedFilter = vaultContract.filters.TradeProposed(null, addr);
            const proposedAsB    = vaultContract.filters.TradeProposed(null, null, addr);
            const executedFilter = vaultContract.filters.AtomicSwapExecuted();
            const cancelFilter   = vaultContract.filters.TradeCancelled();

            const [proposedA, proposedB, executed, cancelled] = await Promise.all([
                vaultContract.queryFilter(proposedFilter, 0, 'latest').catch(() => []),
                vaultContract.queryFilter(proposedAsB, 0, 'latest').catch(() => []),
                vaultContract.queryFilter(executedFilter, 0, 'latest').catch(() => []),
                vaultContract.queryFilter(cancelFilter, 0, 'latest').catch(() => [])
            ]);

            totalSwaps = proposedA.length + proposedB.length;
            successfulSwaps = executed.length;
            cancelledSwaps = cancelled.length;
        } catch (e) {
            console.log('[GUARDIAN] Event query failed (may be too many blocks):', e.message?.substring(0, 50));
        }

        // Compute reputation — use seeded data if on-chain has no history
        let reputation;
        if (totalSwaps > 0) {
            reputation = Math.round((successfulSwaps / Math.max(totalSwaps, 1)) * 100);
        } else if (seededRep) {
            // Use marketplace-seeded reputation for mock traders
            reputation = seededRep.reputation;
            totalSwaps = seededRep.totalSwaps || 0;
            successfulSwaps = seededRep.successfulSwaps || 0;
        } else {
            reputation = 100; // New users start at 100%
        }

            const allProposed = [...proposedA, ...proposedB];
            allProposed.sort((a, b) => b.blockNumber - a.blockNumber);
            
            const executedSet = new Set(executed.map(e => e.args[0]));
            const cancelledSet = new Set(cancelled.map(e => e.args[0]));
            
            const history = [];
            for (const ev of allProposed) {
                const tradeId = ev.args[0];
                const partyA = ev.args[1];
                const partyB = ev.args[2];
                const isOutgoing = (partyA.toLowerCase() === addr.toLowerCase());
                
                let onChainStatus = 'pending';
                if (executedSet.has(tradeId)) onChainStatus = 'executed';
                else if (cancelledSet.has(tradeId)) onChainStatus = 'cancelled';
                
                const ledgerData = evaluationLedger[tradeId] || null;
                
                history.push({
                    tradeId,
                    type: isOutgoing ? 'Outgoing Swap' : 'Incoming Swap',
                    counterparty: isOutgoing ? partyB : partyA,
                    onChainStatus,
                    guardianEvaluation: ledgerData,
                    blockNumber: ev.blockNumber,
                    txHash: ev.transactionHash
                });
            }

        res.json({
            address: addr,
            balances: {
                eth:       ethers.formatEther(ethBal),
                dgld:      ethers.formatUnits(dgldBal, 18),
                nftSwords: swordBal.toString(),
                commodities: commodityBal.toString()
            },
            activity: {
                totalSwaps,
                successfulSwaps,
                cancelledSwaps,
                reputation
            },
            history
        });

    } catch (err) {
        console.error('[GUARDIAN] Portfolio error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── 50-Peer Mathematical Seeder ───────────────────────────────────
// Generates 50 diverse marketplace listings across ALL game ecosystems
// with perceived market value scaling (±15% off baseValue)

const ASSET_POOL = [
    // D-MEX Native
    { name: 'DGLD (Gold)', type: 'ERC-20', icon: 'G', iconClass: 'gold', game: 'dmex', baseValue: 0.10, amountRange: [50, 5000] },
    { name: 'NFT Sword', type: 'ERC-721', icon: '⚔', iconClass: 'sword', game: 'dmex', baseValue: 5.00, tokenIdRange: [0, 99] },
    { name: 'Commodity', type: 'ERC-1155', icon: '◆', iconClass: 'commodity', game: 'dmex', baseValue: 1.00, amountRange: [10, 500] },
    // Loot
    { name: 'Loot Bag', type: 'ERC-721', icon: '🎒', iconClass: 'loot', game: 'loot', baseValue: 50.00, tokenIdRange: [1, 8000] },
    // Gods Unchained
    { name: 'God Card', type: 'ERC-1155', icon: '🃏', iconClass: 'gods', game: 'gods', baseValue: 15.00, amountRange: [1, 10] },
    // CryptoKitties
    { name: 'CryptoKitty', type: 'ERC-721', icon: '🐱', iconClass: 'kitty', game: 'cryptokitties', baseValue: 35.00, tokenIdRange: [100000, 2000000] },
    // CS2
    { name: 'CS2 Skin', type: 'ERC-721', icon: '🔫', iconClass: 'cs-skin', game: 'cs2', baseValue: 75.00, tokenIdRange: [1, 500] },
    { name: 'CS2 Case', type: 'ERC-1155', icon: '📦', iconClass: 'cs-case', game: 'cs2', baseValue: 2.50, amountRange: [5, 100] },
    { name: 'CS2 Balance', type: 'ERC-20', icon: '$', iconClass: 'cs-balance', game: 'cs2', baseValue: 1.00, amountRange: [10, 500] },
    // UGC (3D Engines)
    { name: 'UE5 Nanite Mesh', type: 'ERC-1155', icon: 'U', iconClass: 'unreal', game: 'ugc', baseValue: 120.00, amountRange: [1, 3] },
    { name: 'Blender Scene', type: 'ERC-721', icon: 'B', iconClass: 'blender', game: 'ugc', baseValue: 45.00, tokenIdRange: [1, 50] },
    { name: 'Maya Rig', type: 'ERC-721', icon: 'M', iconClass: 'maya', game: 'ugc', baseValue: 200.00, tokenIdRange: [1, 20] },
    { name: 'Unity Prefab', type: 'ERC-1155', icon: '⚙', iconClass: 'unity', game: 'ugc', baseValue: 60.00, amountRange: [1, 5] }
];

const CS2_SKIN_DESCRIPTIONS = [
    'AK-47 | Asiimov (Field-Tested). Float: 0.21. 4x Crown stickers.',
    'AWP | Dragon Lore (Factory New). Float: 0.01. Souvenir edition.',
    'M4A4 | Howl (Minimal Wear). Float: 0.08. Contraband.',
    'Karambit | Fade (FN). 98% fade. Clean corner.',
    'AWP | Fade (Factory New). Float: 0.03. Pristine.',
    'Desert Eagle | Blaze (FN). Float: 0.006. Flawless.',
    'Butterfly Knife | Doppler Phase 2. Pink galaxy.',
    'Glock-18 | Fade (FN). Full fade. 0.01 float.',
    'USP-S | Kill Confirmed (MW). Float: 0.09.',
    'AK-47 | Fire Serpent (MW). Float: 0.12. Crown on wood.'
];

const LOOT_DESCRIPTIONS = [
    '"Divine Robe" of Brilliance, Grim Shout, Hard Leather Boots.',
    '"Katana of Rage", Demon Crown, Silk Sash. Loot Bag #',
    '"Dragon\'s Crown", Plate Mail, Divine Gloves. Great Wonder bag.',
    '"Warhammer of Enlightenment", Ring of Skill.',
    '"Tome of Power", "Ornate Helm", Dragonskin Boots.'
];

const KITTY_DESCRIPTIONS = [
    'Gen 0 CryptoKitty — Jaguar pattern, Sapphire eyes. Ultra rare.',
    'Gen 5 CryptoKitty — DragoWing pattern, Violet eyes, Pouty mouth.',
    'Gen 1 CryptoKitty — Spock pattern, Bubblegum eyes. OG collectible.',
    'Gen 3 CryptoKitty — Totesbasic, Lemonade body. Good breeder.',
    'Gen 0 CryptoKitty — Luckystripe, Gold eyes. Founder series.'
];

const GOD_CARD_DESCRIPTIONS = [
    'Demogorgon — Legendary Creature. 8/8. Roar: Deal 8 damage to each enemy creature.',
    'Echophon — Mythic Spell. Draw 3. Nature god. Shadow quality.',
    'Thaeriel\'s Fury — Epic Light card. 5 ATK / 4 HP. Meteorite.',
    'Avatar of War — Legendary. 7/7 Frontline. Gold quality.',
    'Helios, Sun God — Mythic. 9/9. Burn 3 to all. Diamond.'
];

const GENERAL_DESCRIPTIONS = [
    'Legendary flame-enchanted blade. +45 ATK.',
    'Ice crystal blade. +60 ATK, +20 DEF.',
    'Shadow dagger. Crit chance +15%. Rare drop.',
    'Bulk lot — open to all offers. DM to negotiate.',
    'Premium resource pack. Great for crafting.',
    'Cross-game trade welcome. Looking for diverse assets.',
    'High-poly model. Production-ready. Rigged for animation.',
    'Prefab bundle. Includes scripts and materials.',
    'Open to offers — willing to add DGLD top-up for fairness.',
    'Limited edition. Only 20 minted. Collector item.'
];

// Seeded PRNG for deterministic results
function seededRandom(seed) {
    let s = seed;
    return function() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function generateMockAddress(seed) {
    const rng = seededRandom(seed);
    let addr = '0x';
    const hex = '0123456789abcdef';
    for (let i = 0; i < 40; i++) addr += hex[Math.floor(rng() * 16)];
    return addr;
}

function generateMockListings(count = 50) {
    const listings = [];
    const reputations = {};
    const rng = seededRandom(42); // Deterministic seed

    for (let i = 0; i < count; i++) {
        const addr = generateMockAddress(1000 + i * 7);
        const assetDef = ASSET_POOL[Math.floor(rng() * ASSET_POOL.length)];

        // Perceived market value: baseValue ±15%
        const fluctuation = 1 + (rng() * 0.30 - 0.15);
        const perceivedValue = parseFloat((assetDef.baseValue * fluctuation).toFixed(2));

        // Build asset object
        const asset = {
            type: assetDef.type,
            name: assetDef.name,
            icon: assetDef.icon,
            iconClass: assetDef.iconClass
        };
        if (assetDef.tokenIdRange) {
            asset.tokenId = assetDef.tokenIdRange[0] + Math.floor(rng() * (assetDef.tokenIdRange[1] - assetDef.tokenIdRange[0]));
        }
        if (assetDef.amountRange) {
            asset.amount = assetDef.amountRange[0] + Math.floor(rng() * (assetDef.amountRange[1] - assetDef.amountRange[0]));
        }

        // Build asking price (cross-game — request a DIFFERENT game's asset)
        let askAsset = ASSET_POOL[Math.floor(rng() * ASSET_POOL.length)];
        // Ensure asking asset differs from the listed asset
        while (askAsset.name === assetDef.name) askAsset = ASSET_POOL[Math.floor(rng() * ASSET_POOL.length)];
        const askAmount = askAsset.amountRange
            ? askAsset.amountRange[0] + Math.floor(rng() * (askAsset.amountRange[1] - askAsset.amountRange[0]))
            : 1;

        // Description
        let description;
        if (assetDef.game === 'cs2' && assetDef.name.includes('Skin')) description = CS2_SKIN_DESCRIPTIONS[i % CS2_SKIN_DESCRIPTIONS.length];
        else if (assetDef.game === 'loot') description = LOOT_DESCRIPTIONS[i % LOOT_DESCRIPTIONS.length] + (asset.tokenId || i);
        else if (assetDef.game === 'cryptokitties') description = KITTY_DESCRIPTIONS[i % KITTY_DESCRIPTIONS.length];
        else if (assetDef.game === 'gods') description = GOD_CARD_DESCRIPTIONS[i % GOD_CARD_DESCRIPTIONS.length];
        else description = GENERAL_DESCRIPTIONS[i % GENERAL_DESCRIPTIONS.length];

        // Reputation
        const rep = 20 + Math.floor(rng() * 80); // 20-100%
        const totalSwaps = 1 + Math.floor(rng() * 50);
        const successfulSwaps = Math.max(1, Math.floor(totalSwaps * (rep / 100)));
        reputations[addr] = { reputation: rep, totalSwaps, successfulSwaps };

        listings.push({
            id: `listing-${String(i + 1).padStart(3, '0')}`,
            seller: addr,
            asset,
            askingPrice: { type: askAsset.type, name: askAsset.name, amount: askAmount },
            marketValue: perceivedValue * (asset.amount || 1),
            description,
            listedAt: Date.now() - Math.floor(rng() * 86400000), // Random time in last 24h
            status: 'open',
            game: assetDef.game
        });
    }
    return { listings, reputations };
}

const { listings: seedListings, reputations: seedReputations } = generateMockListings(50);
const marketplaceListings = [...seedListings];
const holderReputations = { ...seedReputations };

// ─── GET /api/marketplace ──────────────────────────────────────────
// Returns all open listings with holder reputation data
app.get('/api/marketplace', (req, res) => {
    const { assetType, game } = req.query; // optional filters

    let listings = marketplaceListings.filter(l => l.status === 'open');
    if (assetType) listings = listings.filter(l => l.asset.type === assetType);
    if (game && game !== 'all') listings = listings.filter(l => l.game === game);

    // Attach reputation data to each listing
    const enriched = listings.map(l => ({
        ...l,
        holderProfile: holderReputations[l.seller] || { reputation: 100, totalSwaps: 0, successfulSwaps: 0 }
    }));

    res.json({ listings: enriched, total: enriched.length });
});

// ─── GET /api/marketplace/live ─────────────────────────────────────
// Returns all REAL open intents directly from the Scroll Sepolia blockchain
app.get('/api/marketplace/live', async (req, res) => {
    try {
        const proposedFilter = vaultContract.filters.TradeProposed();
        const executedFilter = vaultContract.filters.AtomicSwapExecuted();
        const cancelFilter   = vaultContract.filters.TradeCancelled();

        const [proposed, executed, cancelled] = await Promise.all([
            vaultContract.queryFilter(proposedFilter, 0, 'latest').catch(() => []),
            vaultContract.queryFilter(executedFilter, 0, 'latest').catch(() => []),
            vaultContract.queryFilter(cancelFilter, 0, 'latest').catch(() => [])
        ]);

        const executedSet = new Set(executed.map(e => e.args[0]));
        const cancelledSet = new Set(cancelled.map(e => e.args[0]));

        const openIntents = proposed.filter(e => {
            const tid = e.args[0];
            return !executedSet.has(tid) && !cancelledSet.has(tid);
        });

        const liveListings = openIntents.map(e => {
            const tradeId = e.args[0];
            const partyA = e.args[1];
            const partyB = e.args[2];
            
            const ledgerData = evaluationLedger[tradeId];
            
            let assetName = 'Unknown Asset';
            let askName = 'Unknown Request';
            if (ledgerData) {
                assetName = ledgerData.assetsOffered?.join(', ') || assetName;
                askName = ledgerData.assetsWanted?.join(', ') || askName;
            }

            return {
                idx: tradeId,
                id: tradeId,
                seller: partyA,
                asset: {
                    type: 'On-Chain',
                    name: assetName,
                    icon: '🔗',
                    iconClass: 'dgld',
                    game: 'dmex'
                },
                marketValue: ledgerData?.offeredUSD || 0,
                askingPrice: {
                    amount: ledgerData?.wantedUSD || 0,
                    name: askName
                },
                description: `Blockchain Verified Intent. Target: ${partyB !== '0x0000000000000000000000000000000000000000' ? partyB : 'Open Market'}`,
                listedAt: ledgerData?.timestamp || Date.now(),
                status: 'open',
                holderProfile: holderReputations[partyA] || { reputation: 100, totalSwaps: 1 }
            };
        });

        // Sort newest first
        liveListings.sort((a, b) => b.listedAt - a.listedAt);

        res.json({ listings: liveListings, total: liveListings.length });
    } catch (err) {
        console.error('[GUARDIAN] Live Marketplace error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/marketplace ─────────────────────────────────────────
// Users submit their own asset listings
app.post('/api/marketplace', (req, res) => {
    try {
        const { seller, asset, askingPrice, description } = req.body;
        if (!seller || !asset) return res.status(400).json({ error: 'seller and asset are required' });

        const listing = {
            id: 'listing-' + Date.now().toString(36),
            seller,
            asset,
            askingPrice: askingPrice || { type: 'ERC-20', name: 'DGLD (Gold)', amount: 0 },
            marketValue: askingPrice?.amount ? askingPrice.amount * 0.10 : 0,
            description: description || 'No description provided.',
            listedAt: Date.now(),
            status: 'open'
        };

        marketplaceListings.unshift(listing);
        console.log(`[MARKETPLACE] New listing from ${seller.substring(0, 10)}: ${asset.name}`);

        // Broadcast to WebSocket clients
        broadcastWS({ type: 'new_listing', listing });

        res.json({ success: true, listing });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/analytics ────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
    res.json({
        total: analytics.total,
        approved: analytics.approved,
        rejected: analytics.rejected,
        avgRisk: analytics.riskScores.length > 0
            ? Math.round(analytics.riskScores.reduce((a,b) => a+b, 0) / analytics.riskScores.length)
            : 0,
        evaluations: analytics.evaluations.slice(0, 50),
        riskScores: analytics.riskScores.slice(-50)
    });
});

// ─── POST /api/settings ────────────────────────────────────────────
app.post('/api/settings', (req, res) => {
    const { psychologyMode: pm, autoRejectThreshold, fairValueSlippage } = req.body;

    if (pm !== undefined) psychologyMode = !!pm;

    console.log(`[GUARDIAN] Settings updated: psychology=${psychologyMode}`);

    res.json({
        psychologyMode,
        autoRejectThreshold: autoRejectThreshold || 50,
        fairValueSlippage: fairValueSlippage || 5
    });
});

// ─── Dashboard (HTML served at root) ───────────────────────────────
app.get('/dashboard', (req, res) => {
    res.json({
        status: 'D-MEX Guardian V3.0',
        guardian: guardianWallet.address,
        vault: VAULT_PROXY,
        network: `Scroll Sepolia (${CHAIN_ID})`,
        endpoints: {
            evaluate:  'POST /api/evaluate',
            sign:      'POST /api/sign',
            portfolio: 'GET  /api/portfolio/:address',
            marketplace: 'GET /api/marketplace',
            analytics: 'GET  /api/analytics',
            settings:  'POST /api/settings',
            health:    'GET  /api/health'
        },
        frontend: `http://localhost:${PORT}/`,
        websocket: `ws://localhost:${PORT}`
    });
});

// Fallback: serve frontend for any unmatched route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── WebSocket ─────────────────────────────────────────────────────
function broadcastWS(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg);
    });
}

// Server-side keepalive: ping every 30 seconds to detect dead connections
const WS_PING_INTERVAL = setInterval(() => {
    wss.clients.forEach(client => {
        if (client.isAlive === false) { client.terminate(); return; }
        client.isAlive = false;
        client.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(WS_PING_INTERVAL));

wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    ws.isAlive = true;

    // Respond to protocol-level pongs
    ws.on('pong', () => { ws.isAlive = true; });

    // Send current analytics snapshot on connect
    ws.send(JSON.stringify({
        type: 'snapshot',
        analytics: {
            total: analytics.total,
            approved: analytics.approved,
            rejected: analytics.rejected,
            avgRisk: analytics.riskScores.length > 0
                ? Math.round(analytics.riskScores.reduce((a,b) => a+b, 0) / analytics.riskScores.length) : 0
        },
        evaluations: analytics.evaluations.slice(0, 10)
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Application-level keepalive ping
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
            }
            if (data.type === 'chat') {
                console.log(`[WS] Chat: ${data.sender} -> ${data.receiver}: ${data.message}`);
                // Relay chat message to all connected clients
                broadcastWS(data);
            }
        } catch (e) { console.error('[WS] Parse error', e.message); }
    });

    ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ─── Start Server ──────────────────────────────────────────────────
(async () => {
    await initProvider();
    server.listen(PORT, () => {
        const guardianAddr = guardianWallet ? guardianWallet.address.substring(0, 20) : 'not connected';
        console.log(`
╔══════════════════════════════════════════════════════╗
║          🛡️  D-MEX AI Guardian V3.0                  ║
╠══════════════════════════════════════════════════════╣
║  HTTP    : http://localhost:${PORT}                     ║
║  WS      : ws://localhost:${PORT}                       ║
║  Guardian: ${guardianAddr}...  ║
║  Vault   : ${VAULT_PROXY.substring(0, 20)}...  ║
║  Network : Scroll Sepolia (${CHAIN_ID})              ║
╠══════════════════════════════════════════════════════╣
║  Endpoints:                                          ║
║    POST /api/evaluate  — AI risk analysis            ║
║    POST /api/sign      — sign approved swaps         ║
║    GET  /api/portfolio/:addr — wallet portfolio      ║
║    GET  /api/marketplace — asset listings            ║
║    GET  /api/analytics — real-time stats             ║
║    POST /api/settings  — guardian config             ║
╚══════════════════════════════════════════════════════╝
        `);
    });
})();
