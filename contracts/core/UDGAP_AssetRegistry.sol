// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title UDGAP Asset Registry
 * @notice Universal Decentralized Game Asset Protocol (UDGAP) Base Registry
 * Instead of simple Token IDs, this registry uses Asset Fingerprints generated
 * by MeshLLM to guarantee cross-game authenticity and prevent counterfeiting.
 */
contract UDGAP_AssetRegistry is ERC1155, Ownable {
    
    struct AssetFingerprint {
        bytes32 geometryHash;
        bytes32 textureHash;
        bytes32 materialHash;
        bytes32 animationHash;
        bytes32 metadataHash;
        uint256 meshLLMAuthenticityScore; // out of 10000 (e.g. 9983 = 99.83%)
    }

    // Mapping from Token ID to its unique Asset Fingerprint
    mapping(uint256 => AssetFingerprint) public assetFingerprints;

    // Address of the Guardian AI / EigenLayer AVS contract authorized to verify assets
    address public guardianVerifier;

    event AssetFingerprinted(uint256 indexed tokenId, bytes32 geometryHash, uint256 authenticityScore);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    modifier onlyGuardian() {
        require(msg.sender == guardianVerifier, "UDGAP: Only authorized guardian");
        _;
    }

    constructor(string memory uri, address _guardianVerifier) ERC1155(uri) Ownable(msg.sender) {
        guardianVerifier = _guardianVerifier;
    }

    function setGuardian(address _newGuardian) external onlyOwner {
        emit GuardianUpdated(guardianVerifier, _newGuardian);
        guardianVerifier = _newGuardian;
    }

    /**
     * @notice Mints a new game asset after verification by the Guardian.
     */
    function verifiedMint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data,
        AssetFingerprint calldata fingerprint
    ) external onlyGuardian {
        // Ensure authenticity score is acceptable (e.g., > 95%)
        require(fingerprint.meshLLMAuthenticityScore >= 9500, "UDGAP: Asset failed authenticity check");

        // Store the fingerprint permanently
        assetFingerprints[id] = fingerprint;

        _mint(to, id, amount, data);

        emit AssetFingerprinted(id, fingerprint.geometryHash, fingerprint.meshLLMAuthenticityScore);
    }
}
