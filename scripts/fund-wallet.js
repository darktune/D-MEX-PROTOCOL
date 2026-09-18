require('dotenv').config();
const { ethers } = require('ethers');

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
if (!DEPLOYER_KEY) {
    console.error('[ERROR] DEPLOYER_KEY or PRIVATE_KEY must be provided via environment or .env file');
    process.exit(1);
}
const TARGET_ADDR  = "0x138aDfCcF2Aad0C66466a3b278bBDE33732c6906";
const AMOUNT       = "0.05"; // ETH — plenty for dozens of testnet txs

const RPC_URLS = [
    'https://sepolia-rpc.scroll.io',
    'https://scroll-sepolia-rpc.publicnode.com',
    'https://rpc.ankr.com/scroll_sepolia_testnet'
];

async function main() {
    let provider;
    for (const url of RPC_URLS) {
        try {
            console.log(`[RPC] Trying ${url}...`);
            const p = new ethers.JsonRpcProvider(url, 534351);
            await p.getBlockNumber(); // health check
            provider = p;
            console.log(`[RPC] ✓ Connected to ${url}`);
            break;
        } catch (e) {
            console.log(`[RPC] ✗ ${url} failed`);
        }
    }
    if (!provider) { console.error('All RPCs failed'); process.exit(1); }

    const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
    const balance = await provider.getBalance(wallet.address);
    console.log(`\n[DEPLOYER] ${wallet.address}`);
    console.log(`[BALANCE]  ${ethers.formatEther(balance)} ETH`);

    if (balance < ethers.parseEther(AMOUNT)) {
        console.error(`[ERROR] Deployer has insufficient ETH (need ${AMOUNT})`);
        process.exit(1);
    }

    console.log(`\n[TX] Sending ${AMOUNT} ETH to ${TARGET_ADDR}...`);
    const tx = await wallet.sendTransaction({
        to: TARGET_ADDR,
        value: ethers.parseEther(AMOUNT)
    });
    console.log(`[TX] Broadcast: ${tx.hash}`);
    console.log(`[TX] Waiting for confirmation...`);

    const receipt = await tx.wait();
    console.log(`[TX] ✓ Confirmed in block ${receipt.blockNumber}`);
    console.log(`[TX] Gas used: ${receipt.gasUsed}`);
    console.log(`\n[DONE] ${TARGET_ADDR} now has ${AMOUNT} Scroll Sepolia ETH!`);
    console.log(`[EXPLORER] https://sepolia.scrollscan.com/tx/${tx.hash}`);
}

main().catch(err => { console.error('[FATAL]', err.message); process.exit(1); });
