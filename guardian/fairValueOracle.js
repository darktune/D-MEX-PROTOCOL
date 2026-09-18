// ====================================================================
// D-MEX Guardian — Fair Value Oracle Module (Task 3)
// Bridges Chainlink price feeds + DMarket/OpenSea REST APIs for
// real-time game asset valuation used by the Arbiter risk engine.
// ====================================================================

const { ethers } = require('ethers');

// ─── Chainlink Data Feed Interface ────────────────────────────────────
// ABI for latestRoundData() on Aggregator V3
const AGGREGATOR_ABI = [
    'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function decimals() view returns (uint8)'
];

// ─── Configuration ─────────────────────────────────────────────────────
// Staleness tolerance: prices older than this are rejected
const STALENESS_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

// Chainlink price feeds on Scroll Sepolia (or fallback to Ethereum Mainnet feeds)
// NOTE: Scroll Sepolia has limited feed availability; ETH/USD is most reliable
const CHAINLINK_FEEDS = {
    // Scroll Sepolia feeds (https://docs.chain.link/data-feeds/price-feeds/addresses?network=scroll&page=1)
    'ETH/USD':  '0x59F1ec1f10bD7eD9B938431086bC5F5F0b77cb99',
    'BTC/USD':  '0x87dce67002e66C17BC0d723Fe20D736b80d3e5Ab',
    'USDC/USD': '0x0153002d20B96532C639313c2d54c3dA09109309',
};

/**
 * D-MEX Fair Value Oracle
 *
 * Provides USD valuations for game assets using two sources:
 *   1. Chainlink Data Feeds — for ERC-20 tokens with on-chain feeds
 *   2. REST API fallback — for NFT floor prices (DMarket, OpenSea)
 *
 * Used by the Arbiter Guardian to score L1 (Value Drain) risk:
 *   - If offered bundle > 2.5x wanted bundle value → L1 risk = 90
 */
class FairValueOracle {
    /**
     * @param {ethers.Provider} provider  — RPC provider for on-chain reads
     */
    constructor(provider) {
        this.provider = provider;
        this._cache = new Map(); // Simple in-memory price cache
        this._cacheMaxAgeMs = 5 * 60 * 1000; // 5 min cache TTL
    }

    // ─── Public API ──────────────────────────────────────────────────────

    /**
     * Get USD price for an ERC-20 token.
     * Tries Chainlink feed first; falls back to cached/mock values.
     *
     * @param {string} tokenSymbol   — e.g. 'ETH/USD', 'BTC/USD'
     * @param {string} feedAddress   — Chainlink aggregator address (optional override)
     * @returns {Promise<number>}    — USD price with 8 decimal precision as a JS float
     */
    async getTokenPrice(tokenSymbol, feedAddress = null, mode = 'demo') {
        const cacheKey = `price:${tokenSymbol}:${mode}`;
        const cached = this._getFromCache(cacheKey);
        if (cached !== null) return cached;

        // Try Chainlink feed
        const feedAddr = feedAddress || CHAINLINK_FEEDS[tokenSymbol];
        if (feedAddr) {
            try {
                const price = await this._fetchChainlinkPrice(feedAddr);
                this._setCache(cacheKey, price);
                return price;
            } catch (err) {
                console.warn(`[FairValueOracle] Chainlink feed failed for ${tokenSymbol}:`, err.message?.slice(0, 60));
            }
        }

        // If in live mode and we failed to get a Chainlink price, we cannot fallback to mock
        if (mode === 'live') {
            console.warn(`[FairValueOracle] Live mode: No active feed for ${tokenSymbol}, evaluating at $0.00`);
            this._setCache(cacheKey, 0);
            return 0;
        }

        // Fallback: mock prices for local/testnet use
        const mockPrices = {
            'ETH/USD':  3200.00,
            'BTC/USD':  65000.00,
            'USDC/USD': 1.00,
            'DGLD/USD': 0.10,   // Game Gold: mock $0.10
        };
        const mockPrice = mockPrices[tokenSymbol] || 1.0;
        console.log(`[FairValueOracle] Using mock price for ${tokenSymbol}: $${mockPrice}`);
        this._setCache(cacheKey, mockPrice);
        return mockPrice;
    }

    /**
     * Get USD floor price for an NFT collection.
     * Tries OpenSea/Reservoir API; falls back to cached mock.
     *
     * @param {string} collection    — NFT contract address
     * @param {string} network       — 'scroll-sepolia' | 'ethereum'
     * @returns {Promise<number>}    — Floor price in USD
     */
    async getNFTFloorPrice(collection, network = 'scroll-sepolia', mode = 'demo') {
        const cacheKey = `nft:${collection}:${mode}`;
        const cached = this._getFromCache(cacheKey);
        if (cached !== null) return cached;

        // Try Reservoir API (supports Scroll, free tier)
        try {
            const price = await this._fetchReservoirFloor(collection, network);
            this._setCache(cacheKey, price);
            return price;
        } catch (err) {
            console.warn(`[FairValueOracle] Reservoir API failed for ${collection}:`, err.message?.slice(0, 60));
        }

        // If in live mode and Reservoir failed or was unavailable, return $0
        if (mode === 'live') {
            console.warn(`[FairValueOracle] Live mode: No verified floor for ${collection}, evaluating at $0.00`);
            this._setCache(cacheKey, 0);
            return 0;
        }

        // Fallback mock: NFT Sword → $5.00 floor
        const mockFloor = 5.0;
        this._setCache(cacheKey, mockFloor);
        return mockFloor;
    }

    /**
     * Value an entire asset bundle (ERC-20s + NFTs).
     * This is the primary function called by the Arbiter for L1 risk scoring.
     *
     * @param {Array<{type: string, symbol?: string, contract?: string, amount?: number}>} assets
     * @returns {Promise<number>} — Total USD value of the bundle
     */
    async valuateBundle(assets, mode = 'demo') {
        let totalUSD = 0;

        for (const asset of assets) {
            try {
                if (asset.type === 'ERC-20') {
                    const symbol = asset.symbol || 'DGLD/USD';
                    const price = await this.getTokenPrice(symbol, null, mode);
                    const amount = parseFloat(asset.amount) || 1;
                    totalUSD += price * amount;
                } else if (asset.type === 'ERC-721' || asset.type === 'ERC-1155' || asset.type === 'Steam' || asset.type === 'UGC') {
                    const contract = asset.contract || '';
                    const floorPrice = await this.getNFTFloorPrice(contract, 'scroll-sepolia', mode);
                    const qty = parseFloat(asset.amount) || 1;
                    totalUSD += floorPrice * qty;
                }
            } catch (err) {
                console.warn(`[FairValueOracle] Failed to value asset ${asset.type}:`, err.message?.slice(0, 40));
            }
        }

        return totalUSD;
    }

    /**
     * Compute the L1 (Value Drain) risk score for a proposed trade.
     * Based on the ratio of offered vs wanted bundle value.
     *
     *   ratio = offeredUSD / wantedUSD
     *   score = 0     if ratio ≤ 1.5   (fair trade)
     *   score = 45    if ratio ≤ 2.5   (borderline)
     *   score = 90    if ratio > 2.5   (value drain)
     *
     * @param {Array} assetsOffered
     * @param {Array} assetsWanted
     * @returns {Promise<{l1Score: number, offeredUSD: number, wantedUSD: number, ratio: number}>}
     */
    async computeL1RiskScore(assetsOffered, assetsWanted, mode = 'demo') {
        const [offeredUSD, wantedUSD] = await Promise.all([
            this.valuateBundle(assetsOffered, mode),
            this.valuateBundle(assetsWanted, mode)
        ]);

        const ratio = wantedUSD > 0 ? offeredUSD / wantedUSD : Infinity;

        let l1Score = 0;
        if (ratio > 2.5)      l1Score = 90;   // Clear value drain
        else if (ratio > 1.5) l1Score = 45;   // Borderline — warn only

        console.log(`[FairValueOracle] L1 risk: offered=$${offeredUSD.toFixed(2)} wanted=$${wantedUSD.toFixed(2)} ratio=${ratio.toFixed(2)} → L1=${l1Score}`);

        return { l1Score, offeredUSD, wantedUSD, ratio };
    }

    /**
     * Compute ADVISORY severity score for a proposed trade.
     * This DOES NOT block swaps — it only provides warnings and suggestions.
     *
     *   Severity = min(100, round(|offeredUSD - wantedUSD| / max(offeredUSD, wantedUSD) × 100))
     *
     *   0–20:  🟢 Fair Trade   — No warning
     *   21–50: 🟡 Mild Imbalance — Yellow suggestion banner
     *   51–75: 🟠 Significant Drain — Orange modal
     *   76–100:🔴 Critical Drain — Full-screen red intervention
     *
     * @param {Array} assetsOffered
     * @param {Array} assetsWanted
     * @returns {Promise<{severity: number, level: string, offeredUSD: number, wantedUSD: number, countermeasures: Array}>}
     */
    async computeSeverityScore(assetsOffered, assetsWanted, mode = 'demo') {
        const [offeredUSD, wantedUSD] = await Promise.all([
            this.valuateBundle(assetsOffered, mode),
            this.valuateBundle(assetsWanted, mode)
        ]);

        const maxVal = Math.max(offeredUSD, wantedUSD);
        const severity = maxVal > 0
            ? Math.min(100, Math.round(Math.abs(offeredUSD - wantedUSD) / maxVal * 100))
            : 0;

        let level, color;
        if (severity <= 20)       { level = 'fair';       color = 'green';  }
        else if (severity <= 50)  { level = 'mild';       color = 'yellow'; }
        else if (severity <= 75)  { level = 'significant'; color = 'orange'; }
        else                      { level = 'critical';   color = 'red';    }

        // Generate contextual countermeasure suggestions
        const countermeasures = [];
        const diff = Math.abs(offeredUSD - wantedUSD);
        const userIsOverpaying = offeredUSD > wantedUSD;

        if (severity > 20) {
            // 1. Add top-up
            const topUpDGLD = Math.round(diff / 0.10); // DGLD = $0.10 each
            countermeasures.push({
                action: 'add_topup',
                label: 'Add Top-Up',
                detail: userIsOverpaying
                    ? `Ask counterparty to add ~${topUpDGLD} DGLD ($${diff.toFixed(2)}) to balance.`
                    : `Consider adding ~${topUpDGLD} DGLD ($${diff.toFixed(2)}) to balance.`
            });

            // 2. Adjust quantities
            if (severity > 40) {
                countermeasures.push({
                    action: 'adjust_qty',
                    label: 'Adjust Quantities',
                    detail: 'Reduce the amount being offered or request more in return.'
                });
            }

            // 3. Request different asset
            if (severity > 60) {
                countermeasures.push({
                    action: 'request_different',
                    label: 'Request Different Asset',
                    detail: 'Consider asking for a higher-value asset from the counterparty\'s portfolio.'
                });
            }

            // 4. Override always available
            countermeasures.push({
                action: 'override',
                label: 'Override & Proceed',
                detail: 'You understand the value difference and wish to proceed anyway.'
            });
        }

        console.log(`[FairValueOracle] Severity: ${severity}/100 (${level}) | offered=$${offeredUSD.toFixed(2)} wanted=$${wantedUSD.toFixed(2)}`);

        return { severity, level, color, offeredUSD, wantedUSD, countermeasures };
    }

    // ─── Private Helpers ─────────────────────────────────────────────────

    async _fetchChainlinkPrice(feedAddress) {
        const contract = new ethers.Contract(feedAddress, AGGREGATOR_ABI, this.provider);
        const [, answer, , updatedAt] = await contract.latestRoundData();
        const decimals = await contract.decimals();

        // Staleness check
        const ageMs = Date.now() - Number(updatedAt) * 1000;
        if (ageMs > STALENESS_TOLERANCE_MS) {
            throw new Error(`Price stale: ${Math.round(ageMs / 60000)}min old`);
        }

        // Convert from fixed-point (e.g. 8 decimals) to JS float
        return parseFloat(ethers.formatUnits(answer, decimals));
    }

    async _fetchReservoirFloor(collection, network) {
        // Reservoir API — aggregated NFT floor prices, free tier
        // Docs: https://docs.reservoir.tools/reference/getordersbidsv6
        const baseUrl = network === 'ethereum'
            ? 'https://api.reservoir.tools'
            : 'https://api-scroll.reservoir.tools';

        const url = `${baseUrl}/collections/v7?id=${collection}&includeTopBid=false`;

        // Node.js 18+ has native fetch
        const res = await fetch(url, {
            headers: { 'accept': 'application/json', 'x-api-key': 'demo' },
            signal: AbortSignal.timeout(5000)
        });

        if (!res.ok) throw new Error(`Reservoir HTTP ${res.status}`);
        const data = await res.json();
        const floor = data?.collections?.[0]?.floorAsk?.price?.amount?.usd;
        if (!floor) throw new Error('No floor price in response');
        return floor;
    }

    _getFromCache(key) {
        const entry = this._cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > this._cacheMaxAgeMs) {
            this._cache.delete(key);
            return null;
        }
        return entry.value;
    }

    _setCache(key, value) {
        this._cache.set(key, { value, ts: Date.now() });
    }
}

module.exports = FairValueOracle;
