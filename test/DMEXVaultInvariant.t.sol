// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Test, console} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {DMEXVault} from "../contracts/core/DMEXVault.sol";
import {GameCurrency, GameAssetUnique, GameCommodity} from "../contracts/mocks/MockGameAssets.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ─────────────────────────────────────────────────────────────
// Handler — the only contract Foundry calls during invariant runs.
// Exposes controlled actions and tracks ghost variables.
// ─────────────────────────────────────────────────────────────
contract DMEXVaultHandler is Test {
    DMEXVault public vault;
    GameCurrency public gold;
    GameCurrency public usdc;

    uint256 public constant GUARDIAN_PK = 0x1234;
    address public guardian;
    address public treasury;

    address public PLAYER_A = address(0x111);
    address public PLAYER_B = address(0x222);

    // Ghost variable: total ERC20 tokens the vault *should* hold
    uint256 public ghostLockedGold;
    uint256 public ghostLockedUsdc;

    // Track all committed swapIds
    bytes32[] public swapIds;

    // Per-swap tracking
    mapping(bytes32 => uint256) public lockedGoldBySwap;

    string  constant SECRET      = "invariantSecret";
    bytes32 constant SECRET_HASH = sha256("invariantSecret");

    constructor(DMEXVault _vault, GameCurrency _gold, GameCurrency _usdc, address _treasury) {
        vault    = _vault;
        gold     = _gold;
        usdc     = _usdc;
        treasury = _treasury;
        guardian  = vm.addr(GUARDIAN_PK);
    }

    // ── Action: commitSwap ───────────────────────────────────────
    function commitSwap(uint96 rawAmt, uint96 rawWant, uint40 rawExpiry) external {
        uint256 amtA  = bound(uint256(rawAmt),  1e18, 1e24);
        uint256 amtB  = bound(uint256(rawWant), 1e18, 1e24);
        uint256 expiry = block.timestamp + bound(uint256(rawExpiry), 1 hours, 30 days);

        bytes32 swapId = keccak256(abi.encodePacked("inv", swapIds.length));

        // Skip if swapId already used
        (,,,,,,bool _isActive,) = vault.swaps(swapId);
        if (_isActive) return;

        gold.mint(PLAYER_A, amtA);

        DMEXVault.Asset[] memory myAssets = new DMEXVault.Asset[](1);
        myAssets[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20, address(gold), 0, amtA);

        DMEXVault.Asset[] memory wantedAssets = new DMEXVault.Asset[](1);
        wantedAssets[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20, address(usdc), 0, amtB);

        vm.startPrank(PLAYER_A);
        gold.approve(address(vault), amtA);
        try vault.commitSwap(swapId, PLAYER_B, expiry, SECRET_HASH, myAssets, wantedAssets) {
            ghostLockedGold      += amtA;
            lockedGoldBySwap[swapId] = amtA;
            swapIds.push(swapId);
        } catch { /* ignore expected reverts */ }
        vm.stopPrank();
    }

    // ── Action: executeSwap ──────────────────────────────────────
    function executeSwap(uint256 idxSeed, uint256 wantAmt) external {
        if (swapIds.length == 0) return;
        bytes32 swapId = swapIds[idxSeed % swapIds.length];

        (,, uint256 expiry,, bool isExecuted, bool isRefunded, bool isActive,) = vault.swaps(swapId);
        if (!isActive || isExecuted || isRefunded || block.timestamp > expiry) return;

        uint256 amtB = bound(wantAmt, 1e18, 1e24);
        usdc.mint(PLAYER_B, amtB);

        // Build arbiter payload: riskScore=10, dynamicTaxBps=0, isSpiralHalt=false
        DMEXVault.ArbiterPayload memory payload = DMEXVault.ArbiterPayload({
            riskScore: 10,
            dynamicTaxBps: 0,
            isSpiralHalt: false
        });

        bytes32 msgHash  = keccak256(abi.encodePacked(swapId, payload.riskScore, payload.dynamicTaxBps, payload.isSpiralHalt));
        bytes32 ethHash  = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(GUARDIAN_PK, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.startPrank(PLAYER_B);
        usdc.approve(address(vault), amtB);
        try vault.executeSwap(swapId, SECRET, payload, sig) {
            ghostLockedGold -= lockedGoldBySwap[swapId];
            lockedGoldBySwap[swapId] = 0;
        } catch { /* reverting is fine — ghost stays consistent */ }
        vm.stopPrank();
    }

    // ── Action: refundSwap ───────────────────────────────────────
    function refundSwap(uint256 idxSeed) external {
        if (swapIds.length == 0) return;
        bytes32 swapId = swapIds[idxSeed % swapIds.length];

        (,, uint256 expiry,, bool isExecuted, bool isRefunded, bool isActive,) = vault.swaps(swapId);
        if (!isActive || isExecuted || isRefunded || block.timestamp <= expiry) return;

        vm.prank(PLAYER_A);
        try vault.refundSwap(swapId) {
            ghostLockedGold -= lockedGoldBySwap[swapId];
            lockedGoldBySwap[swapId] = 0;
        } catch { /* ignore */ }
    }

    // ── Action: warp time ────────────────────────────────────────
    function warpTime(uint32 delta) external {
        vm.warp(block.timestamp + bound(uint256(delta), 0, 2 days));
    }

    // ── Helpers for invariant checks ─────────────────────────────
    function getSwapIdsLength() external view returns (uint256) {
        return swapIds.length;
    }
    function getSwapId(uint256 i) external view returns (bytes32) {
        return swapIds[i];
    }
}

// ─────────────────────────────────────────────────────────────
// Invariant Test Contract
// ─────────────────────────────────────────────────────────────
contract DMEXVaultInvariant is StdInvariant, Test {
    DMEXVault        public vault;
    GameCurrency     public gold;
    GameCurrency     public usdc;
    DMEXVaultHandler public handler;

    address public treasury = address(0x999);

    function setUp() public {
        // Deploy vault via UUPS proxy
        DMEXVault logic = new DMEXVault();
        address guardianAddr = vm.addr(0x1234);
        bytes memory initData = abi.encodeWithSelector(
            DMEXVault.initialize.selector,
            address(this),
            guardianAddr,
            treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(logic), initData);
        vault = DMEXVault(address(proxy));

        gold = new GameCurrency();
        usdc = new GameCurrency();
        handler = new DMEXVaultHandler(vault, gold, usdc, treasury);

        // Only the handler drives state changes
        targetContract(address(handler));
    }

    // ─────────────────────────────────────────────────────────
    // INVARIANT 1: VAULT SOLVENCY
    // The vault's actual GOLD balance must always be ≥ the sum
    // of all known locked amounts tracked by the handler's ghost.
    // Proves: funds can never silently leak from the vault.
    // ─────────────────────────────────────────────────────────
    function invariant_vaultSolvency() public view {
        uint256 vaultBalance = gold.balanceOf(address(vault));
        assertGe(
            vaultBalance,
            handler.ghostLockedGold(),
            "INVARIANT BROKEN: vault gold balance < sum of locked assets"
        );
    }

    // ─────────────────────────────────────────────────────────
    // INVARIANT 2: NO DOUBLE FINALIZATION
    // A swap can never simultaneously have isExecuted=true AND
    // isRefunded=true. These flags are mutually exclusive.
    // ─────────────────────────────────────────────────────────
    function invariant_noDoubleFinalization() public view {
        uint256 len = handler.getSwapIdsLength();
        for (uint256 i = 0; i < len; i++) {
            bytes32 swapId = handler.getSwapId(i);
            (,,,, bool isExecuted, bool isRefunded,,) = vault.swaps(swapId);
            assertFalse(
                isExecuted && isRefunded,
                "INVARIANT BROKEN: swap is both executed and refunded"
            );
        }
    }

    // ─────────────────────────────────────────────────────────
    // INVARIANT 3: EXECUTED SWAP IS IRREVERSIBLE
    // Once isExecuted=true, isRefunded must stay false.
    // Finalization is a one-way door.
    // ─────────────────────────────────────────────────────────
    function invariant_executedSwapIsIrreversible() public view {
        uint256 len = handler.getSwapIdsLength();
        for (uint256 i = 0; i < len; i++) {
            bytes32 swapId = handler.getSwapId(i);
            (,,,, bool isExecuted, bool isRefunded,,) = vault.swaps(swapId);
            if (isExecuted) {
                assertFalse(
                    isRefunded,
                    "INVARIANT BROKEN: executed swap was subsequently refunded"
                );
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // INVARIANT 4: NON-ZERO INITIATOR
    // Every active swap must have a non-zero initiator address.
    // Ensures commitSwap properly records the caller.
    // ─────────────────────────────────────────────────────────
    function invariant_activeSwapHasInitiator() public view {
        uint256 len = handler.getSwapIdsLength();
        for (uint256 i = 0; i < len; i++) {
            bytes32 swapId = handler.getSwapId(i);
            (address initiator,,,,,, bool isActive,) = vault.swaps(swapId);
            if (isActive) {
                assertNotEq(
                    initiator,
                    address(0),
                    "INVARIANT BROKEN: active swap has zero initiator"
                );
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // INVARIANT 5: EXPIRY MONOTONICITY
    // Every committed swap must have a non-zero expiry.
    // ─────────────────────────────────────────────────────────
    function invariant_swapExpiryIsNonZero() public view {
        uint256 len = handler.getSwapIdsLength();
        for (uint256 i = 0; i < len; i++) {
            bytes32 swapId = handler.getSwapId(i);
            (,, uint256 expiry,,,, bool isActive,) = vault.swaps(swapId);
            if (isActive) {
                assertGt(
                    expiry,
                    0,
                    "INVARIANT BROKEN: active swap has zero expiry"
                );
            }
        }
    }
}
