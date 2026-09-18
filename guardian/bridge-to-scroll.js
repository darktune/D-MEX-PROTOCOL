require('dotenv').config();
const { ethers } = require('ethers');

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
if (!DEPLOYER_KEY) {
    console.error('[ERROR] DEPLOYER_KEY or PRIVATE_KEY must be provided via environment or .env file');
    process.exit(1);
}

// L1 (Ethereum Sepolia) config
const L1_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const L1_GATEWAY_ROUTER = "0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6";

// Amount to bridge (keep some for L1 gas)
const BRIDGE_AMOUNT = "0.04"; // ETH

const GATEWAY_ABI = [
    "function depositETH(uint256 _amount, uint256 _gasLimit) payable"
];

async function main() {
    console.log('[BRIDGE] Connecting to Ethereum Sepolia (L1)...');
    const l1Provider = new ethers.JsonRpcProvider(L1_RPC, 11155111);
    await l1Provider.getBlockNumber();
    console.log('[BRIDGE] ✓ Connected to L1');

    const wallet = new ethers.Wallet(DEPLOYER_KEY, l1Provider);
    const balance = await l1Provider.getBalance(wallet.address);
    console.log(`[DEPLOYER] ${wallet.address}`);
    console.log(`[L1 BALANCE] ${ethers.formatEther(balance)} Sepolia ETH`);

    const bridgeWei = ethers.parseEther(BRIDGE_AMOUNT);
    if (balance < bridgeWei) {
        console.error(`[ERROR] Not enough L1 ETH. Have ${ethers.formatEther(balance)}, need ${BRIDGE_AMOUNT}`);
        process.exit(1);
    }

    const gateway = new ethers.Contract(L1_GATEWAY_ROUTER, GATEWAY_ABI, wallet);

    // depositETH(amount, gasLimit) — send ETH as msg.value
    // gasLimit = 170000 is the standard for ETH deposits on Scroll
    const gasLimit = 170000;
    
    // msg.value = bridge amount + small relay fee buffer
    const relayFee = ethers.parseEther("0.005");
    const totalValue = bridgeWei + relayFee;

    console.log(`\n[BRIDGE] Bridging ${BRIDGE_AMOUNT} ETH from L1 → Scroll Sepolia...`);
    console.log(`[BRIDGE] Relay fee buffer: 0.005 ETH (excess refunded)`);
    
    const tx = await gateway.depositETH(bridgeWei, gasLimit, { value: totalValue });
    console.log(`[TX] Broadcast: ${tx.hash}`);
    console.log(`[TX] Waiting for L1 confirmation...`);

    const receipt = await tx.wait();
    console.log(`[TX] ✓ Confirmed on L1 in block ${receipt.blockNumber}`);
    console.log(`[TX] Gas used: ${receipt.gasUsed}`);
    console.log(`\n[BRIDGE] ✓ Bridge initiated! ETH will arrive on Scroll Sepolia in ~10 minutes.`);
    console.log(`[EXPLORER L1] https://sepolia.etherscan.io/tx/${tx.hash}`);
    console.log(`[EXPLORER L2] Check balance at: https://sepolia.scrollscan.com/address/${wallet.address}`);
}

main().catch(err => { console.error('[FATAL]', err.message); process.exit(1); });
