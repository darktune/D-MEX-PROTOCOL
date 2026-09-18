const fs = require('fs');
const https = require('https');

function downloadImage(mermaidCode, filename) {
    const state = {
        code: mermaidCode,
        mermaid: { theme: "dark" }
    };
    
    // Create base64 of JSON state
    const jsonStr = JSON.stringify(state);
    const base64Str = Buffer.from(jsonStr).toString('base64');
    const url = `https://mermaid.ink/img/${base64Str}`;
    
    const file = fs.createWriteStream(filename);
    https.get(url, (response) => {
        if (response.statusCode !== 200) {
            console.error(`Failed to download ${filename}. Status: ${response.statusCode}`);
            return;
        }
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log(`Successfully downloaded: ${filename}`);
        });
    }).on('error', (err) => {
        fs.unlink(filename, () => {});
        console.error(`Error downloading ${filename}: ${err.message}`);
    });
}

const architectureDiagram = `graph TB
    subgraph "Layer 4: Integration"
        A[Steam API] 
        B[Unity SDK]
        C[Unreal Plugin]
        D[Google Play]
        E[Custom Game API]
    end
    
    subgraph "Layer 3: Bridge Adapters"
        F[Steam Bridge Bot]
        G[Game Engine SDK]
        H[Store API Adapter]
    end
    
    subgraph "Layer 2: Guardian Protocol"
        I[Arbiter AI]
        J[FairValueOracle]
        K[Risk Scoring zkML]
    end
    
    subgraph "Layer 1: On-Chain Core"
        L[UniversalVault / DMEXVault]
        M[ERC-20 / 721 / 1155]
        N[Atomic Swap Engine]
    end
    
    A --> F
    B --> G
    C --> G
    D --> H
    E --> H
    F --> I
    G --> I
    H --> I
    I --> L
    J --> I
    K --> I
    L --> M
    L --> N`;

const sequenceDiagram = `sequenceDiagram
    participant Player as Player B
    participant Chain as Scroll L2
    participant Guardian as Guardian Node
    participant Game as Game SDK

    Note over Player,Game: Player A trades NFT to Player B on-chain
    
    Chain->>Chain: Transfer event emitted (Block N)
    Chain->>Guardian: WebSocket: TransferSingle(from, to, tokenId)
    Guardian->>Guardian: Validate: is this a D-MEX vault transfer?
    Guardian->>Game: WebSocket push: SPAWN(playerId, assetType, metadata)
    Game->>Game: Spawn item in Player B's inventory
    Game->>Guardian: ACK: item spawned
    Guardian->>Chain: Update bridge state (optional)
    
    Note over Player,Game: Total latency: ~800ms (1 block + WS round-trip)`;

downloadImage(architectureDiagram, 'docs/architecture_diagram.png');
downloadImage(sequenceDiagram, 'docs/atomic_respawn_flow.png');
