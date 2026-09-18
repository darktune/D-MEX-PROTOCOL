// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Test, console} from "forge-std/Test.sol";
import {DMEXVault} from "../contracts/core/DMEXVault.sol";
import {GameCurrency, GameAssetUnique, GameCommodity} from "../contracts/mocks/MockGameAssets.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract DMEXVaultTest is Test {
    DMEXVault public vault;
    
    GameCurrency public gold;
    GameCurrency public usdc; // Crypto currency
    GameAssetUnique public sword;
    GameCommodity public wood;

    address public owner = address(this);
    uint256 public guardianPrivateKey;
    address public guardianSigner;
    address public treasury = address(0x999);

    address public playerA = address(0x111);
    address public playerB = address(0x222);

    function setUp() public {
        guardianPrivateKey = 0x1234;
        guardianSigner = vm.addr(guardianPrivateKey);

        // Deploy via UUPS proxy (DMEXVault uses _disableInitializers in constructor)
        DMEXVault logic = new DMEXVault();
        bytes memory initData = abi.encodeWithSelector(
            DMEXVault.initialize.selector,
            owner,
            guardianSigner,
            treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(logic), initData);
        vault = DMEXVault(address(proxy));

        gold = new GameCurrency();
        usdc = new GameCurrency();
        sword = new GameAssetUnique();
        wood = new GameCommodity();

        // Mint items to players
        gold.mint(playerA, 1000 * 10**18); // Player A has 1000 Gold
        sword.mint(playerA); // Player A has Sword #0
        
        usdc.mint(playerB, 50 * 10**18); // Player B has 50 USDC
        wood.mint(playerB, 1, 500); // Player B has 500 Wood
    }

    function test_barter_with_peg_defense() public {
        // Player A intent: Give 100 Gold + Sword for 50 USDC + 100 Wood
        
        bytes32 secretHash = sha256(abi.encodePacked("supersecret"));
        bytes32 swapId = keccak256("swap1");

        // Player A sets up Bundles
        DMEXVault.Asset[] memory assetsA = new DMEXVault.Asset[](2);
        assetsA[0] = DMEXVault.Asset({assetType: DMEXVault.AssetType.ERC20, token: address(gold), id: 0, amount: 100 * 10**18});
        assetsA[1] = DMEXVault.Asset({assetType: DMEXVault.AssetType.ERC721, token: address(sword), id: 0, amount: 0});

        DMEXVault.Asset[] memory assetsB = new DMEXVault.Asset[](2);
        assetsB[0] = DMEXVault.Asset({assetType: DMEXVault.AssetType.ERC20, token: address(usdc), id: 0, amount: 50 * 10**18});
        assetsB[1] = DMEXVault.Asset({assetType: DMEXVault.AssetType.ERC1155, token: address(wood), id: 1, amount: 100});

        // Player A approves Vault
        vm.startPrank(playerA);
        gold.approve(address(vault), type(uint256).max);
        sword.approve(address(vault), 0);
        vault.commitSwap(swapId, playerB, block.timestamp + 1 hours, secretHash, assetsA, assetsB);
        vm.stopPrank();

        // Player B approves Vault
        vm.startPrank(playerB);
        usdc.approve(address(vault), type(uint256).max);
        wood.setApprovalForAll(address(vault), true);

        // Simulate Guardian Arbiter signing the payload
        // Payload: riskScore=10, dynamicTaxBps=500 (5%), isSpiralHalt=false
        DMEXVault.ArbiterPayload memory payload = DMEXVault.ArbiterPayload({
            riskScore: 10,
            dynamicTaxBps: 500, // 5% exit tax applied to Player A's ERC20 given to Player B (Gold)
            isSpiralHalt: false
        });

        bytes32 messageHash = keccak256(abi.encodePacked(swapId, payload.riskScore, payload.dynamicTaxBps, payload.isSpiralHalt));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianPrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Player B executes swap
        vault.executeSwap(swapId, "supersecret", payload, signature);
        vm.stopPrank();

        // Assertions

        // Player B should have received the Sword and 95 Gold (100 - 5% tax)
        assertEq(sword.ownerOf(0), playerB);
        assertEq(gold.balanceOf(playerB), 95 * 10**18);

        // Treasury should have received 5 Gold (Peg-Defense Tax)
        assertEq(gold.balanceOf(treasury), 5 * 10**18);

        // Player A should have received 50 USDC and 100 Wood
        assertEq(usdc.balanceOf(playerA), 50 * 10**18);
        assertEq(wood.balanceOf(playerA, 1), 100);
    }

    function test_spiral_halt_revert() public {
        bytes32 secretHash = sha256(abi.encodePacked("supersecret"));
        bytes32 swapId = keccak256("swap2");

        DMEXVault.Asset[] memory assetsA = new DMEXVault.Asset[](1);
        assetsA[0] = DMEXVault.Asset({assetType: DMEXVault.AssetType.ERC20, token: address(gold), id: 0, amount: 100 * 10**18});
        DMEXVault.Asset[] memory assetsB = new DMEXVault.Asset[](1);
        assetsB[0] = DMEXVault.Asset({assetType: DMEXVault.AssetType.ERC20, token: address(usdc), id: 0, amount: 50 * 10**18});

        vm.startPrank(playerA);
        gold.approve(address(vault), type(uint256).max);
        vault.commitSwap(swapId, playerB, block.timestamp + 1 hours, secretHash, assetsA, assetsB);
        vm.stopPrank();

        vm.startPrank(playerB);
        usdc.approve(address(vault), type(uint256).max);

        // Guardian Arbiter triggers Anti-Spiral Halt
        DMEXVault.ArbiterPayload memory payload = DMEXVault.ArbiterPayload({
            riskScore: 20,
            dynamicTaxBps: 0,
            isSpiralHalt: true
        });

        bytes32 messageHash = keccak256(abi.encodePacked(swapId, payload.riskScore, payload.dynamicTaxBps, payload.isSpiralHalt));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianPrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Arbiter: Anti-Spiral Circuit Breaker Active");
        vault.executeSwap(swapId, "supersecret", payload, signature);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────
    // Helper: build ArbiterPayload signature
    // ─────────────────────────────────────────────────────────────
    function _buildArbiterSignature(bytes32 swapId, uint8 riskScore, uint256 taxBps, bool spiralHalt) 
        internal view returns (bytes memory) 
    {
        bytes32 msgHash = keccak256(abi.encodePacked(swapId, riskScore, taxBps, spiralHalt));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianPrivateKey, ethHash);
        return abi.encodePacked(r, s, v);
    }

    // ─────────────────────────────────────────────────────────────
    // Fuzz Test: Signature Replay Attack
    // A valid (swapId1, score) signature MUST fail on swapId2.
    // ─────────────────────────────────────────────────────────────
    function testFuzz_SignatureReplay(uint256 salt1, uint256 salt2) public {
        vm.assume(salt1 != salt2);

        bytes32 swapId1 = keccak256(abi.encodePacked("replay1", salt1));
        bytes32 swapId2 = keccak256(abi.encodePacked("replay2", salt2));

        uint256 amtA = 100e18;
        uint256 amtB = 90e18;

        // Commit swap 1
        gold.mint(playerA, amtA);
        DMEXVault.Asset[] memory assetsA = new DMEXVault.Asset[](1);
        assetsA[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20, address(gold), 0, amtA);
        DMEXVault.Asset[] memory assetsB = new DMEXVault.Asset[](1);
        assetsB[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20, address(usdc), 0, amtB);

        vm.startPrank(playerA);
        gold.approve(address(vault), amtA);
        vault.commitSwap(swapId1, playerB, block.timestamp + 1 hours, sha256(abi.encodePacked("replay_secret")), assetsA, assetsB);
        vm.stopPrank();

        // Commit swap 2
        gold.mint(playerA, amtA);
        vm.startPrank(playerA);
        gold.approve(address(vault), amtA);
        vault.commitSwap(swapId2, playerB, block.timestamp + 1 hours, sha256(abi.encodePacked("replay_secret")), assetsA, assetsB);
        vm.stopPrank();

        // Build a valid signature for swapId1
        bytes memory sigForSwap1 = _buildArbiterSignature(swapId1, 10, 0, false);

        // Try to use swap1's signature on swap2 — MUST revert
        DMEXVault.ArbiterPayload memory payload = DMEXVault.ArbiterPayload({
            riskScore: 10,
            dynamicTaxBps: 0,
            isSpiralHalt: false
        });

        usdc.mint(playerB, amtB);
        vm.startPrank(playerB);
        usdc.approve(address(vault), amtB);
        vm.expectRevert("Invalid Arbiter signature");
        vault.executeSwap(swapId2, "replay_secret", payload, sigForSwap1);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────
    // Fuzz Test: Atomic Execution Integrity
    // Random trade amounts always produce correct final balances.
    // ─────────────────────────────────────────────────────────────
    function testFuzz_AtomicExecution(uint256 amountA, uint256 amountB) public {
        amountA = bound(amountA, 1e18, 1e30);
        amountB = bound(amountB, 1e18, 1e30);

        bytes32 swapId = keccak256(abi.encodePacked("atomic_fuzz", amountA, amountB));

        gold.mint(playerA, amountA);
        usdc.mint(playerB, amountB);

        DMEXVault.Asset[] memory assetsA = new DMEXVault.Asset[](1);
        assetsA[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20, address(gold), 0, amountA);
        DMEXVault.Asset[] memory assetsB = new DMEXVault.Asset[](1);
        assetsB[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20, address(usdc), 0, amountB);

        vm.startPrank(playerA);
        gold.approve(address(vault), amountA);
        vault.commitSwap(swapId, playerB, block.timestamp + 1 hours, sha256(abi.encodePacked("fuzz_secret")), assetsA, assetsB);
        vm.stopPrank();

        bytes memory sig = _buildArbiterSignature(swapId, 10, 0, false);
        DMEXVault.ArbiterPayload memory payload = DMEXVault.ArbiterPayload({
            riskScore: 10, dynamicTaxBps: 0, isSpiralHalt: false
        });

        vm.startPrank(playerB);
        usdc.approve(address(vault), amountB);
        vault.executeSwap(swapId, "fuzz_secret", payload, sig);
        vm.stopPrank();

        // Player B gets gold, Player A gets usdc
        assertEq(gold.balanceOf(playerB), amountA, "Player B should receive exact gold amount");
        assertEq(usdc.balanceOf(playerA), amountB, "Player A should receive exact usdc amount");
        assertEq(gold.balanceOf(address(vault)), 0, "Vault should hold 0 gold after execution");
    }

    // ─────────────────────────────────────────────────────────────
    // Fuzz Test: Refund Integrity After Expiry
    // Initiator always recovers full assets regardless of amount.
    // ─────────────────────────────────────────────────────────────
    function testFuzz_RefundAfterExpiry(uint256 amount) public {
        amount = bound(amount, 1e18, 1e30);

        bytes32 swapId = keccak256(abi.encodePacked("refund_fuzz", amount));

        gold.mint(playerA, amount);
        uint256 balBefore = gold.balanceOf(playerA);

        DMEXVault.Asset[] memory assetsA = new DMEXVault.Asset[](1);
        assetsA[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20, address(gold), 0, amount);
        DMEXVault.Asset[] memory assetsB = new DMEXVault.Asset[](1);
        assetsB[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20, address(usdc), 0, 1e18);

        vm.startPrank(playerA);
        gold.approve(address(vault), amount);
        vault.commitSwap(swapId, playerB, block.timestamp + 1 hours, sha256("x"), assetsA, assetsB);
        vm.stopPrank();

        assertEq(gold.balanceOf(playerA), balBefore - amount, "Gold should be locked in vault");

        // Warp past expiry
        vm.warp(block.timestamp + 2 hours);

        vm.prank(playerA);
        vault.refundSwap(swapId);

        assertEq(gold.balanceOf(playerA), balBefore, "Initiator must recover exact amount after refund");
    }

    // ─────────────────────────────────────────────────────────────
    // Fuzz Test: Multi-Asset Bundle Atomicity
    // A 3-standard swap (ERC-20 + ERC-721 + ERC-1155) must always
    // move ALL assets atomically — no partial execution possible.
    // ─────────────────────────────────────────────────────────────
    function testFuzz_MultiAssetBundleAtomicity(uint256 goldAmount, uint256 woodAmount) public {
        goldAmount = bound(goldAmount, 1e18,  500e18);  // 1–500 gold
        woodAmount = bound(woodAmount, 1,     500);      // 1–500 wood units

        bytes32 swapId = keccak256(abi.encodePacked("multi_bundle", goldAmount, woodAmount));
        bytes32 secretHash = sha256(abi.encodePacked("multi_secret"));

        // Player A offers: goldAmount ERC-20 gold + Sword NFT (ERC-721 id=0)
        gold.mint(playerA, goldAmount);
        uint256 swordId = sword.mint(playerA);  // fresh sword to avoid ID clash

        DMEXVault.Asset[] memory assetsA = new DMEXVault.Asset[](2);
        assetsA[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC20,  address(gold),  0,       goldAmount);
        assetsA[1] = DMEXVault.Asset(DMEXVault.AssetType.ERC721, address(sword), swordId, 0);

        // Player B offers: woodAmount ERC-1155 wood (id=1)
        wood.mint(playerB, 1, woodAmount);

        DMEXVault.Asset[] memory assetsB = new DMEXVault.Asset[](1);
        assetsB[0] = DMEXVault.Asset(DMEXVault.AssetType.ERC1155, address(wood), 1, woodAmount);

        // Player A approves + commits
        vm.startPrank(playerA);
        gold.approve(address(vault), goldAmount);
        sword.approve(address(vault), swordId);
        vault.commitSwap(swapId, playerB, block.timestamp + 1 hours, secretHash, assetsA, assetsB);
        vm.stopPrank();

        // Verify assets are locked in vault
        assertEq(gold.balanceOf(address(vault)), goldAmount, "Gold not locked");
        assertEq(sword.ownerOf(swordId), address(vault), "Sword not locked");

        // Player B approves + executes
        DMEXVault.ArbiterPayload memory payload = DMEXVault.ArbiterPayload({
            riskScore:     5,
            dynamicTaxBps: 0,   // no tax — clean transfer
            isSpiralHalt:  false
        });
        bytes memory sig = _buildArbiterSignature(swapId, 5, 0, false);

        vm.startPrank(playerB);
        wood.setApprovalForAll(address(vault), true);
        vault.executeSwap(swapId, "multi_secret", payload, sig);
        vm.stopPrank();

        // ── Atomicity assertions ──────────────────────────────────
        // Player B receives: gold + sword
        assertEq(gold.balanceOf(playerB),   goldAmount, "Player B: wrong gold amount");
        assertEq(sword.ownerOf(swordId),    playerB,    "Player B: doesn't own sword");

        // Player A receives: wood
        assertEq(wood.balanceOf(playerA, 1), woodAmount, "Player A: wrong wood amount");

        // Vault is empty — no residual holdings
        assertEq(gold.balanceOf(address(vault)),          0, "Vault leaked gold");
        assertEq(wood.balanceOf(address(vault), 1),       0, "Vault leaked wood");
    }
}
