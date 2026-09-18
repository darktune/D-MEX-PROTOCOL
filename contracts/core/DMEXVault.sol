// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

// Inlined to avoid the massive @chainlink/contracts dependency
interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

// Interfaces for heterogeneous GameFi assets
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IERC721 {
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC1155 {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

/**
 * @title D-MEX Vault (Protocol Master Injection V3.0)
 * @notice Handles Atomic Multi-Asset GameFi Barters (ERC-20, 721, 1155) with Sovereign Arbiter Security.
 * @dev Inherits structure from UniversalVault but introduces Peg-Defense, SLP dynamics, and Anti-Spiral circuit breakers.
 */
contract DMEXVault is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    
    // --- Enums and Structs ---
    enum AssetType { ERC20, ERC721, ERC1155 }

    struct Asset {
        AssetType assetType;
        address token;
        uint256 id;     // Used for 721 and 1155
        uint256 amount; // Used for 20 and 1155
    }

    struct Swap {
        address initiator;
        address counterparty;
        uint256 expiry;
        bytes32 secretHash; // HTLC
        bool isExecuted;
        bool isRefunded;
        bool isActive;
        uint8 aiRiskScore;
    }

    struct ArbiterPayload {
        uint8 riskScore;
        uint256 dynamicTaxBps; // Exit tax basis points for Peg-Defense
        bool isSpiralHalt;     // Anti-Spiral circuit breaker
    }

    // --- State Variables ---
    mapping(bytes32 => Swap) public swaps;
    mapping(bytes32 => Asset[]) public initiatorBundles;
    mapping(bytes32 => Asset[]) public counterpartyBundles;
    mapping(address => address) public priceFeeds; // Token => Chainlink Feed

    // D-MEX Specific State
    address public guardianSigner;
    address public protocolTreasury; // Receives dynamic exit taxes for POL rebalancing

    // --- Events ---
    event SwapCommitted(bytes32 indexed swapId, address indexed initiator, address indexed counterparty);
    event SwapExecuted(bytes32 indexed swapId, uint256 exitTaxCollected);
    event SwapRefunded(bytes32 indexed swapId);
    event AntiSpiralHaltTriggered(bytes32 indexed swapId);
    event GuardianSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PriceFeedUpdated(address indexed token, address indexed feed);

    // --- Modifiers ---
    modifier nonReentrantTransient() {
        assembly {
            if tload(0) {
                mstore(0x00, 0x3ee5aeb5) // ReentrancyGuardReentrantCall()
                revert(0x1c, 0x04)
            }
            tstore(0, 1)
        }
        _;
        assembly {
            tstore(0, 0)
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address _guardianSigner, address _treasury) public initializer {
        __Ownable_init(initialOwner);
        // Note: UUPSUpgradeable in OZ v5 is stateless — no init needed
        guardianSigner = _guardianSigner;
        protocolTreasury = _treasury;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // --- Admin Functions ---
    function setPriceFeed(address token, address feed) external onlyOwner {
        priceFeeds[token] = feed;
        emit PriceFeedUpdated(token, feed);
    }

    function setGuardianSigner(address _guardian) external onlyOwner {
        require(_guardian != address(0), "Zero address");
        emit GuardianSignerUpdated(guardianSigner, _guardian);
        guardianSigner = _guardian;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        emit TreasuryUpdated(protocolTreasury, _treasury);
        protocolTreasury = _treasury;
    }

    // --- Core Protocol ---

    /**
     * @notice Step 1: Commitment Phase via HTLC pattern.
     */
    function commitSwap(
        bytes32 swapId,
        address counterparty,
        uint256 expiry,
        bytes32 secretHash,
        Asset[] calldata myAssets,
        Asset[] calldata wantedAssets
    ) external nonReentrantTransient {
        require(!swaps[swapId].isActive, "Swap already exists");
        require(expiry > block.timestamp, "Invalid expiry");
        require(myAssets.length > 0 && myAssets.length <= 20, "Invalid bundle size");
        require(wantedAssets.length > 0 && wantedAssets.length <= 20, "Invalid bundle size");

        swaps[swapId] = Swap({
            initiator: msg.sender,
            counterparty: counterparty,
            expiry: expiry,
            secretHash: secretHash,
            isExecuted: false,
            isRefunded: false,
            isActive: true,
            aiRiskScore: 0
        });

        for (uint256 i = 0; i < myAssets.length; i++) {
            initiatorBundles[swapId].push(myAssets[i]);
        }
        for (uint256 i = 0; i < wantedAssets.length; i++) {
            counterpartyBundles[swapId].push(wantedAssets[i]);
        }

        // Pull initiator assets
        _batchTransferIn(msg.sender, myAssets);

        emit SwapCommitted(swapId, msg.sender, counterparty);
    }

    /**
     * @notice Step 4: Atomic Execution with Peg-Defense validation.
     * Guardian signature enforces dynamic logic: "SpiralHalt", "Dynamic Exit Tax".
     */
    function executeSwap(
        bytes32 swapId,
        string calldata secret,
        ArbiterPayload calldata payload,
        bytes calldata aiSignature
    ) external nonReentrantTransient {
        Swap storage swp = swaps[swapId];
        require(swp.isActive, "Swap not active");
        require(!swp.isExecuted && !swp.isRefunded, "Swap finalized");
        require(block.timestamp <= swp.expiry, "Swap expired");
        require(msg.sender == swp.counterparty, "Only counterparty");
        
        // HTLC Check
        require(sha256(abi.encodePacked(secret)) == swp.secretHash, "Invalid secret");

        // Sovereign Arbiter Validation (Circuit Breaker & Threat Check)
        _validateArbiterSignature(swapId, payload, aiSignature);
        
        if (payload.isSpiralHalt) {
            emit AntiSpiralHaltTriggered(swapId);
            revert("Arbiter: Anti-Spiral Circuit Breaker Active");
        }

        // Execution State Update (CEI: set ALL state before external calls)
        swp.isExecuted = true;
        swp.isActive   = false; // Explicitly deactivate — triggers EIP-3529 gas refund
        swp.aiRiskScore = payload.riskScore;

        // Pull Counterparty assets
        Asset[] memory expectedB = counterpartyBundles[swapId];
        _batchTransferIn(msg.sender, expectedB);

        Asset[] memory expectedA = initiatorBundles[swapId];
        
        // --- D-MEX Peg Defense: Dynamic Exit Taxes ---
        // SECURITY: Cap tax at 10% (1000 bps) to prevent treasury drain attacks
        require(payload.dynamicTaxBps <= 1000, "Tax exceeds 10% cap");
        uint256 totalTaxCollected = 0;
        if (payload.dynamicTaxBps > 0) {
            // Apply tax to ERC-20 token flows exiting to B
            for (uint256 i = 0; i < expectedA.length; i++) {
                if (expectedA[i].assetType == AssetType.ERC20) {
                    uint256 tax = (expectedA[i].amount * payload.dynamicTaxBps) / 10000;
                    expectedA[i].amount -= tax; // Deduct tax from B's payout
                    _transferSingleOut(protocolTreasury, expectedA[i].assetType, expectedA[i].token, expectedA[i].id, tax);
                    totalTaxCollected += tax;
                }
            }
        }

        // Send adjusted A's bundle to B
        _batchTransferOut(msg.sender, expectedA);
        // Send B's bundle to A
        _batchTransferOut(swp.initiator, expectedB);

        emit SwapExecuted(swapId, totalTaxCollected);
    }

    /**
     * @notice Step 5: Refundability
     */
    function refundSwap(bytes32 swapId) external nonReentrantTransient {
        Swap storage swp = swaps[swapId];
        require(swp.isActive, "Swap not active");
        require(!swp.isExecuted && !swp.isRefunded, "Swap finalized");
        require(block.timestamp > swp.expiry, "Swap not expired");
        require(msg.sender == swp.initiator, "Only initiator");

        swp.isRefunded = true;
        swp.isActive   = false; // Explicitly deactivate — triggers EIP-3529 gas refund
        
        // Return assets to A
        Asset[] memory myAssets = initiatorBundles[swapId];
        _batchTransferOut(msg.sender, myAssets);

        emit SwapRefunded(swapId);
    }

    // --- Internal Helpers ---

    /**
     * @dev Validates the Guardian Arbiter signed payload.
     */
    function _validateArbiterSignature(bytes32 swapId, ArbiterPayload calldata payload, bytes calldata signature) internal view {
        require(payload.riskScore < 50, "Threat detected by Arbiter");
        
        bytes32 messageHash = keccak256(abi.encodePacked(swapId, payload.riskScore, payload.dynamicTaxBps, payload.isSpiralHalt));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        // SECURITY: EIP-2 signature malleability protection
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "Invalid s value");
        require(v == 27 || v == 28, "Invalid v value");
        address signer = ecrecover(ethSignedMessageHash, v, r, s);
        require(signer == guardianSigner && signer != address(0), "Invalid Arbiter signature");
    }

    function _batchTransferIn(address from, Asset[] memory assets) internal {
        for (uint256 i = 0; i < assets.length; i++) {
            Asset memory asset = assets[i];
            if (asset.assetType == AssetType.ERC20) {
                // Yul transferFrom — handles non-standard tokens (USDT-style: no return value)
                // Safe check: call must succeed AND (returndatasize==0 OR returned bool==true)
                address token = asset.token; uint256 amt = asset.amount;
                assembly {
                    let ptr := mload(0x40)
                    mstore(ptr, 0x23b872dd00000000000000000000000000000000000000000000000000000000)
                    mstore(add(ptr, 0x04), and(from, 0xffffffffffffffffffffffffffffffffffffffff))
                    mstore(add(ptr, 0x24), and(address(), 0xffffffffffffffffffffffffffffffffffffffff))
                    mstore(add(ptr, 0x44), amt)
                    let success := call(gas(), token, 0, ptr, 0x64, ptr, 0x20)
                    // Revert if call failed OR (returned data AND it's false)
                    if iszero(and(success, or(iszero(returndatasize()), mload(ptr)))) {
                        revert(0, 0)
                    }
                }
            } else if (asset.assetType == AssetType.ERC721) {
                IERC721(asset.token).transferFrom(from, address(this), asset.id);
            } else if (asset.assetType == AssetType.ERC1155) {
                IERC1155(asset.token).safeTransferFrom(from, address(this), asset.id, asset.amount, "");
            }
        }
    }

    function _batchTransferOut(address to, Asset[] memory assets) internal {
        for (uint256 i = 0; i < assets.length; i++) {
            _transferSingleOut(to, assets[i].assetType, assets[i].token, assets[i].id, assets[i].amount);
        }
    }

    function _transferSingleOut(address to, AssetType aType, address token, uint256 id, uint256 amount) internal {
        if (aType == AssetType.ERC20) {
            // Yul transfer — safe for non-standard ERC-20 tokens (no return value)
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
                mstore(add(ptr, 0x24), amount)
                let success := call(gas(), token, 0, ptr, 0x44, ptr, 0x20)
                if iszero(and(success, or(iszero(returndatasize()), mload(ptr)))) {
                    revert(0, 0)
                }
            }
        } else if (aType == AssetType.ERC721) {
            IERC721(token).transferFrom(address(this), to, id);
        } else if (aType == AssetType.ERC1155) {
            IERC1155(token).safeTransferFrom(address(this), to, id, amount, "");
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02; // IERC721Receiver.onERC721Received.selector
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }
    
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return 0xbc197c81;
    }

    function _splitSignature(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "invalid signature length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
}
