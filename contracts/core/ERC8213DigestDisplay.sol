// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/**
 * @title ERC-8213: Wallet Signature & Calldata Digest Display
 * @notice Implements ERC-8213 for D-MEX Protocol transactions.
 *         Generates a deterministic 32-byte digest of any swap calldata
 *         that users can independently verify on a separate device before
 *         signing on their hardware wallet.
 *
 * @dev The core idea: instead of forcing users to parse raw calldata on a
 *      tiny Ledger screen, we display a single 32-byte digest. The user
 *      computes the same digest on their computer and compares it to what
 *      the hardware wallet shows. If they match → the transaction is what
 *      the user expects.
 *
 * Flow:
 *   1. Frontend calls computeSwapDigest() with the swap parameters
 *   2. User sees the digest on their computer screen
 *   3. Hardware wallet displays the same digest during signing
 *   4. User compares → confirms or rejects
 *
 * Reference: https://ethereum-magicians.org/t/erc-8213-wallet-calldata-digest
 */
contract ERC8213DigestDisplay {

    // ─── Domain Separator (EIP-712 style) ──────────────────────────
    bytes32 public immutable DOMAIN_SEPARATOR;

    // Type hashes for EIP-712 structured data
    bytes32 public constant COMMIT_SWAP_TYPEHASH = keccak256(
        "CommitSwap(bytes32 swapId,address counterparty,uint256 expiry,bytes32 secretHash,bytes32 assetsHash)"
    );

    bytes32 public constant EXECUTE_SWAP_TYPEHASH = keccak256(
        "ExecuteSwap(bytes32 swapId,string secret,uint8 riskScore,uint256 dynamicTaxBps,bool isSpiralHalt)"
    );

    bytes32 public constant REFUND_SWAP_TYPEHASH = keccak256(
        "RefundSwap(bytes32 swapId)"
    );

    // ─── Events ────────────────────────────────────────────────────
    event DigestComputed(
        bytes32 indexed swapId,
        bytes32 digest,
        string  functionName,
        address indexed signer,
        uint256 timestamp
    );

    // ─── Digest History ────────────────────────────────────────────
    // Stores the last computed digest for verification
    mapping(address => mapping(bytes32 => bytes32)) public lastDigest;

    // ─── Constructor ───────────────────────────────────────────────
    constructor(string memory name, string memory version, uint256 chainId, address verifyingContract) {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifyingContract
            )
        );
    }

    // ─── Public Digest Computation ─────────────────────────────────

    /**
     * @notice Compute the digest for a commitSwap transaction.
     *         The user MUST compare this value with what their hardware wallet displays.
     *
     * @param swapId        Unique swap identifier
     * @param counterparty  The other party in the swap
     * @param expiry        Expiration timestamp
     * @param secretHash    HTLC secret hash
     * @param myAssetsHash  keccak256 of the encoded asset bundle
     * @return digest       The 32-byte digest to verify
     */
    function computeCommitSwapDigest(
        bytes32 swapId,
        address counterparty,
        uint256 expiry,
        bytes32 secretHash,
        bytes32 myAssetsHash
    ) external returns (bytes32 digest) {
        bytes32 structHash = keccak256(
            abi.encode(
                COMMIT_SWAP_TYPEHASH,
                swapId,
                counterparty,
                expiry,
                secretHash,
                myAssetsHash
            )
        );

        digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        lastDigest[msg.sender][swapId] = digest;

        emit DigestComputed(swapId, digest, "commitSwap", msg.sender, block.timestamp);
        return digest;
    }

    /**
     * @notice Compute the digest for an executeSwap transaction.
     *
     * @param swapId          Swap to execute
     * @param secret          HTLC secret string
     * @param riskScore       Arbiter-assigned risk score
     * @param dynamicTaxBps   Exit tax basis points
     * @param isSpiralHalt    Circuit breaker flag
     * @return digest         The 32-byte digest to verify
     */
    function computeExecuteSwapDigest(
        bytes32 swapId,
        string calldata secret,
        uint8 riskScore,
        uint256 dynamicTaxBps,
        bool isSpiralHalt
    ) external returns (bytes32 digest) {
        bytes32 structHash = keccak256(
            abi.encode(
                EXECUTE_SWAP_TYPEHASH,
                swapId,
                keccak256(bytes(secret)),
                riskScore,
                dynamicTaxBps,
                isSpiralHalt
            )
        );

        digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        lastDigest[msg.sender][swapId] = digest;

        emit DigestComputed(swapId, digest, "executeSwap", msg.sender, block.timestamp);
        return digest;
    }

    /**
     * @notice Compute the digest for a refundSwap transaction.
     *
     * @param swapId   Swap to refund
     * @return digest  The 32-byte digest to verify
     */
    function computeRefundSwapDigest(
        bytes32 swapId
    ) external returns (bytes32 digest) {
        bytes32 structHash = keccak256(
            abi.encode(
                REFUND_SWAP_TYPEHASH,
                swapId
            )
        );

        digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        lastDigest[msg.sender][swapId] = digest;

        emit DigestComputed(swapId, digest, "refundSwap", msg.sender, block.timestamp);
        return digest;
    }

    // ─── View Functions ────────────────────────────────────────────

    /**
     * @notice Verify that a previously computed digest matches expected.
     *         Users call this from a SEPARATE device to confirm integrity.
     *
     * @param signer         Address that computed the digest
     * @param swapId         Swap ID the digest was computed for
     * @param expectedDigest The digest the user computed independently
     * @return isValid       True if digests match
     */
    function verifyDigest(
        address signer,
        bytes32 swapId,
        bytes32 expectedDigest
    ) external view returns (bool isValid) {
        return lastDigest[signer][swapId] == expectedDigest;
    }

    /**
     * @notice Get the last digest computed by a signer for a swap.
     */
    function getLastDigest(address signer, bytes32 swapId) external view returns (bytes32) {
        return lastDigest[signer][swapId];
    }

    /**
     * @notice Utility: compute asset bundle hash off-chain, then pass to computeCommitSwapDigest.
     *         This mirrors how the frontend would prepare the hash.
     */
    function computeAssetBundleHash(
        uint8[] calldata assetTypes,
        address[] calldata tokens,
        uint256[] calldata ids,
        uint256[] calldata amounts
    ) external pure returns (bytes32) {
        require(
            assetTypes.length == tokens.length &&
            tokens.length == ids.length &&
            ids.length == amounts.length,
            "Array length mismatch"
        );
        return keccak256(abi.encode(assetTypes, tokens, ids, amounts));
    }
}
