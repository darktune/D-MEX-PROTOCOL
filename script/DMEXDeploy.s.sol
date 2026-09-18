// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {DMEXVault} from "../contracts/core/DMEXVault.sol";
import {GameCurrency, GameAssetUnique, GameCommodity} from "../contracts/mocks/MockGameAssets.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract DMEXDeploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Starting D-MEX Protocol Deployment on testnet");
        console.log("Deployer Address:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Mock Assets (constructors are no-arg, names are hardcoded in contracts)
        GameCurrency gold = new GameCurrency();
        GameAssetUnique sword = new GameAssetUnique();
        GameCommodity resources = new GameCommodity();

        console.log("--- Mock Assets Deployed ---");
        console.log("DGLD Address:", address(gold));
        console.log("NFT Sword Address:", address(sword));
        console.log("Commodity Address:", address(resources));

        // 2. Deploy Vault Implementation
        DMEXVault vaultImplementation = new DMEXVault();
        console.log("--- Vault Logic Deployed ---");
        console.log("Implementation Address:", address(vaultImplementation));

        // 3. Deploy Proxy and Initialize
        // For testing, the deployer will act as Owner, Guardian, and Treasury
        bytes memory initData = abi.encodeWithSelector(
            DMEXVault.initialize.selector,
            deployer, // initialOwner
            deployer, // guardianSigner
            deployer  // treasury
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(vaultImplementation), initData);
        DMEXVault vault = DMEXVault(address(proxy));

        console.log("--- Vault Proxy Deployed ---");
        console.log("Proxy Address (Use this to interact!):", address(proxy));

        vm.stopBroadcast();
    }
}
