const path = require('path');
const dotenv = require(path.join(__dirname, '../guardian/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../.env') });
const { ethers } = require(path.join(__dirname, '../guardian/node_modules/ethers'));

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
if (!DEPLOYER_KEY) {
    console.error('[ERROR] DEPLOYER_KEY or PRIVATE_KEY must be provided via environment or .env file');
    process.exit(1);
}

const TARGET_ADDR = process.argv[2] || '0x13A91DdBD241f481c16DeC1b3efbe6907Bbd4A84';
const DGLD_ADDR   = '0x789755ed4930b37372e9E838AdbF4280CDE7A576';
const NFT_ADDR    = '0xdd2C163C8E0005deF0B1e70c93dF708998Be9bce';
const COMM_ADDR   = '0xA62561F571c27c9c17D44fBCB6a931Ea55da594c';

async function main() {
    const net = ethers.Network.from(534351);
    const provider = new ethers.JsonRpcProvider('https://scroll-sepolia.drpc.org', net, { staticNetwork: net });
    const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);

    console.log(`[DEPLOYER] ${deployer.address}`);
    const depBal = await provider.getBalance(deployer.address);
    console.log(`[BALANCE]  ${ethers.formatEther(depBal)} ETH`);
    console.log(`[TARGET]   ${TARGET_ADDR}`);

    let targetBal = await provider.getBalance(TARGET_ADDR);
    console.log(`[TARGET CURRENT BAL] ${ethers.formatEther(targetBal)} ETH`);

    let currentNonce = await provider.getTransactionCount(deployer.address, 'latest');
    console.log(`[STARTING ON-CHAIN NONCE] ${currentNonce}`);

    // Set gasPrice high enough (2 Gwei) to comfortably replace any underpriced mempool txs
    const gasPrice = ethers.parseUnits('2', 'gwei');
    console.log(`[USING GAS PRICE] ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`);

    // Helper to send and wait with timeout
    async function sendTx(txPromiseFactory, name) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`\n--> Sending ${name} (nonce ${currentNonce}, attempt ${attempt})...`);
                const tx = await txPromiseFactory(currentNonce);
                console.log(`    Hash: ${tx.hash}`);
                console.log(`    Waiting for confirmation...`);
                const receipt = await Promise.race([
                    tx.wait(1),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Tx confirmation timeout')), 30000))
                ]);
                console.log(`    ✓ Confirmed in block ${receipt.blockNumber}`);
                currentNonce++;
                return receipt;
            } catch (err) {
                console.warn(`    ⚠️ Attempt ${attempt} failed: ${err.message}`);
                // Refresh latest nonce
                const latest = await provider.getTransactionCount(deployer.address, 'latest');
                if (latest > currentNonce) {
                    console.log(`    On-chain nonce moved from ${currentNonce} to ${latest}. Updating.`);
                    currentNonce = latest;
                    return; // previous tx went through
                }
                await new Promise(r => setTimeout(r, 4000));
            }
        }
    }

    // 1. Send ETH if target has < 0.001 ETH
    targetBal = await provider.getBalance(TARGET_ADDR);
    if (targetBal < ethers.parseEther('0.001')) {
        await sendTx((nonce) => deployer.sendTransaction({
            to: TARGET_ADDR,
            value: ethers.parseEther('0.002'),
            nonce: nonce,
            gasPrice: gasPrice
        }), 'ETH Transfer (0.002 ETH)');
    } else {
        console.log(`✓ Target already has ${ethers.formatEther(targetBal)} ETH`);
    }

    // 2. Mint 1,000 DGLD
    const erc20 = new ethers.Contract(DGLD_ADDR, [
        'function mint(address,uint256) external',
        'function balanceOf(address) external view returns (uint256)'
    ], deployer);
    const dgldBal = await erc20.balanceOf(TARGET_ADDR);
    console.log(`Current DGLD Balance: ${ethers.formatEther(dgldBal)}`);
    if (dgldBal < ethers.parseEther('1000')) {
        await sendTx((nonce) => erc20.mint(TARGET_ADDR, ethers.parseEther('1000'), {
            nonce: nonce,
            gasPrice: gasPrice
        }), '1,000 DGLD Mint');
    } else {
        console.log('✓ Target already has sufficient DGLD');
    }

    // 3. Mint 2 NFT Swords
    const erc721 = new ethers.Contract(NFT_ADDR, [
        'function mint(address) external returns (uint256)',
        'function balanceOf(address) external view returns (uint256)'
    ], deployer);
    let nftBal = await erc721.balanceOf(TARGET_ADDR);
    console.log(`Current NFT Swords: ${nftBal}`);
    if (nftBal < 2n) {
        const needed = 2n - nftBal;
        for (let i = 0; i < Number(needed); i++) {
            await sendTx((nonce) => erc721.mint(TARGET_ADDR, {
                nonce: nonce,
                gasPrice: gasPrice
            }), `NFT Sword #${i + 1}`);
        }
    } else {
        console.log('✓ Target already has at least 2 NFT Swords');
    }

    // 4. Mint Commodities
    const erc1155 = new ethers.Contract(COMM_ADDR, [
        'function mint(address,uint256,uint256) external',
        'function balanceOf(address,uint256) external view returns (uint256)'
    ], deployer);
    const woodBal = await erc1155.balanceOf(TARGET_ADDR, 1);
    const ironBal = await erc1155.balanceOf(TARGET_ADDR, 2);
    console.log(`Current Wood: ${woodBal}, Current Iron: ${ironBal}`);
    if (woodBal < 50n) {
        await sendTx((nonce) => erc1155.mint(TARGET_ADDR, 1, 50, {
            nonce: nonce,
            gasPrice: gasPrice
        }), 'Wood (50 units)');
    }
    if (ironBal < 50n) {
        await sendTx((nonce) => erc1155.mint(TARGET_ADDR, 2, 50, {
            nonce: nonce,
            gasPrice: gasPrice
        }), 'Iron (50 units)');
    }

    // Final Balances
    const finalBal = await provider.getBalance(TARGET_ADDR);
    const finalDGLD = await erc20.balanceOf(TARGET_ADDR);
    const finalNFT = await erc721.balanceOf(TARGET_ADDR);
    const finalWood = await erc1155.balanceOf(TARGET_ADDR, 1);
    const finalIron = await erc1155.balanceOf(TARGET_ADDR, 2);

    console.log('\n=============================================');
    console.log('SUCCESSFULLY FUNDED TARGET BURNER WALLET:');
    console.log('Target:     ', TARGET_ADDR);
    console.log('ETH:        ', ethers.formatEther(finalBal));
    console.log('DGLD:       ', ethers.formatEther(finalDGLD));
    console.log('NFT Swords: ', finalNFT.toString());
    console.log('Wood (1155):', finalWood.toString());
    console.log('Iron (1155):', finalIron.toString());
    console.log('=============================================');
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
