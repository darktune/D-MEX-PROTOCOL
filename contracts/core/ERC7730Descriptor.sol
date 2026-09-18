// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/**
 * @title ERC-7730: Clear Signing Descriptor Registry (On-Chain)
 * @notice Implements the on-chain component of ERC-7730 (Clear Signing for Wallets).
 *         Stores human-readable function descriptors so hardware/software wallets
 *         can display WHAT the user is actually signing instead of raw calldata hex.
 *
 * @dev ERC-7730 defines a JSON metadata format. This contract stores the on-chain
 *      descriptor hash and serves as the attestation anchor. The actual JSON file
 *      lives in the public registry (see /erc7730/dmex-vault.json).
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-7730
 */
contract ERC7730Descriptor {
    // ─── Types ─────────────────────────────────────────────────────
    struct FunctionDescriptor {
        bytes4 selector;        // Function selector (e.g., 0x commitSwap)
        string humanLabel;      // e.g., "Commit Swap — Lock Your Assets"
        string description;     // Full description of what signing this does
        string[] paramLabels;   // Human-readable labels for each parameter
        string warningMessage;  // Optional warning for dangerous operations
    }

    struct ContractDescriptor {
        address contractAddress;
        string  contractName;
        string  version;
        uint256 chainId;
        bytes32 descriptorHash;   // keccak256 of the off-chain JSON descriptor
        address attestor;         // Who vouches for this descriptor's accuracy
        uint256 attestedAt;       // Timestamp of attestation
        bool    isActive;
    }

    // ─── State ─────────────────────────────────────────────────────
    // Contract address => ContractDescriptor
    mapping(address => ContractDescriptor) public descriptors;
    
    // Contract address => function selector => FunctionDescriptor
    mapping(address => mapping(bytes4 => FunctionDescriptor)) public functionDescriptors;
    
    // Approved attestors (auditors who can vouch for descriptor accuracy)
    mapping(address => bool) public approvedAttestors;
    
    address public owner;

    // ─── Events ────────────────────────────────────────────────────
    event DescriptorRegistered(address indexed contractAddress, string contractName, bytes32 descriptorHash);
    event FunctionDescriptorSet(address indexed contractAddress, bytes4 indexed selector, string humanLabel);
    event DescriptorAttested(address indexed contractAddress, address indexed attestor, bytes32 descriptorHash);
    event AttestorApproved(address indexed attestor);
    event AttestorRevoked(address indexed attestor);

    // ─── Modifiers ─────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "ERC7730: not owner");
        _;
    }

    modifier onlyAttestor() {
        require(approvedAttestors[msg.sender], "ERC7730: not approved attestor");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
        approvedAttestors[msg.sender] = true;
    }

    // ─── Admin Functions ───────────────────────────────────────────
    function approveAttestor(address attestor) external onlyOwner {
        approvedAttestors[attestor] = true;
        emit AttestorApproved(attestor);
    }

    function revokeAttestor(address attestor) external onlyOwner {
        approvedAttestors[attestor] = false;
        emit AttestorRevoked(attestor);
    }

    // ─── Registration ──────────────────────────────────────────────

    /**
     * @notice Register a contract's ERC-7730 clear signing descriptor.
     * @param contractAddress The contract to register descriptors for
     * @param contractName    Human-readable name (e.g., "D-MEX Vault")
     * @param version         Version string (e.g., "3.0.0")
     * @param chainId         Chain ID where the contract is deployed
     * @param descriptorHash  keccak256 hash of the off-chain JSON descriptor
     */
    function registerDescriptor(
        address contractAddress,
        string calldata contractName,
        string calldata version,
        uint256 chainId,
        bytes32 descriptorHash
    ) external onlyOwner {
        descriptors[contractAddress] = ContractDescriptor({
            contractAddress: contractAddress,
            contractName: contractName,
            version: version,
            chainId: chainId,
            descriptorHash: descriptorHash,
            attestor: address(0),
            attestedAt: 0,
            isActive: true
        });

        emit DescriptorRegistered(contractAddress, contractName, descriptorHash);
    }

    /**
     * @notice Set a human-readable description for a specific function.
     * @param contractAddress The contract this function belongs to
     * @param selector        The 4-byte function selector
     * @param humanLabel      Short human-readable label
     * @param description     Detailed description
     * @param paramLabels     Labels for each parameter
     * @param warningMessage  Warning for dangerous operations (empty if safe)
     */
    function setFunctionDescriptor(
        address contractAddress,
        bytes4 selector,
        string calldata humanLabel,
        string calldata description,
        string[] calldata paramLabels,
        string calldata warningMessage
    ) external onlyOwner {
        functionDescriptors[contractAddress][selector] = FunctionDescriptor({
            selector: selector,
            humanLabel: humanLabel,
            description: description,
            paramLabels: paramLabels,
            warningMessage: warningMessage
        });

        emit FunctionDescriptorSet(contractAddress, selector, humanLabel);
    }

    /**
     * @notice Attestors (auditors) vouch for the accuracy of a descriptor.
     *         This is per ERC-8176 attestation framework.
     * @param contractAddress The contract whose descriptor is being attested
     * @param descriptorHash  The hash the attestor is vouching for
     */
    function attestDescriptor(
        address contractAddress,
        bytes32 descriptorHash
    ) external onlyAttestor {
        ContractDescriptor storage desc = descriptors[contractAddress];
        require(desc.isActive, "ERC7730: descriptor not registered");
        require(desc.descriptorHash == descriptorHash, "ERC7730: hash mismatch");

        desc.attestor = msg.sender;
        desc.attestedAt = block.timestamp;

        emit DescriptorAttested(contractAddress, msg.sender, descriptorHash);
    }

    // ─── View Functions ────────────────────────────────────────────

    /**
     * @notice Get the clear-signing label for a function call.
     *         Wallets call this to display what the user is signing.
     */
    function getHumanLabel(
        address contractAddress,
        bytes4 selector
    ) external view returns (string memory label, string memory warning, bool isAttested) {
        FunctionDescriptor storage fd = functionDescriptors[contractAddress][selector];
        ContractDescriptor storage cd = descriptors[contractAddress];
        return (
            bytes(fd.humanLabel).length > 0 ? fd.humanLabel : "Unknown Function",
            fd.warningMessage,
            cd.attestor != address(0)
        );
    }

    /**
     * @notice Check if a descriptor is registered and attested.
     */
    function isDescriptorValid(address contractAddress) external view returns (bool registered, bool attested) {
        ContractDescriptor storage cd = descriptors[contractAddress];
        return (cd.isActive, cd.attestor != address(0));
    }
}
