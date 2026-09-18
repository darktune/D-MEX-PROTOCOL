// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {UDGAP_AssetRegistry} from "./UDGAP_AssetRegistry.sol";

/**
 * @title UDGAP Guardian
 * @notice The Guardian AI / EigenLayer AVS interface.
 * It receives off-chain authenticity proofs (from MeshLLM) and triggers asset minting/transfering.
 */
contract UDGAP_Guardian is Ownable {

    UDGAP_AssetRegistry public assetRegistry;
    
    // Address of the authorized relayer (e.g., EigenLayer AVS operator)
    address public avsOperator;

    event VerificationRequested(address indexed user, string modelUrl, bytes32 metadataHash);
    event AssetVerifiedAndMinted(address indexed user, uint256 indexed tokenId, uint256 score);

    modifier onlyOperator() {
        require(msg.sender == avsOperator, "UDGAP: Caller is not the AVS Operator");
        _;
    }

    constructor(address _avsOperator) Ownable(msg.sender) {
        avsOperator = _avsOperator;
    }

    function setAssetRegistry(address _registry) external onlyOwner {
        assetRegistry = UDGAP_AssetRegistry(_registry);
    }

    function setAvsOperator(address _operator) external onlyOwner {
        avsOperator = _operator;
    }

    /**
     * @notice Users request verification of their 3D asset by providing a URL to the mesh.
     * The off-chain MeshLLM service listens for this event.
     */
    function requestVerification(string calldata modelUrl, bytes32 metadataHash) external {
        emit VerificationRequested(msg.sender, modelUrl, metadataHash);
    }

    /**
     * @notice Called by the AVS Operator after off-chain MeshLLM fingerprinting and verification.
     */
    function submitVerificationAndMint(
        address to,
        uint256 tokenId,
        UDGAP_AssetRegistry.AssetFingerprint calldata fingerprint,
        bytes memory data
    ) external onlyOperator {
        require(address(assetRegistry) != address(0), "UDGAP: Registry not set");
        
        // Ensure authenticity score is high enough
        require(fingerprint.meshLLMAuthenticityScore >= 9500, "UDGAP: Score too low");

        // Mint the asset via the registry
        assetRegistry.verifiedMint(to, tokenId, 1, data, fingerprint);

        emit AssetVerifiedAndMinted(to, tokenId, fingerprint.meshLLMAuthenticityScore);
    }
}
