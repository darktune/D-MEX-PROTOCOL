// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FairValueGuard, AssetBundle} from "../oracles/FairValueGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract UniversalVault is FairValueGuard, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct Trade {
        address partyA;
        address partyB;
        bytes32 offeredHash; // Optimize state storage gas
        bytes32 wantedHash;
        bool partyALocked;
        bool partyBLocked;
        bool active;
        bytes32 metadataHash; // Node A1 requirement
    }

    mapping(bytes32 => Trade) public trades;
    address public guardianSigner;

    event TradeProposed(bytes32 indexed tradeId, address indexed partyA, address indexed partyB);
    event AtomicSwapExecuted(bytes32 indexed tradeId);
    event TradeCancelled(bytes32 indexed tradeId);

    constructor(address _guardianSigner) {
        guardianSigner = _guardianSigner;
    }

    /**
     * @notice Escrow-Commitment: Party A proposes trade and locks assets.
     */
    function proposeTrade(
        bytes32 tradeId,
        address partyB,
        AssetBundle calldata offered,
        AssetBundle calldata wanted,
        bytes32 metadataHash
    ) external nonReentrant {
        require(trades[tradeId].partyA == address(0), "Trade exists");
        
        // Optimistic Locking: Transfer ERC20 & NFT assets from PartyA to Vault
        _lockAssets(msg.sender, offered);

        trades[tradeId] = Trade({
            partyA: msg.sender,
            partyB: partyB,
            offeredHash: keccak256(abi.encode(offered)),
            wantedHash: keccak256(abi.encode(wanted)),
            partyALocked: true,
            partyBLocked: false,
            active: true,
            metadataHash: metadataHash
        });

        emit TradeProposed(tradeId, msg.sender, partyB);
    }

    /**
     * @notice Atomic Swap Execution: verified via Guardian Signature (Node A2, Node A1)
     * @dev Follows strict Checks-Effects-Interactions pattern (Node A3)
     */
    function executeAtomicBarter(
        bytes32 tradeId,
        AssetBundle calldata offered,
        AssetBundle calldata wanted,
        bytes calldata guardianSignature,
        string calldata currentURI
    ) external nonReentrant {
        Trade storage trade = trades[tradeId];
        require(trade.active, "Trade inactive or completed");
        require(msg.sender == trade.partyB, "Only assigned PartyB can execute");

        // Integrity Checks
        require(keccak256(abi.encode(offered)) == trade.offeredHash, "Offered bundle mismatch");
        require(keccak256(abi.encode(wanted)) == trade.wantedHash, "Wanted bundle mismatch");

        // 🔍 Node A1: Metadata Fraud 
        require(keccak256(abi.encodePacked(currentURI)) == trade.metadataHash, "Metadata fraud detected! Guardian alert.");

        // 🔍 Node A2: Fake Liquidity & Fair Trade Check 
        require(validateTradeFairness(offered, wanted), "Unfair trade detected! Blocked by FairValueGuard.");

        // Guardian Verification
        bytes32 messageHash = keccak256(abi.encodePacked(tradeId, trade.metadataHash, trade.offeredHash, trade.wantedHash));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        require(ethSignedMessageHash.recover(guardianSignature) == guardianSigner, "Invalid Guardian Signature");

        // 🔍 Node A3: State update happens BEFORE interactions (CEI logic)
        trade.active = false;
        trade.partyBLocked = true;

        // --- Interactions Block ---
        // 1. Party B -> Party A
        _batchTransferFromTokens(msg.sender, trade.partyA, wanted.erc20s, wanted.erc20Amounts);
        _batchTransferFromNFTs(msg.sender, trade.partyA, wanted.nfts, wanted.nftIds);

        // 2. Vault -> Party B
        _batchTransferTokens(trade.partyB, offered.erc20s, offered.erc20Amounts);
        _batchTransferNFTs(trade.partyB, offered.nfts, offered.nftIds);

        emit AtomicSwapExecuted(tradeId);
    }

    // INTERNAL FUNCS

    function _lockAssets(address from, AssetBundle calldata bundle) internal {
        _batchTransferFromTokens(from, address(this), bundle.erc20s, bundle.erc20Amounts);
        _batchTransferFromNFTs(from, address(this), bundle.nfts, bundle.nftIds);
    }

    // Yul Optimized Batch Transfer (ERC20 sent FROM vault TO recipient)
    function _batchTransferTokens(
        address recipient,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) internal {
        require(tokens.length == amounts.length, "ERC20 Length mismatch");
        assembly {
            let len := tokens.length
            for { let i := 0 } lt(i, len) { i := add(i, 1) } {
                let token := calldataload(add(tokens.offset, mul(i, 0x20)))
                let amount := calldataload(add(amounts.offset, mul(i, 0x20)))
                
                // transfer(address,uint256) selector: 0xa9059cbb
                let ptr := mload(0x40)
                mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), and(recipient, 0xffffffffffffffffffffffffffffffffffffffff))
                mstore(add(ptr, 0x24), amount)

                let success := call(gas(), token, 0, ptr, 0x44, ptr, 0x20)
                let retSize := returndatasize()
                let isValid := and(
                    success,
                    or(
                        iszero(retSize),
                        and(iszero(lt(retSize, 32)), eq(mload(ptr), 1))
                    )
                )

                if iszero(isValid) {
                    revert(0, 0)
                }
            }
        }
    }

    // Yul Optimized TransferFrom (ERC20 sent FROM 'from' TO 'to')
    function _batchTransferFromTokens(
        address from,
        address to,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) internal {
        require(tokens.length == amounts.length, "ERC20 Length mismatch");
        assembly {
            let len := tokens.length
            for { let i := 0 } lt(i, len) { i := add(i, 1) } {
                let token := calldataload(add(tokens.offset, mul(i, 0x20)))
                let amount := calldataload(add(amounts.offset, mul(i, 0x20)))

                // transferFrom(address,address,uint256) selector: 0x23b872dd
                let ptr := mload(0x40)
                mstore(ptr, 0x23b872dd00000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), and(from, 0xffffffffffffffffffffffffffffffffffffffff))
                mstore(add(ptr, 0x24), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
                mstore(add(ptr, 0x44), amount)

                let success := call(gas(), token, 0, ptr, 0x64, ptr, 0x20)
                let retSize := returndatasize()
                let isValid := and(
                    success,
                    or(
                        iszero(retSize),
                        and(iszero(lt(retSize, 32)), eq(mload(ptr), 1))
                    )
                )

                if iszero(isValid) {
                    revert(0, 0)
                }
            }
        }
    }

    function _batchTransferFromNFTs(address from, address to, address[] calldata nfts, uint256[] calldata ids) internal {
        require(nfts.length == ids.length, "NFT Length mismatch");
        for (uint256 i = 0; i < nfts.length; ++i) {
            IERC721(nfts[i]).transferFrom(from, to, ids[i]);
        }
    }

    function _batchTransferNFTs(address to, address[] calldata nfts, uint256[] calldata ids) internal {
        require(nfts.length == ids.length, "NFT Length mismatch");
        for (uint256 i = 0; i < nfts.length; ++i) {
            IERC721(nfts[i]).transferFrom(address(this), to, ids[i]);
        }
    }

    /**
     * @notice Chainlink Functions fulfillment callback
     */
    function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
        // Placeholder implementation for testing
    }
}
