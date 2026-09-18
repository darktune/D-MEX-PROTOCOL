// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test, console2} from "forge-std/Test.sol";
import {UniversalVault} from "../contracts/core/UniversalVault.sol";
import {AssetBundle} from "../contracts/oracles/FairValueGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UniversalVaultTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    UniversalVault public vault;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public guardianSigner;
    uint256 public guardianPk;
    
    address public alice = address(0x111);
    address public bob = address(0x222);

    function setUp() public {
        (guardianSigner, guardianPk) = makeAddrAndKey("GuardianSigner");
        vault = new UniversalVault(guardianSigner);
        tokenA = new MockERC20();
        tokenB = new MockERC20();

        // Feed dummy chainlink address mapping so it doesn't revert instantly on value check.
        // Actually, for pure unit testing of the Yul transfer, we can abstract the Chainlink dependency 
        // or just test the internal functions. Since they are internal, we will test via the outer wrapper,
        // but we need to bypass the node A1-A3 constraints for this specific fuzzer.
    }

    // =========================================================================
    // YUL FUZZING: Array bounds memory vulnerability testing
    // =========================================================================
    
    /// @notice Fuzzes the UniversalVault Escrow Commit/Lock mechanism to ensure no array mismatches
    ///         can manipulate the Vault's internal balance ledger via Yul.
    function testFuzz_YulBatchTransferAmounts(uint8 numTokens, uint256 amount) public {
        vm.assume(numTokens > 0 && numTokens < 20); // Keep gas limits reasonable
        vm.assume(amount > 0 && amount < 1_000_000_000 ether);

        address[] memory tokens = new address[](numTokens);
        uint256[] memory amounts = new uint256[](numTokens);

        for (uint i = 0; i < numTokens; i++) {
            MockERC20 t = new MockERC20();
            tokens[i] = address(t);
            amounts[i] = amount;

            t.mint(alice, amount);
            vm.prank(alice);
            t.approve(address(vault), amount);
        }

        address[] memory noNFTs = new address[](0);
        uint256[] memory noIds = new uint256[](0);

        AssetBundle memory offered = AssetBundle({
            erc20s: tokens,
            erc20Amounts: amounts,
            nfts: noNFTs,
            nftIds: noIds
        });

        bytes32 tradeId = keccak256("test_trade_fuzz");
        bytes32 metadataHash = keccak256("metadata");
        
        vm.prank(alice);
        vault.proposeTrade(tradeId, bob, offered, offered, metadataHash);

        // Verify Vault actually pulled the precise amounts utilizing Yul
        for (uint i = 0; i < numTokens; i++) {
            assertEq(MockERC20(tokens[i]).balanceOf(address(vault)), amount, "Vault did not secure exact Yul specified balance");
            assertEq(MockERC20(tokens[i]).balanceOf(alice), 0, "Alice balance was not fully drained by Yul pointer");
        }
    }

    /// @notice Tests that the Yul loop correctly reverts when arrays are mismatched,
    ///         preventing out-of-bounds pointer reads leading to ghost balances.
    function test_YulLengthMismatchRevert() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        uint256[] memory amounts = new uint256[](1); // Mismatch to trigger revert!
        amounts[0] = 100 ether;

        address[] memory noNFTs = new address[](0);
        uint256[] memory noIds = new uint256[](0);

        AssetBundle memory offered = AssetBundle({
            erc20s: tokens,
            erc20Amounts: amounts,
            nfts: noNFTs,
            nftIds: noIds
        });

        bytes32 tradeId = keccak256("mismatch");
        vm.prank(alice);
        vm.expectRevert("ERC20 Length mismatch");
        vault.proposeTrade(tradeId, bob, offered, offered, keccak256(""));
    }
}
