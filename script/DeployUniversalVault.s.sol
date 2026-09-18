// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {UniversalVault} from "../contracts/core/UniversalVault.sol";

contract DeployUniversalVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Starting UniversalVault Deployment on testnet");
        console.log("Deployer / Guardian Address:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        UniversalVault vault = new UniversalVault(deployer);
        
        console.log("--- Universal Vault Deployed ---");
        console.log("Vault Address (Update app.js / vault-abi.js with this!):", address(vault));

        vm.stopBroadcast();
    }
}
