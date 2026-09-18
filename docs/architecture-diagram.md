# D-MEX Protocol — 4-Layer Architecture

```mermaid
graph TB
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
        L[UniversalVault]
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
    L --> N
```

## How It Works

- **Layer 4** — Any game platform connects via its native API
- **Layer 3** — Platform-specific adapters translate game operations into D-MEX protocol calls
- **Layer 2** — The Guardian AI validates, scores, and authorizes every operation
- **Layer 1** — The smart contracts on Scroll L2 execute trustless atomic swaps

**Key insight**: Adding a new game = writing a new Layer 3 adapter. The protocol (Layers 1-2) never changes.
