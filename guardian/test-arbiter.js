const DMEXArbiter = require("./arbiter");
const { ethers } = require("ethers");

async function runTests() {
    console.log("=== D-MEX Arbiter Guardian Tests ===");
    // Test Private Key (ephemeral mock signer)
    const privateKey = process.env.GUARDIAN_KEY || ethers.Wallet.createRandom().privateKey;
    const arbiter = new DMEXArbiter(privateKey);

    const swapId = ethers.id("test-swap-1");
    const metadataHash = ethers.ZeroHash;
    const offeredHash = ethers.id("offered");
    const wantedHash = ethers.id("wanted");

    console.log("\n[Test 1] Normal Fair Trade");
    const assetsOffered = [{ type: 'ERC-20', address: '0x1111111111111111111111111111111111111111', amount: '100' }];
    const assetsWanted = [{ type: 'ERC-20', address: '0x2222222222222222222222222222222222222222', amount: '100' }];
    
    let res1 = await arbiter.evaluateAndSignSwap(swapId, metadataHash, offeredHash, wantedHash, assetsOffered, assetsWanted);
    console.log("Approved:", res1.approved);
    console.log("Signature:", res1.signature.substring(0, 20) + "...");

    console.log("\n[Test 2] Integrated Check Run");
    let res2 = await arbiter.evaluateAndSignSwap(swapId, metadataHash, offeredHash, wantedHash, assetsOffered, assetsWanted);
    console.log("Approved:", res2.approved);
}

runTests().catch(console.error);
