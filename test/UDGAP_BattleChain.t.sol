// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/UDGAP_AssetRegistry.sol";
import "../contracts/core/UDGAP_Guardian.sol";

/**
 * @title UDGAP BattleChain Adversarial Simulator
 * @notice Automated simulation of adversarial conditions for UDGAP Registry and Guardian.
 */
contract UDGAP_BattleChainSimulatorTest is Test {
    UDGAP_AssetRegistry public registry;
    UDGAP_Guardian public guardian;

    address public owner = address(1);
    address public avsOperator = address(2);
    address public hacker = address(3);

    function setUp() public {
        vm.startPrank(owner);
        guardian = new UDGAP_Guardian(avsOperator);
        registry = new UDGAP_AssetRegistry("ipfs://test-uri/{id}.json", address(guardian));
        guardian.setAssetRegistry(address(registry));
        vm.stopPrank();
    }

    /**
     * @notice Simulates an unauthorized user trying to mint a fraudulent asset directly.
     */
    function testDirectMintExploitFails() public {
        UDGAP_AssetRegistry.AssetFingerprint memory fakeFingerprint = UDGAP_AssetRegistry.AssetFingerprint({
            geometryHash: keccak256("fake_geom"),
            textureHash: keccak256("fake_tex"),
            materialHash: keccak256("fake_mat"),
            animationHash: keccak256("fake_anim"),
            metadataHash: keccak256("fake_meta"),
            meshLLMAuthenticityScore: 9999
        });

        vm.startPrank(hacker);
        
        // Ensure standard direct mint calls are not possible on registry
        // The registry should revert with "Only authorized guardian"
        vm.expectRevert("UDGAP: Only authorized guardian");
        registry.verifiedMint(hacker, 666, 1, "", fakeFingerprint);
        
        vm.stopPrank();
    }

    /**
     * @notice Simulates an unauthorized user trying to submit verification via Guardian.
     */
    function testGuardianOperatorExploitFails() public {
        UDGAP_AssetRegistry.AssetFingerprint memory fakeFingerprint = UDGAP_AssetRegistry.AssetFingerprint({
            geometryHash: keccak256("fake_geom"),
            textureHash: keccak256("fake_tex"),
            materialHash: keccak256("fake_mat"),
            animationHash: keccak256("fake_anim"),
            metadataHash: keccak256("fake_meta"),
            meshLLMAuthenticityScore: 9999
        });

        vm.startPrank(hacker);
        
        // Hacker tries to call the submitVerificationAndMint function directly on Guardian
        vm.expectRevert("UDGAP: Caller is not the AVS Operator");
        guardian.submitVerificationAndMint(hacker, 666, fakeFingerprint, "");
        
        vm.stopPrank();
    }

    /**
     * @notice Ensures compromised Guardian cannot bypass AI authenticity score threshold.
     */
    function testCompromisedGuardianScoreBypassFails() public {
        // Even if AVS operator is compromised, it cannot mint if score is too low
        UDGAP_AssetRegistry.AssetFingerprint memory badFingerprint = UDGAP_AssetRegistry.AssetFingerprint({
            geometryHash: keccak256("bad_geom"),
            textureHash: keccak256("bad_tex"),
            materialHash: keccak256("bad_mat"),
            animationHash: keccak256("bad_anim"),
            metadataHash: keccak256("bad_meta"),
            meshLLMAuthenticityScore: 1000 // 10% authenticity
        });

        vm.startPrank(avsOperator);
        
        vm.expectRevert("UDGAP: Score too low");
        guardian.submitVerificationAndMint(hacker, 666, badFingerprint, "");
        
        vm.stopPrank();
    }
}
