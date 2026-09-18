const { ethers } = require('ethers');

// SECURITY: Key must come from environment — never hardcode private keys
const GUARDIAN_KEY = process.env.GUARDIAN_KEY;
if (!GUARDIAN_KEY) { console.error('Set GUARDIAN_KEY env var'); process.exit(1); }
const RPC_URL = 'https://sepolia-rpc.scroll.io';

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(GUARDIAN_KEY, provider);
    
    console.log(`Checking balance for Guardian Wallet: ${wallet.address}`);
    try {
        const balance = await provider.getBalance(wallet.address);
        console.log(`Balance: ${ethers.formatEther(balance)} Sepolia ETH`);
    } catch (e) {
        console.error("Failed to check balance:", e.message);
    }
}
main();
