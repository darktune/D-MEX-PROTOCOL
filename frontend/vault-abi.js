// ====================================================================
// D-MEX Protocol – Deployed Contract ABIs & Addresses (Scroll Sepolia)
// Chain ID: 534351 | RPC: https://sepolia-rpc.scroll.io
// ====================================================================

const SCROLL_SEPOLIA_CHAIN_ID = 534351;

// Multiple RPCs for reliability — publicnode and drpc are responsive
const SCROLL_SEPOLIA_RPCS = [
    "https://scroll-sepolia-rpc.publicnode.com",
    "https://scroll-sepolia.drpc.org",
    "https://scroll-sepolia.blockpi.network/v1/rpc/public"
];
const SCROLL_SEPOLIA_RPC = SCROLL_SEPOLIA_RPCS[0]; // default

const SCROLL_SEPOLIA_CHAIN_CONFIG = {
    chainId: "0x" + SCROLL_SEPOLIA_CHAIN_ID.toString(16), // 0x8274f
    chainName: "Scroll Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: SCROLL_SEPOLIA_RPCS,
    blockExplorerUrls: ["https://sepolia.scrollscan.com"]
};

// --- Deployed Contract Addresses ---
const CONTRACTS = {
    VAULT_PROXY:    "0x39b845162051b643f0E883ef3F3382a0164528f0".toLowerCase(),
    DGLD:           "0x789755ed4930b37372e9E838AdbF4280CDE7A576".toLowerCase(),
    NFT_SWORD:      "0xdd2C163C8E0005deF0B1e70c93dF708998Be9bce".toLowerCase(),
    COMMODITY:      "0xA62561F571c27c9c17D44fBCB6a931Ea55da594c".toLowerCase(),
    VAULT_IMPL:     "0x7C3D4Ce6FACae8F359000daa90378fF9b74D7bf2".toLowerCase(),
    LOOT_MOCK:      "0x9a4b3e8b190ca241f8c949c23df5c4de52c8f9e2".toLowerCase(),
    GODS_MOCK:      "0xf6c84351cb0ca19b4efe1a1d237a8e3fb5bcaf91".toLowerCase(),
    CK_MOCK:        "0xe1fd3d8b211b1e3c33af0a1a2f69a5d6b6a9f9ea".toLowerCase()
};

// --- Asset Type Enum (mirrors DMEXVault.AssetType) ---
const AssetType = { ERC20: 0, ERC721: 1, ERC1155: 2 };

// --- UniversalVault ABI ---
const VAULT_ABI = [
    // Read
    "function guardianSigner() view returns (address)",
    "function trades(bytes32) view returns (address partyA, address partyB, bytes32 offeredHash, bytes32 wantedHash, bool partyALocked, bool partyBLocked, bool active, bytes32 metadataHash)",
    // Write
    "function proposeTrade(bytes32 tradeId, address partyB, tuple(address[] erc20s, uint256[] erc20Amounts, address[] nfts, uint256[] nftIds) offered, tuple(address[] erc20s, uint256[] erc20Amounts, address[] nfts, uint256[] nftIds) wanted, bytes32 metadataHash)",
    "function executeAtomicBarter(bytes32 tradeId, bytes guardianSignature)",
    "function cancelTrade(bytes32 tradeId)",
    // Events
    "event TradeProposed(bytes32 indexed tradeId, address indexed partyA, address indexed partyB)",
    "event AtomicSwapExecuted(bytes32 indexed tradeId)",
    "event TradeCancelled(bytes32 indexed tradeId)"
];

// --- ERC-20 ABI (DGLD GameCurrency) ---
const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

// --- ERC-721 ABI (GameAssetUnique – NFT Swords) ---
const ERC721_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function approve(address to, uint256 tokenId)",
    "function setApprovalForAll(address operator, bool approved)",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
    "function transferFrom(address from, address to, uint256 tokenId)",
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)"
];

// --- ERC-1155 ABI (GameCommodity – Resources) ---
const ERC1155_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
    "function setApprovalForAll(address operator, bool approved)",
    "function isApprovedForAll(address account, address operator) view returns (bool)",
    "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
];

// ====================================================================
// GAME REGISTRY — Real game contracts mapped to D-MEX token standards
// On Scroll Sepolia testnet, all games route through the mock contracts.
// On mainnet, each game would use its actual contract address.
// ====================================================================
const GAME_REGISTRY = {
    dmex: {
        name: 'D-MEX Native',
        chain: 'Scroll Sepolia',
        icon: '🛡️',
        color: '#1ed760',
        description: 'Protocol-native GameFi assets deployed on Scroll Sepolia.',
        assets: {
            dgld:      { name: 'DGLD (Gold)',  type: 'ERC-20',   icon: 'G',  iconClass: 'gold',      contract: 'DGLD',       game: 'dmex', baseValue: 0.10 },
            sword:     { name: 'NFT Sword',    type: 'ERC-721',  icon: '⚔', iconClass: 'sword',     contract: 'NFT_SWORD',  game: 'dmex', baseValue: 5.00 },
            commodity: { name: 'Commodity',    type: 'ERC-1155', icon: '◆', iconClass: 'commodity', contract: 'COMMODITY',  game: 'dmex', baseValue: 1.00 }
        }
    },
    loot: {
        name: 'Loot (Adventurers)',
        chain: 'Ethereum Mainnet',
        icon: '🎒',
        color: '#c4a35a',
        mainnetContract: '0xFF9C1b15B16263C61d017ee9F65C50e4AE0113D7',
        description: 'On-chain randomized adventure gear. Community-driven, fully decentralized.',
        assets: {
            loot_bag: { name: 'Loot Bag',  type: 'ERC-721',  icon: '🎒', iconClass: 'loot',  contract: 'LOOT_MOCK', game: 'loot', baseValue: 50.00 }
        }
    },
    gods: {
        name: 'Gods Unchained',
        chain: 'Ethereum / IMX',
        icon: '⚡',
        color: '#4fc3f7',
        mainnetContract: '0x0E3A2A1f2146d86A604adc220b4967A898D7Fe07',
        description: 'Free-to-play tactical card game. Cards are tradeable ERC-721 NFTs.',
        assets: {
            god_card: { name: 'God Card',  type: 'ERC-1155',  icon: '🃏', iconClass: 'gods',  contract: 'GODS_MOCK', game: 'gods', baseValue: 15.00 }
        }
    },
    cryptokitties: {
        name: 'CryptoKitties',
        chain: 'Ethereum Mainnet',
        icon: '🐱',
        color: '#f06292',
        mainnetContract: '0x06012c8cf97BEaD5deAe237070F9587f8E7A266d',
        description: 'The original crypto collectible. Breed, collect, and trade unique digital cats.',
        assets: {
            kitty: { name: 'CryptoKitty',  type: 'ERC-721',  icon: '🐱', iconClass: 'kitty',  contract: 'CK_MOCK', game: 'cryptokitties', baseValue: 35.00 }
        }
    },
    cs2: {
        name: 'CS2 (Counter-Strike)',
        chain: 'Tokenized Bridge',
        icon: '🔫',
        color: '#ff9800',
        description: 'Legendary FPS. Skins, cases, and balance tokenized via D-MEX bridge.',
        assets: {
            cs_skin:    { name: 'CS2 Skin',     type: 'ERC-721',  icon: '🔫', iconClass: 'cs-skin',    contract: 'NFT_SWORD',  game: 'cs2', baseValue: 75.00 },
            cs_case:    { name: 'CS2 Case',     type: 'ERC-1155', icon: '📦', iconClass: 'cs-case',    contract: 'COMMODITY',  game: 'cs2', baseValue: 2.50 },
            cs_balance: { name: 'CS2 Balance',  type: 'ERC-20',   icon: '$',  iconClass: 'cs-balance', contract: 'DGLD',       game: 'cs2', baseValue: 1.00 }
        }
    },
    ugc: {
        name: 'Creator Uploads (UGC)',
        chain: 'Scroll Sepolia',
        icon: '🎨',
        color: '#9c27b0',
        description: 'User Generated Content minted from Unreal, Unity, Blender, Maya.',
        assets: {
            unreal_mesh: { name: 'UE5 Nanite Mesh', type: 'ERC-1155', icon: 'U', iconClass: 'unreal', contract: 'COMMODITY', game: 'ugc', baseValue: 120.00 },
            blender_scene:{ name: 'Blender Scene',  type: 'ERC-721',  icon: 'B', iconClass: 'blender', contract: 'NFT_SWORD', game: 'ugc', baseValue: 45.00 },
            maya_rig:    { name: 'Maya Rig',        type: 'ERC-721',  icon: 'M', iconClass: 'maya',    contract: 'NFT_SWORD', game: 'ugc', baseValue: 200.00 },
            unity_prefab:{ name: 'Unity Prefab',    type: 'ERC-1155', icon: '⚙', iconClass: 'unity',   contract: 'COMMODITY', game: 'ugc', baseValue: 60.00 }
        }
    }
};
