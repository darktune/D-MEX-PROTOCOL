// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

// --- D-MEX GameFi Assets ---

/**
 * @title GameCurrency (ERC20)
 * @notice Represents the in-game fractionalized currency (e.g., Gold).
 */
contract GameCurrency is ERC20 {
    constructor() ERC20("D-MEX Gold", "DGLD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title GameAssetUnique (ERC721)
 * @notice Represents unique high-value items (e.g., Level 99 Swords or Land Deeds).
 */
contract GameAssetUnique is ERC721 {
    uint256 public nextTokenId;

    constructor() ERC721("D-MEX Unique Asset", "DUA") {}

    function mint(address to) external returns (uint256) {
        uint256 tokenId = nextTokenId++;
        _mint(to, tokenId);
        return tokenId;
    }
}

/**
 * @title GameCommodity (ERC1155)
 * @notice Represents stackable GameFi commodity materials (e.g., Wood, Iron, Potions).
 */
contract GameCommodity is ERC1155 {
    constructor() ERC1155("https://dmex.game/api/item/{id}.json") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}

// --- Real-World GameFi Mocks (Cross-Game Barter) ---

/**
 * @title LootMock (ERC721)
 * @notice Mock contract for Loot (for Adventurers)
 */
contract LootMock is ERC721 {
    uint256 public nextTokenId = 1;

    constructor() ERC721("Loot", "LOOT") {}

    function mint(address to) external returns (uint256) {
        uint256 tokenId = nextTokenId++;
        _mint(to, tokenId);
        return tokenId;
    }
}

/**
 * @title CryptoKittiesMock (ERC721)
 * @notice Mock contract for CryptoKitties
 */
contract CryptoKittiesMock is ERC721 {
    uint256 public nextTokenId = 1;

    constructor() ERC721("CryptoKitties", "CK") {}

    function mint(address to) external returns (uint256) {
        uint256 tokenId = nextTokenId++;
        _mint(to, tokenId);
        return tokenId;
    }
}

/**
 * @title GodsUnchainedMock (ERC1155)
 * @notice Mock contract for Gods Unchained Cards
 */
contract GodsUnchainedMock is ERC1155 {
    constructor() ERC1155("https://api.godsunchained.com/v0/proto/{id}") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}

