// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {DMEXVault} from "../contracts/core/DMEXVault.sol";
import {ERC7730Descriptor} from "../contracts/core/ERC7730Descriptor.sol";
import {ERC8213DigestDisplay} from "../contracts/core/ERC8213DigestDisplay.sol";
import {GameCurrency, GameAssetUnique, GameCommodity} from "../contracts/mocks/MockGameAssets.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title BattleChain Deployment Script
 * @notice Deploys the full D-MEX protocol suite to BattleChain (Chain ID: 627)
 *         BattleChain is a pre-mainnet adversarial testing environment by Cyfrin.
 *
 * Usage:
 *   1. Set up your encrypted keystore:
 *      cast wallet import battlechain --interactive
 *
 *   2. Deploy:
 *      forge script script/DeployBattleChain.s.sol \
 *        --rpc-url battlechain \
 *        --account battlechain \
 *        --broadcast \
 *        --verify \
 *        -vvvv
 *
 *   3. After deployment, create Safe Harbor agreement on BattleChain dashboard
 */
contract DeployBattleChain is Script {
    function run() external {
        // SECURITY: Use encrypted keystore instead of raw private key
        // The private key is loaded from the keystore specified by --account flag
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==============================================");
        console.log("  D-MEX Protocol - BattleChain Deployment");
        console.log("  Chain ID: 627 (BattleChain)");
        console.log("==============================================");
        console.log("Deployer Address:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // ── Step 1: Deploy Mock Assets ─────────────────────────────
        GameCurrency gold = new GameCurrency();
        GameAssetUnique sword = new GameAssetUnique();
        GameCommodity resources = new GameCommodity();

        console.log("\n--- Mock Assets Deployed ---");
        console.log("DGLD Address:", address(gold));
        console.log("NFT Sword Address:", address(sword));
        console.log("Commodity Address:", address(resources));

        // ── Step 2: Deploy Vault Implementation ────────────────────
        DMEXVault vaultImplementation = new DMEXVault();
        console.log("\n--- Vault Logic Deployed ---");
        console.log("Implementation Address:", address(vaultImplementation));

        // ── Step 3: Deploy Proxy and Initialize ────────────────────
        // SECURITY: Use SEPARATE addresses for guardian and treasury in production
        // For BattleChain testing, deployer acts as all roles
        bytes memory initData = abi.encodeWithSelector(
            DMEXVault.initialize.selector,
            deployer,  // initialOwner
            deployer,  // guardianSigner (change to dedicated address for mainnet!)
            deployer   // treasury (change to multisig for mainnet!)
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(vaultImplementation), initData);
        DMEXVault vault = DMEXVault(address(proxy));

        console.log("\n--- Vault Proxy Deployed ---");
        console.log("Proxy Address (interact with this!):", address(proxy));

        // ── Step 4: Deploy ERC-7730 Clear Signing Registry ─────────
        ERC7730Descriptor clearSigning = new ERC7730Descriptor();

        // Register the vault for clear signing
        bytes32 descriptorHash = keccak256(abi.encodePacked(
            "dmex-vault-v3.0-battlechain"
        ));

        clearSigning.registerDescriptor(
            address(proxy),
            "D-MEX Vault",
            "3.0.0",
            627, // BattleChain Chain ID
            descriptorHash
        );

        // Register function descriptors for clear signing
        string[] memory commitParams = new string[](6);
        commitParams[0] = "Swap ID";
        commitParams[1] = "Trading Partner";
        commitParams[2] = "Expiry Time";
        commitParams[3] = "Secret Hash";
        commitParams[4] = "Your Assets";
        commitParams[5] = "Wanted Assets";

        clearSigning.setFunctionDescriptor(
            address(proxy),
            bytes4(keccak256("commitSwap(bytes32,address,uint256,bytes32,(uint8,address,uint256,uint256)[],(uint8,address,uint256,uint256)[])")),
            "Lock Assets Into Swap",
            "Commits your assets to an atomic swap escrow. Assets will be locked until the counterparty executes or the swap expires.",
            commitParams,
            "Your assets will be LOCKED and unavailable until swap completion or expiry."
        );

        string[] memory executeParams = new string[](4);
        executeParams[0] = "Swap ID";
        executeParams[1] = "Secret";
        executeParams[2] = "Arbiter Payload";
        executeParams[3] = "Signature";

        clearSigning.setFunctionDescriptor(
            address(proxy),
            bytes4(keccak256("executeSwap(bytes32,string,(uint8,uint256,bool),bytes)")),
            "Execute Swap & Receive Assets",
            "Executes an atomic swap. You send your assets and receive the initiator's locked assets. An exit tax may apply.",
            executeParams,
            ""
        );

        // Attest the descriptor (deployer is auto-approved attestor)
        clearSigning.attestDescriptor(address(proxy), descriptorHash);

        console.log("\n--- ERC-7730 Clear Signing Deployed ---");
        console.log("Registry Address:", address(clearSigning));

        // ── Step 5: Deploy ERC-8213 Digest Display ─────────────────
        ERC8213DigestDisplay digestDisplay = new ERC8213DigestDisplay(
            "D-MEX Protocol",
            "3.0.0",
            627,             // BattleChain Chain ID
            address(proxy)   // Verifying contract = vault proxy
        );

        console.log("\n--- ERC-8213 Digest Display Deployed ---");
        console.log("Digest Display Address:", address(digestDisplay));

        vm.stopBroadcast();

        // ── Deployment Summary ─────────────────────────────────────
        console.log("\n==============================================");
        console.log("  DEPLOYMENT COMPLETE - BattleChain");
        console.log("==============================================");
        console.log("Vault Proxy:     ", address(proxy));
        console.log("Vault Impl:      ", address(vaultImplementation));
        console.log("ERC-7730:        ", address(clearSigning));
        console.log("ERC-8213:        ", address(digestDisplay));
        console.log("DGLD:            ", address(gold));
        console.log("NFT Sword:       ", address(sword));
        console.log("Commodity:       ", address(resources));
        console.log("==============================================");
        console.log("\n  NEXT STEPS:");
        console.log("  1. Update guardian.js with new contract addresses");
        console.log("  2. Update vault-abi.js with new addresses");
        console.log("  3. Create Safe Harbor agreement on BattleChain dashboard");
        console.log("  4. Request 'Attack Mode' for adversarial testing");
        console.log("==============================================");
    }
}
