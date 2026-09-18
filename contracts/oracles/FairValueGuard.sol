// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {AggregatorV3Interface, FunctionsClient} from "../interfaces/ChainlinkInterfaces.sol";

struct AssetBundle {
    address[] erc20s;
    uint256[] erc20Amounts;
    address[] nfts;
    uint256[] nftIds;
}

/**
 * @title DMEX Fair-Value Guard
 * @notice Logic to satisfy Node A2 (Fake Liquidity) of the Guardian Rules.
 */
abstract contract FairValueGuard is FunctionsClient {
    // Mapping: Token Address => Chainlink Feed (USD)
    mapping(address => address) public tokenFeeds;
    // Mapping: NFT Collection => Latest Floor Price (in USD)
    mapping(address => uint256) public nftFloorPrices;

    uint256 public constant FAIRNESS_THRESHOLD = 80; // 80% minimum value match

    /**
     * @dev Validates that the "Wanted" bundle is worth at least 80% of the "Offered" bundle.
     * Uses LaTeX for the underlying math: $V_{offered} \leq V_{wanted} \times (1 + \Delta)$
     */
    function validateTradeFairness(
        AssetBundle calldata offered,
        AssetBundle calldata wanted
    ) internal view returns (bool) {
        uint256 totalOfferedValue = _calculateBundleValue(offered);
        uint256 totalWantedValue = _calculateBundleValue(wanted);

        // Algorithmic Check: Zero-value "Ghost Tokens" will fail this instantly.
        require(totalWantedValue > 0, "DMEX: Target value cannot be zero");
        
        return totalWantedValue >= (totalOfferedValue * FAIRNESS_THRESHOLD) / 100;
    }

    function _calculateBundleValue(AssetBundle calldata bundle) internal view returns (uint256) {
        uint256 totalValue = 0;

        // 1. Value ERC-20s via standard Data Feeds
        for (uint i = 0; i < bundle.erc20s.length; i++) {
            totalValue += (_getCurrencyPrice(bundle.erc20s[i]) * bundle.erc20Amounts[i]);
        }

        // 2. Value NFTs via Floor Price (updated via Chainlink Functions)
        for (uint i = 0; i < bundle.nfts.length; i++) {
            totalValue += nftFloorPrices[bundle.nfts[i]];
        }

        return totalValue;
    }

    function _getCurrencyPrice(address token) internal view returns (uint256) {
        address feed = tokenFeeds[token];
        if (feed == address(0)) revert("Guardian: Oracle Missing for Asset");
        
        (, int256 price, , , ) = AggregatorV3Interface(feed).latestRoundData();
        return uint256(price);
    }
}
