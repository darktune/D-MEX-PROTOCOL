// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/UDGAP_AssetRegistry.sol";
import "../contracts/core/UDGAP_Guardian.sol";

contract UDGAP_AssetRegistryTest is Test {
    UDGAP_AssetRegistry public registry;
    UDGAP_Guardian public guardian;

    address public owner = address(1);
    address public avsOperator = address(2);
    address public user = address(3);

    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy Guardian with the authorized AVS operator
        guardian = new UDGAP_Guardian(avsOperator);
        
        // Deploy Registry with the Guardian address
        registry = new UDGAP_AssetRegistry("ipfs://test-uri/{id}.json", address(guardian));
        
        // Link Registry to Guardian
        guardian.setAssetRegistry(address(registry));
        
        vm.stopPrank();
    }

    function testRequestVerification() public {
        vm.prank(user);
        
        vm.expectEmit(true, false, false, true);
        emit UDGAP_Guardian.VerificationRequested(user, "https://example.com/sword.obj", bytes32(0));
        
        guardian.requestVerification("https://example.com/sword.obj", bytes32(0));
    }

    function testSubmitVerificationAndMintSuccess() public {
        UDGAP_AssetRegistry.AssetFingerprint memory fingerprint = UDGAP_AssetRegistry.AssetFingerprint({
            geometryHash: keccak256("geom1"),
            textureHash: keccak256("tex1"),
            materialHash: keccak256("mat1"),
            animationHash: keccak256("anim1"),
            metadataHash: keccak256("meta1"),
            meshLLMAuthenticityScore: 9900 // 99%
        });

        vm.prank(avsOperator);
        
        vm.expectEmit(true, true, false, true);
        emit UDGAP_Guardian.AssetVerifiedAndMinted(user, 1, 9900);

        guardian.submitVerificationAndMint(user, 1, fingerprint, "");

        assertEq(registry.balanceOf(user, 1), 1);
        
        (
            bytes32 geom,
            bytes32 tex,
            bytes32 mat,
            bytes32 anim,
            bytes32 meta,
            uint256 score
        ) = registry.assetFingerprints(1);

        assertEq(geom, fingerprint.geometryHash);
        assertEq(score, 9900);
    }

    function testSubmitVerificationFailsLowScore() public {
        UDGAP_AssetRegistry.AssetFingerprint memory fingerprint = UDGAP_AssetRegistry.AssetFingerprint({
            geometryHash: keccak256("geom1"),
            textureHash: keccak256("tex1"),
            materialHash: keccak256("mat1"),
            animationHash: keccak256("anim1"),
            metadataHash: keccak256("meta1"),
            meshLLMAuthenticityScore: 8000 // 80% is too low (< 9500)
        });

        vm.prank(avsOperator);
        vm.expectRevert("UDGAP: Score too low");
        guardian.submitVerificationAndMint(user, 1, fingerprint, "");
    }
}
