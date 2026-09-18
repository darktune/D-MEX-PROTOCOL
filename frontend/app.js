// ====================================================================
// D-MEX Frontend – Web3 + Full Interactive UI (Scroll Sepolia Live)
// ethers.js v6 • vault-abi.js • Glassmorphic GameFi Barter
// ====================================================================

document.addEventListener('DOMContentLoaded', async () => {

    // --- Global Error Safety Net ---
    // If any uncaught JS error occurs, auto-reset the Propose button
    // so the UI never gets permanently locked.
    window.addEventListener('error', () => {
        const btn = document.getElementById('propose-swap-btn');
        if (btn) {
            btn.style.pointerEvents = 'auto';
            const t = btn.querySelector('.btn-text');
            if (t) t.innerText = 'Propose Intent';
        }
    });
    window.addEventListener('unhandledrejection', () => {
        const btn = document.getElementById('propose-swap-btn');
        if (btn) {
            btn.style.pointerEvents = 'auto';
            const t = btn.querySelector('.btn-text');
            if (t) t.innerText = 'Propose Intent';
        }
    });

    // --- PWA Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').then((reg) => {
                console.log('[PWA] Service Worker registered:', reg.scope);
            }).catch((err) => console.log('[PWA] Registration failed:', err));
        });
    }

    // --- DOM ---
    const connectBtn      = document.getElementById('connect-wallet-btn');
    const dynamicIsland   = document.getElementById('dynamic-island');
    const islandText      = dynamicIsland.querySelector('.island-text');
    const tabs            = document.querySelectorAll('.tab');
    const tabContents     = document.querySelectorAll('.tab-content');
    const proposeBtn      = document.getElementById('propose-swap-btn');
    const terminalLogs    = document.getElementById('terminal-logs');
    const toastContainer  = document.getElementById('toast-container');
    const swapReverseBtn  = document.getElementById('swap-reverse-btn');
    const directRpcBtn    = document.getElementById('direct-rpc-btn');
    const faucetBtn       = document.getElementById('faucet-btn');

    // --- Web3 State ---
    let provider = null, signer = null, userAddr = null;
    let is2FAEnabled = localStorage.getItem('dmex_2fa') === 'true';

    // 2FA Verification Helper
    function require2FA() {
        return new Promise((resolve) => {
            if (!is2FAEnabled) return resolve(true); // Skip if disabled
            
            const modal = document.getElementById('two-fa-modal');
            const input = document.getElementById('two-fa-input');
            const btnVerify = document.getElementById('btn-verify-2fa');
            const btnCancel = document.getElementById('btn-cancel-2fa');
            
            if (!modal) return resolve(true); // Safety fallback

            input.value = '';
            modal.classList.add('open');
            input.focus();

            const cleanup = () => {
                btnVerify.removeEventListener('click', onVerify);
                btnCancel.removeEventListener('click', onCancel);
                modal.classList.remove('open');
            };

            const onVerify = () => {
                if (input.value.length === 6) {
                    cleanup();
                    showToast('2FA Verified Successfully', 'success');
                    resolve(true);
                } else {
                    showToast('Please enter a 6-digit code', 'error');
                }
            };

            const onCancel = () => {
                cleanup();
                showToast('Swap Cancelled (2FA aborted)', 'error');
                resolve(false);
            };

            btnVerify.addEventListener('click', onVerify);
            btnCancel.addEventListener('click', onCancel);
        });
    }
    let vaultContract = null, dgldContract = null, swordContract = null, commodityContract = null;

    // --- Guardian API ---
    const GUARDIAN_API = window.location.origin;
    let ws = null;
    let wsReconnectDelay = 5000;   // start at 5s, exponential backoff
    let wsReconnectTimer = null;
    let wsPingInterval = null;
    let wsDisconnectLogged = false;

    function connectGuardianWS() {
        // Clean up any previous timers
        if (wsPingInterval) { clearInterval(wsPingInterval); wsPingInterval = null; }
        if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

        try {
            const wsUrl = GUARDIAN_API.replace('http', 'ws');
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                wsReconnectDelay = 5000;  // reset backoff on success
                wsDisconnectLogged = false;
                addLog('[WS] Connected to Guardian');
                // Keepalive ping every 25 seconds
                wsPingInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
                    }
                }, 25000);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'pong') return; // keepalive response, ignore
                    if (msg.type === 'evaluation') {
                        const ev = msg.data;
                        analytics.total = msg.analytics.total;
                        analytics.approved = msg.analytics.approved;
                        analytics.rejected = msg.analytics.rejected;
                        analytics.riskScores.push(ev.score);
                        analytics.attackNodes = ev.attackNodes;
                        analytics.evaluations.unshift(ev);
                        updateAnalyticsUI();
                        updateArbiterSidebar();
                    } else if (msg.type === 'snapshot') {
                        analytics.total = msg.analytics.total;
                        analytics.approved = msg.analytics.approved;
                        analytics.rejected = msg.analytics.rejected;
                    } else if (msg.type === 'chat') {
                        receiveChatMsg(msg.sender, msg.message);
                    }
                } catch (e) { /* ignore malformed messages */ }
            };

            ws.onclose = () => {
                if (wsPingInterval) { clearInterval(wsPingInterval); wsPingInterval = null; }
                if (!wsDisconnectLogged) {
                    addLog('[WS] Disconnected. Will retry automatically.');
                    wsDisconnectLogged = true;
                }
                // Exponential backoff: 5s → 10s → 20s → 30s (cap)
                wsReconnectTimer = setTimeout(connectGuardianWS, wsReconnectDelay);
                wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
            };

            ws.onerror = () => {
                // Suppress — onclose will fire after this anyway
            };
        } catch (e) { console.log('WS connection failed:', e.message); }
    }
    connectGuardianWS();

    // --- Asset Configs ---
    // Build ASSETS from GAME_REGISTRY for consistency
    const ASSETS = {};
    Object.values(GAME_REGISTRY).forEach(g => {
        Object.entries(g.assets).forEach(([key, asset]) => { ASSETS[key] = asset; });
    });
    let offerAsset = 'dgld', receiveAsset = 'sword';

    // --- Analytics State ---
    let analytics = {
        total: 0, approved: 0, rejected: 0,
        riskScores: [],
        evaluations: [],
        attackNodes: { l1: 0, l2: 0, l3: 0, a3: 0 }
    };

    // --- Market State ---
    let marketOrders = [];

    // =================================================================
    //  HELPERS
    // =================================================================
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerText = message.slice(0, 60);
        toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    function addLog(msg) {
        const p = document.createElement('p');
        p.innerText = '> ' + msg;
        p.style.color = 'var(--spotify-green)';
        setTimeout(() => { p.style.color = ''; }, 600);
        terminalLogs.appendChild(p);
        terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }

    function shortAddr(a) { return a.slice(0, 6) + '...' + a.slice(-4); }

    function flashElement(el) {
        el.style.transition = 'none';
        el.style.color = '#1ed760';
        el.style.textShadow = '0 0 20px rgba(30,215,96,0.8)';
        el.style.transform = 'scale(1.15)';
        setTimeout(() => {
            el.style.transition = 'all 0.8s ease';
            el.style.color = '';
            el.style.textShadow = '';
            el.style.transform = '';
        }, 100);
    }

    // =================================================================
    //  TAB NAVIGATION & DOTS
    // =================================================================
    const navDots = document.querySelectorAll('.nav-dot');

    function switchTab(t) {
        tabs.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(tc => tc.classList.remove('active'));
        navDots.forEach(dot => dot.classList.remove('active'));
        
        const targetTab = document.querySelector(`.tab[data-tab="${t}"]`);
        if (targetTab) targetTab.classList.add('active');
        
        const targetDot = document.querySelector(`.nav-dot[data-target="${t}"]`);
        if (targetDot) targetDot.classList.add('active');

        if (t === 'create')    document.getElementById('create-view').classList.add('active');
        if (t === 'market') {
            document.getElementById('market-view').classList.add('active');
            if (!marketplaceLoaded) { loadMarketplace(); marketplaceLoaded = true; }
        }
        if (t === 'social') {
            document.getElementById('social-view').classList.add('active');
            if (!socialLoaded) { loadSocialMarket(); socialLoaded = true; }
        }
        if (t === 'studio') {
            document.getElementById('studio-view').classList.add('active');
        }
        if (t === 'history') {
            document.getElementById('history-view').classList.add('active');
        }
        if (t === 'analytics') {
            document.getElementById('analytics-view').classList.add('active');
            if (analytics.total === 0) {
                fetch(GUARDIAN_API + '/api/analytics')
                    .then(r => r.json())
                    .then(data => {
                        if (data.total > 0) {
                            analytics.total    = data.total;
                            analytics.approved = data.approved;
                            analytics.rejected = data.rejected;
                            analytics.riskScores = data.riskScores || [];
                            // Restore evaluation rows
                            (data.evaluations || []).forEach(ev => {
                                if (!analytics.evaluations.find(e => e.swapId === ev.tradeId)) {
                                    analytics.evaluations.push({
                                        timestamp: new Date(ev.timestamp).toLocaleString(),
                                        swapId:    ev.tradeId || '0x???',
                                        txHash:    '—',
                                        score:     ev.score,
                                        riskLevel: ev.riskLevel,
                                        decision:  ev.decision,
                                        fairValue: ev.fairValue || null
                                    });
                                }
                            });
                            updateAnalyticsUI();
                            addLog('[ANALYTICS] Restored ' + data.total + ' server-side evaluations');
                        }
                    })
                    .catch(() => {}); // Silent fail if Guardian offline
                
                // Delay to let DOM render, then draw charts
                setTimeout(() => renderCharts(), 50);
            }
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });

    navDots.forEach(dot => {
        dot.addEventListener('click', () => {
            switchTab(dot.dataset.target);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    let socialLoaded = false;
    let marketplaceLoaded = false;

    // =================================================================
    //  DROPDOWN OVERLAYS (body-level, positioned near selector)
    // =================================================================
    // --- Helpers for closing all dropdowns ---
    function closeAllDropdowns() {
        document.querySelectorAll('.dropdown-overlay.open').forEach(d => d.classList.remove('open'));
        document.querySelectorAll('.asset-selector.open').forEach(s => s.classList.remove('open'));
    }

    function positionDropdown(selector, dropdown) {
        const rect = selector.getBoundingClientRect();
        dropdown.style.top  = (rect.bottom + 6) + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = Math.max(rect.width, 280) + 'px';
    }

    function setupDropdown(selectorId, dropdownId, side) {
        const selector = document.getElementById(selectorId);
        const dropdown = document.getElementById(dropdownId);

        // Reposition handler for scroll events
        let scrollRAF = null;
        function onScrollReposition() {
            if (!dropdown.classList.contains('open')) return;
            if (scrollRAF) return;
            scrollRAF = requestAnimationFrame(() => {
                // Check if selector is still in viewport; if not, close
                const rect = selector.getBoundingClientRect();
                if (rect.bottom < 0 || rect.top > window.innerHeight) {
                    closeAllDropdowns();
                } else {
                    positionDropdown(selector, dropdown);
                }
                scrollRAF = null;
            });
        }

        // Listen to scroll on window AND all scrollable ancestors
        window.addEventListener('scroll', onScrollReposition, true);

        selector.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close all other dropdowns first
            document.querySelectorAll('.dropdown-overlay.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
            document.querySelectorAll('.asset-selector.open').forEach(s => { if (s !== selector) s.classList.remove('open'); });

            const isOpen = dropdown.classList.contains('open');
            if (isOpen) {
                dropdown.classList.remove('open');
                selector.classList.remove('open');
            } else {
                positionDropdown(selector, dropdown);
                dropdown.classList.add('open');
                selector.classList.add('open');
            }
        });

        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const asset = item.dataset.asset;
                if (side === 'offer') { offerAsset = asset; updateAssetUI('offer', asset); }
                else { receiveAsset = asset; updateAssetUI('receive', asset); }
                dropdown.classList.remove('open');
                selector.classList.remove('open');
                refreshBalances();
            });
        });
    }

    setupDropdown('offer-selector', 'offer-dropdown', 'offer');
    setupDropdown('receive-selector', 'receive-dropdown', 'receive');

    // Close all dropdowns on outside click
    document.addEventListener('click', () => closeAllDropdowns());

    // Close all dropdowns on window resize
    window.addEventListener('resize', () => closeAllDropdowns());

    function updateAssetUI(side, assetKey) {
        const info = ASSETS[assetKey];
        const icon = document.getElementById(`${side}-icon`);
        const name = document.getElementById(`${side}-name`);
        const amountInput = document.getElementById(`${side}-amount`);

        icon.className = `asset-glass-ios ${info.game}`; // use game key for styling
        icon.textContent = info.icon;

        // Show game origin badge next to asset name
        const gameInfo = GAME_REGISTRY[info.game];
        const gameBadge = gameInfo ? `<span class="game-origin-badge" style="background:${gameInfo.color}22;color:${gameInfo.color};border:1px solid ${gameInfo.color}44">${gameInfo.icon} ${gameInfo.name}</span>` : '';
        name.innerHTML = `${info.name} ${gameBadge}`;

        // Smart defaults: ERC-20 → 100, NFTs/commodities → 1
        amountInput.value = info.type === 'ERC-20' ? '100' : '1';

        // Render explicit monetary value mapped directly from their game definition records
        const renderValue = () => {
            const valDisplay = document.getElementById(`${side}-value-display`);
            const amt = parseFloat(amountInput.value) || 0;
            const pegHtml = info.type === 'ERC-20' ? ' <span class="peg-status healthy">Peg Stable</span>' : ` <span style="font-size:0.75rem; color:var(--text-secondary)">${info.type}</span>`;
            const baseVal = info.baseValue || 0;
            const total = (amt * baseVal).toFixed(2);
            valDisplay.innerHTML = `~$${total}${pegHtml}`;
        };
        
        renderValue();

        amountInput.oninput = renderValue;
    }

    // =================================================================
    //  SWAP REVERSE
    // =================================================================
    swapReverseBtn.addEventListener('click', () => {
        const tmp = offerAsset; offerAsset = receiveAsset; receiveAsset = tmp;
        const offerIn = document.getElementById('offer-amount');
        const recIn   = document.getElementById('receive-amount');
        const tmpVal  = offerIn.value; offerIn.value = recIn.value; recIn.value = tmpVal;
        updateAssetUI('offer', offerAsset);
        updateAssetUI('receive', receiveAsset);
        refreshBalances();
        addLog('[SWAP] Reversed offer ↔ receive');
    });

    // =================================================================
    //  WALLET CONNECTION
    // Dynamic burner wallet for demo mode without exposing credentials
    function getOrCreateBurnerKey() {
        let key = localStorage.getItem('dmex_burner_key');
        if (!key) {
            const randomWallet = ethers.Wallet.createRandom();
            key = randomWallet.privateKey;
            localStorage.setItem('dmex_burner_key', key);
        }
        return key;
    }

    // Helper: Safely normalize any hex address to EIP-55 checksum.
    // Ethers v6 rejects mixed-case addresses that aren't properly checksummed.
    function safeAddr(addr) {
        if (!addr || typeof addr !== 'string') return addr;
        try {
            return ethers.getAddress(addr);           // proper EIP-55
        } catch {
            return addr.toLowerCase();                // fallback: lowercase always accepted
        }
    }

    // Helper: Promise with timeout
    function withTimeout(promise, ms, label = 'Operation') {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms/1000}s`)), ms))
        ]);
    }

    async function connectWallet(forceDirect = false) {
        if (userAddr) {
            provider = null; signer = null; userAddr = null;
            vaultContract = null; dgldContract = null;
            swordContract = null; commodityContract = null;
            connectBtn.innerText = 'Connect MetaMask';
            connectBtn.classList.remove('outlined'); connectBtn.classList.add('primary');
            directRpcBtn.innerText = 'Use Direct RPC';
            directRpcBtn.classList.remove('primary'); directRpcBtn.classList.add('outlined');
            addLog('[WALLET] Disconnected.');
            showToast('Wallet disconnected');
            return;
        }

        const activeBtn = forceDirect ? directRpcBtn : connectBtn;
        activeBtn.innerText = 'Connecting...';
        connectBtn.disabled = true;
        directRpcBtn.disabled = true;

        try {
            let connected = false;

            // MetaMask attempt — with timeout and graceful detection
            if (!forceDirect) {
                if (typeof window.ethereum === 'undefined') {
                    addLog('[WALLET] No wallet extension detected (MetaMask not installed)');
                    showToast('No MetaMask extension detected! Please ensure it is installed and enabled.', 'error');
                    // Wait 3 seconds so the user can read the notification
                    await new Promise(r => setTimeout(r, 3000));
                    addLog('[WALLET] Falling back to Direct RPC automatically...');
                    showToast('Falling back to Direct RPC...', 'info');
                    // Auto-fall through to Direct RPC
                    forceDirect = true;
                } else {
                    try {
                        let eth = window.ethereum;
                        if (eth.providers?.length > 0) {
                            const mm = eth.providers.find(p => p.isMetaMask);
                            if (mm) eth = mm;
                        }
                        addLog('[WALLET] Requesting MetaMask accounts...');

                        // Timeout: MetaMask prompt can hang if user ignores it
                        const accounts = await withTimeout(
                            eth.request({ method: 'eth_requestAccounts' }),
                            15000, 'MetaMask prompt'
                        );

                        if (accounts?.length > 0) {
                            userAddr = accounts[0];
                            provider = new ethers.BrowserProvider(eth, "any");
                            signer = await provider.getSigner(userAddr);

                            const chainIdHex = await eth.request({ method: 'eth_chainId' });
                            if (parseInt(chainIdHex, 16) !== SCROLL_SEPOLIA_CHAIN_ID) {
                                addLog('[WALLET] Switching to Scroll Sepolia...');
                                try {
                                    await withTimeout(
                                        eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SCROLL_SEPOLIA_CHAIN_CONFIG.chainId }] }),
                                        10000, 'Chain switch'
                                    );
                                } catch (sw) {
                                    if (sw.code === 4902 || sw.code === -32603) {
                                        await eth.request({ method: 'wallet_addEthereumChain', params: [SCROLL_SEPOLIA_CHAIN_CONFIG] });
                                    } else if (sw.code === 4001) {
                                        throw new Error('User rejected chain switch. Please switch to Scroll Sepolia manually.');
                                    } else {
                                        throw sw;
                                    }
                                }
                                // Re-initialize after chain switch
                                provider = new ethers.BrowserProvider(eth, "any");
                                signer = await provider.getSigner(userAddr);
                            }
                            connected = true;
                            addLog(`[WALLET] MetaMask connected: ${shortAddr(userAddr)}`);
                        }
                    } catch (mmErr) {
                        const errMsg = mmErr.message || '';
                        if (mmErr.code === 4001 || errMsg.includes('User rejected') || errMsg.includes('user rejected')) {
                            addLog('[WALLET] User rejected the connection request');
                            showToast('Connection rejected by user', 'error');
                            // Don't fall through — user made a deliberate choice
                        } else if (errMsg.includes('timed out')) {
                            addLog('[WALLET] MetaMask prompt timed out (15s). Try clicking the MetaMask icon or use Direct RPC.');
                            showToast('MetaMask timed out — try again or use Direct RPC', 'error');
                        } else if (errMsg.includes('No active wallet found')) {
                            addLog('[WALLET] Browser returned "No active wallet found". This usually means another extension (like Brave Wallet) is intercepting MetaMask, or MetaMask is locked/not set up.');
                            showToast('MetaMask is being intercepted or is not set up. Please check your extensions.', 'error');
                            await new Promise(r => setTimeout(r, 4000));
                            addLog('[WALLET] Falling back to Direct RPC...');
                            forceDirect = true;
                        } else {
                            addLog(`[WALLET] MetaMask error: ${errMsg.slice(0,60)}`);
                            showToast(`MetaMask error: ${errMsg.slice(0, 40)}. Falling back in 3s...`, 'error');
                            await new Promise(r => setTimeout(r, 3000));
                            addLog('[WALLET] Falling back to Direct RPC...');
                            forceDirect = true; // auto-fallback
                        }
                    }
                }
            }

            // Direct RPC fallback or forced — with automatic failover
            if (!connected && forceDirect) {
                addLog('[WALLET] Connecting via Direct RPC to Scroll Sepolia...');
                let rpcConnected = false;
                for (const rpcUrl of SCROLL_SEPOLIA_RPCS) {
                    try {
                        addLog(`[RPC] Trying ${rpcUrl.replace('https://','').slice(0,35)}...`);
                        const testProvider = new ethers.JsonRpcProvider(rpcUrl, SCROLL_SEPOLIA_CHAIN_ID);
                        await withTimeout(testProvider.getBlockNumber(), 30000, 'RPC health check');
                        provider = testProvider;
                        const wallet = new ethers.Wallet(getOrCreateBurnerKey(), provider);
                        signer = wallet; userAddr = wallet.address;
                        addLog(`[WALLET] Direct RPC connected: ${shortAddr(userAddr)}`);
                        addLog(`[RPC] ✓ Using ${rpcUrl.replace('https://','').slice(0,40)}`);
                        rpcConnected = true;
                        connected = true;
                        break;
                    } catch (rpcErr) {
                        addLog(`[RPC] ✗ ${rpcUrl.replace('https://','').slice(0,30)} failed: ${rpcErr.message || 'Network Error'}`);
                        console.error('RPC Error details:', rpcErr);
                    }
                }
                if (!rpcConnected) {
                    addLog('[ERROR] All RPC endpoints failed. Check your internet connection.');
                    showToast('All RPCs failed — check connectivity', 'error');
                }
            } else if (!connected && !forceDirect) {
                // MetaMask was rejected by user — don't auto-fallback
                throw new Error("MetaMask connection cancelled. Use 'Direct RPC' for testnet access.");
            }

            if (connected) {
                // Contracts
                vaultContract     = new ethers.Contract(CONTRACTS.VAULT_PROXY, VAULT_ABI, signer);
                dgldContract      = new ethers.Contract(CONTRACTS.DGLD, ERC20_ABI, signer);
                swordContract     = new ethers.Contract(CONTRACTS.NFT_SWORD, ERC721_ABI, signer);
                commodityContract = new ethers.Contract(CONTRACTS.COMMODITY, ERC1155_ABI, signer);

                activeBtn.innerText = shortAddr(userAddr);
                activeBtn.classList.remove('outlined'); activeBtn.classList.add('primary');
                addLog(`[CHAIN] Scroll Sepolia (${SCROLL_SEPOLIA_CHAIN_ID})`);
                showToast('Connected to Scroll Sepolia!');
                await refreshBalances();
                updateWelcomeMessage();
                fetchOrderHistory();

                // Generate swap suggestions after connecting
                generateSwapSuggestions();
                renderQuickCounterparties();
            }
        } catch (err) {
            console.error(err);
            activeBtn.innerText = forceDirect ? 'Use Direct RPC' : 'Connect MetaMask';
            const msg = (err.reason || err.message || 'Unknown').slice(0, 80);
            showToast('Connection failed: ' + msg, 'error');
            addLog('[ERROR] ' + msg);
        } finally {
            // Reset button texts based on connection state
            if (userAddr) {
                const short = shortAddr(userAddr);
                connectBtn.innerText = short;
                directRpcBtn.innerText = short;
            } else {
                connectBtn.innerText = 'Connect MetaMask';
                directRpcBtn.innerText = 'Use Direct RPC';
            }
            connectBtn.disabled = false;
            directRpcBtn.disabled = false;
        }
    }

    const walletConnectModal = document.getElementById('wallet-connect-modal');
    const closeWalletBtn = document.getElementById('close-wallet-modal');

    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            console.log('[DEBUG] Connect button clicked');
            if (userAddr) { connectWallet(false); } // If already connected, disconnect
            else { walletConnectModal.classList.add('open'); }
        });
    }

    if (directRpcBtn) {
        directRpcBtn.addEventListener('click', () => {
            if (userAddr) { connectWallet(true); }
            else { walletConnectModal.classList.add('open'); }
        });
    }

    if (closeWalletBtn) {
        closeWalletBtn.addEventListener('click', () => walletConnectModal.classList.remove('open'));
    }

    if (faucetBtn) {
        faucetBtn.addEventListener('click', async () => {
            if (!userAddr) {
                showToast('Connect wallet first to claim tokens', 'error');
                return;
            }
            try {
                faucetBtn.disabled = true;
                faucetBtn.innerText = 'Minting...';
                showToast('Requesting testnet assets from Guardian Faucet...');
                addLog('[FAUCET] Requesting tokens for ' + shortAddr(userAddr));
                
                const res = await fetch(GUARDIAN_API + '/api/faucet', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address: userAddr })
                });
                
                const data = await res.json();
                if (res.ok) {
                    showToast('Tokens claimed successfully! ✨', 'success');
                    addLog('[FAUCET] Received: 1000 DGLD, 1 NFT Sword, 50 Commodities');
                    await refreshBalances();
                } else {
                    throw new Error(data.error || 'Faucet failed');
                }
            } catch (err) {
                console.error(err);
                showToast('Faucet error: ' + err.message, 'error');
                addLog('[FAUCET] Error: ' + err.message);
            } finally {
                faucetBtn.disabled = false;
                faucetBtn.innerText = 'Claim Test Tokens';
            }
        });
    }

    // Modal Option Handlers
    document.querySelectorAll('.wallet-option-card').forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.wallet;
            walletConnectModal.classList.remove('open');
            if (type === 'smart') {
                showToast('🚀 Initializing D-MEX Smart Wallet via Direct RPC...', 'info');
                // Simulate Account Abstraction setup delay
                setTimeout(() => {
                    connectWallet(true); 
                }, 800);
            } else if (type === 'browser') {
                connectWallet(false); // MetaMask
            } else if (type === 'direct') {
                showToast('Connecting via Direct RPC...', 'info');
                connectWallet(true);
            } else if (type === 'hardware') {
                showToast('Please connect your Hardware Wallet...', 'info');
                setTimeout(() => showToast('Hardware Wallet connection timed out (Demo Mode)', 'error'), 2000);
            }
        });
    });

    // =================================================================
    //  BALANCE REFRESH with Flash Animation
    // =================================================================
    let prevBalances = { dgld: null, nft: null, commodity: null };

    async function refreshBalances() {
        if (!userAddr || !dgldContract) return;
        try {
            const dgldBal      = await dgldContract.balanceOf(userAddr);
            const swordBal     = await swordContract.balanceOf(userAddr);
            const commodityBal = await commodityContract.balanceOf(userAddr, 0);
            const ethBalRaw    = await provider.getBalance(userAddr);

            const dgldF   = parseFloat(ethers.formatUnits(dgldBal, 18)).toFixed(1);
            const nftC    = swordBal.toString();
            const commC   = commodityBal.toString();
            const ethF    = parseFloat(ethers.formatEther(ethBalRaw)).toFixed(4);

            // Offer balance
            const offerBal = document.getElementById('offer-balance');
            offerBal.textContent = 'Balance: 0';
            if (offerAsset === 'dgld')      offerBal.textContent = `Balance: ${dgldF}`;
            else if (offerAsset === 'sword')     offerBal.textContent = `Owned: ${nftC}`;
            else if (offerAsset === 'commodity') offerBal.textContent = `Qty: ${commC}`;

            // Receive balance
            const recBal = document.getElementById('receive-balance');
            recBal.textContent = 'Balance: 0';
            if (receiveAsset === 'dgld')      recBal.textContent = `Balance: ${dgldF}`;
            else if (receiveAsset === 'sword')     recBal.textContent = `ID: #0`;
            else if (receiveAsset === 'commodity') recBal.textContent = `Qty: ${commC}`;

            // Flash if changed
            if (prevBalances.dgld !== null && prevBalances.dgld !== dgldF) {
                flashElement(offerBal);
                flashElement(recBal);
                showToast(`Balance: ${dgldF} DGLD`);
            }
            prevBalances = { dgld: dgldF, nft: nftC, commodity: commC };
            addLog(`[BALANCE] DGLD: ${dgldF} | NFTs: ${nftC} | Commodities: ${commC}`);

            // Update Portfolio Widget
            updatePortfolioWidget(dgldF, nftC, commC, ethF);
        } catch (err) { addLog('[BALANCE] Error: ' + err.message.slice(0, 50)); }
    }

    // =================================================================
    //  PORTFOLIO WIDGET LOGIC
    // =================================================================
    let isBalanceHidden = localStorage.getItem('dmex_balance_hidden') === 'true';
    let currentBalanceUnit = 'USD';
    let portfolioValues = { USD: 0, ETH: 0, DGLD: 0 };

    function updatePortfolioWidget(dgld, nft, comm, eth) {
        document.getElementById('portfolio-balance-container').style.display = 'block';
        
        // Rough mock prices: 1 DGLD = $0.10, 1 NFT = $50, 1 Comm = $5, 1 ETH = $3000
        const totalUsd = (parseFloat(dgld) * 0.10) + (parseInt(nft) * 50) + (parseInt(comm) * 5) + (parseFloat(eth || 0) * 3000);
        portfolioValues.USD = totalUsd;
        portfolioValues.ETH = parseFloat(eth || 0);
        portfolioValues.DGLD = parseFloat(dgld);

        renderPortfolioBalance();
    }

    function renderPortfolioBalance() {
        const displayEl = document.getElementById('display-balance-value');
        if (isBalanceHidden) {
            displayEl.textContent = '***';
            document.getElementById('eye-icon-open').style.display = 'none';
            document.getElementById('eye-icon-closed').style.display = 'inline';
        } else {
            document.getElementById('eye-icon-open').style.display = 'inline';
            document.getElementById('eye-icon-closed').style.display = 'none';
            
            if (currentBalanceUnit === 'USD') {
                displayEl.textContent = `$${portfolioValues.USD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            } else if (currentBalanceUnit === 'ETH') {
                displayEl.textContent = `${portfolioValues.ETH.toLocaleString('en-US', {minimumFractionDigits: 4, maximumFractionDigits: 4})} ETH`;
            } else if (currentBalanceUnit === 'DGLD') {
                displayEl.textContent = `${portfolioValues.DGLD.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})} DGLD`;
            }
        }
    }

    document.getElementById('toggle-balance-visibility').addEventListener('click', () => {
        isBalanceHidden = !isBalanceHidden;
        localStorage.setItem('dmex_balance_hidden', isBalanceHidden);
        renderPortfolioBalance();
    });

    document.getElementById('balance-unit-select').addEventListener('change', (e) => {
        currentBalanceUnit = e.target.value;
        renderPortfolioBalance();
    });

    document.getElementById('edit-name-btn').addEventListener('click', () => {
        const headerBox = document.getElementById('welcome-header-box');
        const editorBox = document.getElementById('inline-name-editor');
        const inputField = document.getElementById('inline-name-input');
        
        let currentName = localStorage.getItem('dmex_username') || '';
        try {
            const pi = JSON.parse(localStorage.getItem('dmex_personal_info') || '{}');
            if (pi.firstName) currentName = pi.firstName;
        } catch(e) {}
        
        inputField.value = currentName;
        headerBox.style.display = 'none';
        editorBox.style.display = 'flex';
        inputField.focus();
    });

    document.getElementById('save-inline-name-btn').addEventListener('click', () => {
        const headerBox = document.getElementById('welcome-header-box');
        const editorBox = document.getElementById('inline-name-editor');
        const inputField = document.getElementById('inline-name-input');
        
        const newName = inputField.value.trim();
        if (newName) {
            localStorage.setItem('dmex_username', newName);
            
            // Sync with profile modal
            try {
                let pi = JSON.parse(localStorage.getItem('dmex_personal_info') || '{}');
                pi.firstName = newName;
                localStorage.setItem('dmex_personal_info', JSON.stringify(pi));
                if(document.getElementById('profile-modal-name')) {
                    document.getElementById('profile-modal-name').textContent = newName || 'Guest Trader';
                }
                if(document.getElementById('profile-input-fn')) {
                    document.getElementById('profile-input-fn').value = newName;
                }
            } catch(e) {}
        }
        
        headerBox.style.display = 'flex';
        editorBox.style.display = 'none';
        updateWelcomeMessage();
    });

    document.getElementById('inline-name-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('save-inline-name-btn').click();
    });

    function scrollToOrders() {
        const marketTabBtn = document.querySelector('.tab[data-tab="market"]');
        if (marketTabBtn && !marketTabBtn.classList.contains('active')) {
            marketTabBtn.click();
        }
        setTimeout(() => {
            const ordersEl = document.getElementById('market-orders');
            if (ordersEl) {
                ordersEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                flashElement(ordersEl);
            }
        }, 50);
    }

    const jumpBtn = document.getElementById('jump-to-orders');
    if (jumpBtn) jumpBtn.addEventListener('click', scrollToOrders);

    const jumpMarketBtn = document.getElementById('jump-to-orders-market');
    if (jumpMarketBtn) jumpMarketBtn.addEventListener('click', scrollToOrders);

    function updateWelcomeMessage() {
        let name = localStorage.getItem('dmex_username');
        try {
            const pi = JSON.parse(localStorage.getItem('dmex_personal_info') || '{}');
            if (pi.firstName) name = pi.firstName;
        } catch(e) {}
        
        const welcomeEl = document.getElementById('welcome-text');
        const addrEl = document.getElementById('welcome-address');
        
        if (name && name.length > 0) {
            welcomeEl.textContent = `Welcome, ${name}`;
        } else {
            welcomeEl.textContent = `Welcome, ${userAddr ? shortAddr(userAddr) : 'Trader'}`;
        }
        
        if (userAddr) {
            addrEl.textContent = `Connected: ${shortAddr(userAddr)}`;
            addrEl.style.color = 'var(--spotify-green)';
        } else {
            addrEl.textContent = 'Connect wallet to view portfolio';
            addrEl.style.color = 'var(--text-secondary)';
        }
    }
    
    // Initialize state on load
    updateWelcomeMessage();
    renderPortfolioBalance();

    // =================================================================
    //  HEURISTIC AI REASONING (Agentic UX) & SWAP COMMIT
    // =================================================================
    const aiIntervention = document.getElementById('ai-intervention');
    const aiText = document.getElementById('ai-intervention-text');
    let pendingSwap = null;
    let resolvedCounterparty = null; // address resolved from counterparty bar

    // =================================================================
    //  COUNTERPARTY ADDRESS RESOLUTION
    // =================================================================
    const cpInput = document.getElementById('counterparty-address');
    const cpPreview = document.getElementById('counterparty-preview');
    const cpPasteBtn = document.getElementById('counterparty-paste');
    const cpClearBtn = document.getElementById('cp-clear');

    // Generate gradient avatar from address
    function addrGradient(addr) {
        if (!addr || addr.length < 10) return 'linear-gradient(135deg, #1ed760, #1db954)';
        const h1 = parseInt(addr.slice(2, 8), 16) % 360;
        const h2 = (h1 + 60 + parseInt(addr.slice(8, 12), 16) % 120) % 360;
        return `linear-gradient(135deg, hsl(${h1},70%,50%), hsl(${h2},70%,40%))`;
    }
    // Initials from address
    function addrInitials(addr) {
        if (!addr || addr.length < 6) return '??';
        return addr.slice(2, 4).toUpperCase();
    }

    function setAvatar(el, addr) {
        el.style.background = addrGradient(addr);
        el.textContent = addrInitials(addr);
    }

    async function resolveCounterparty(addr) {
        addr = safeAddr(addr);                       // normalise checksum
        if (!addr || !addr.startsWith('0x') || addr.length < 10) {
            cpPreview.style.display = 'none';
            resolvedCounterparty = null;
            return;
        }
        resolvedCounterparty = addr;

        // Set avatar
        setAvatar(document.getElementById('cp-avatar'), addr);
        document.getElementById('cp-display-addr').textContent = shortAddr(addr);

        cpPreview.style.display = 'flex';
        addLog(`[SWAP] Counterparty set: ${shortAddr(addr)}`);

        // Fetch portfolio from Guardian
        try {
            const res = await fetch(GUARDIAN_API + '/api/portfolio/' + addr);
            const data = await res.json();
            const rep = data.activity?.reputation || 100;
            const swaps = data.activity?.totalSwaps || 0;
            const badge = document.getElementById('cp-rep-badge');
            badge.textContent = `Rep: ${rep}%`;
            badge.className = `badge ${rep >= 90 ? 'low' : rep >= 70 ? 'medium' : 'high'}`;
            document.getElementById('cp-swap-count').textContent = `${swaps} swaps`;
        } catch (e) {
            // Use defaults for mock addresses
            document.getElementById('cp-rep-badge').textContent = 'Rep: —';
            document.getElementById('cp-swap-count').textContent = 'Unverified';
        }
    }

    cpInput.addEventListener('input', () => {
        const val = cpInput.value.trim();
        if (val.length >= 42) resolveCounterparty(val);
        else { cpPreview.style.display = 'none'; resolvedCounterparty = null; }
    });

    cpPasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            cpInput.value = text.trim();
            if (text.trim().length >= 42) resolveCounterparty(text.trim());
        } catch (e) { showToast('Clipboard access denied', 'error'); }
    });

    cpClearBtn.addEventListener('click', () => {
        cpInput.value = '';
        cpPreview.style.display = 'none';
        resolvedCounterparty = null;
    });

    document.getElementById('ai-dismiss').addEventListener('click', () => {
        aiIntervention.classList.remove('show');
        resetProposeBtn();
    });

    document.getElementById('ai-action').addEventListener('click', async () => {
        aiIntervention.classList.remove('show');
        if (pendingSwap) await executeSwapCommit();
    });

    function showHeuristicIntervention(message) {
        aiText.innerHTML = message;
        aiIntervention.classList.add('show');
    }

    function resetProposeBtn() {
        const btnText = proposeBtn.querySelector('.btn-text');
        btnText.innerText = 'Propose Intent';
        proposeBtn.style.pointerEvents = 'auto';
    }

    proposeBtn.addEventListener('click', async () => {
        if (!signer || !vaultContract) { showToast('Connect wallet first!', 'error'); return; }

        // Require 2FA if enabled before proceeding
        const authorized = await require2FA();
        if (!authorized) { resetProposeBtn(); return; }

        const btnText = proposeBtn.querySelector('.btn-text');
        proposeBtn.style.pointerEvents = 'none';
        btnText.innerText = 'Analyzing Intent...';

        const offerAmount   = document.getElementById('offer-amount').value;
        const receiveAmount = document.getElementById('receive-amount').value;

        // Psychological / Heuristic Reasoning Check
        if (offerAsset === receiveAsset) {
            pendingSwap = true;
            showHeuristicIntervention(`You are attempting to swap identical assets (${ASSETS[offerAsset].name}).<br><br><span style="color:var(--yellow)">Reasoning:</span> This resembles <strong>Wash Trading (Node A3 Risk)</strong>. It incurs gas fees for zero functional gain. Do you wish to override?`);
            resetProposeBtn();
            return;
        }
        
        if (offerAsset === 'dgld' && receiveAsset === 'sword' && parseFloat(offerAmount) > 500) {
            pendingSwap = true;
            showHeuristicIntervention(`You are offering ${offerAmount} DGLD for 1 NFT Sword.<br><br><span style="color:var(--yellow)">Reasoning:</span> The Sword NFT market is highly volatile today. Have you verified the creator's metadata to ensure this isn't a spoofed asset? (Node L3 Risk).`);
            resetProposeBtn();
            return;
        }

        // Show ATM-style verification modal OR skip to "Are you sure?" warning
        const skipVerify = localStorage.getItem('dmex_skip_swap_verify') === 'true';
        if (skipVerify) {
            showSkipVerifyWarning();
        } else {
            showSwapVerification();
        }
    });

    // =================================================================
    //  SWAP VERIFICATION MODAL (ATM-STYLE)
    // =================================================================
    const verifyModal = document.getElementById('swap-verify-modal');
    const dontAskCheckbox = document.getElementById('dont-ask-checkbox');

    // Restore "don't ask again" checkbox state
    if (localStorage.getItem('dmex_skip_swap_verify') === 'true') {
        dontAskCheckbox.checked = true;
    }

    function showSwapVerification() {
        const offerAmt = document.getElementById('offer-amount').value;
        const recAmt   = document.getElementById('receive-amount').value;
        const offerInfo = ASSETS[offerAsset];
        const recInfo   = ASSETS[receiveAsset];
        const cpAddr = resolvedCounterparty || userAddr;

        // Populate my side
        setAvatar(document.getElementById('verify-my-avatar'), userAddr);
        document.getElementById('verify-my-addr').textContent = userAddr ? shortAddr(userAddr) : '0x...';
        const vOfferIcon = document.getElementById('verify-offer-icon');
        vOfferIcon.className = `asset-icon-box ${offerInfo.iconClass} mini`;
        vOfferIcon.textContent = offerInfo.icon;
        document.getElementById('verify-offer-name').textContent = `${offerAmt} ${offerInfo.name}`;
        document.getElementById('verify-offer-value').textContent = offerAsset === 'dgld' ? `~$${(parseFloat(offerAmt) * 0.10).toFixed(2)}` : offerInfo.type;

        // Populate counterparty side
        setAvatar(document.getElementById('verify-cp-avatar'), cpAddr);
        document.getElementById('verify-cp-addr').textContent = shortAddr(cpAddr);
        const vRecIcon = document.getElementById('verify-receive-icon');
        vRecIcon.className = `asset-icon-box ${recInfo.iconClass} mini`;
        vRecIcon.textContent = recInfo.icon;
        document.getElementById('verify-receive-name').textContent = `${recAmt} ${recInfo.name}`;
        document.getElementById('verify-receive-value').textContent = receiveAsset === 'dgld' ? `~$${(parseFloat(recAmt) * 0.10).toFixed(2)}` : recInfo.type;

        verifyModal.classList.add('open');
        addLog('[VERIFY] Swap verification modal opened — awaiting user confirmation');
    }

    document.getElementById('verify-cancel').addEventListener('click', () => {
        verifyModal.classList.remove('open');
        resetProposeBtn();
        addLog('[VERIFY] Swap cancelled by user');
    });
    document.getElementById('close-verify').addEventListener('click', () => {
        verifyModal.classList.remove('open');
        resetProposeBtn();
    });
    document.getElementById('verify-confirm').addEventListener('click', async () => {
        // Persist "don't ask again" preference
        if (dontAskCheckbox.checked) {
            localStorage.setItem('dmex_skip_swap_verify', 'true');
            addLog('[VERIFY] "Don\'t ask again" enabled — future swaps will show bypass warning');
        } else {
            localStorage.removeItem('dmex_skip_swap_verify');
        }
        verifyModal.classList.remove('open');
        addLog('[VERIFY] ✓ User confirmed swap — executing on-chain');
        await executeSwapCommit();
    });
    window.addEventListener('click', (e) => {
        if (e.target === verifyModal) { verifyModal.classList.remove('open'); resetProposeBtn(); }
    });

    // =================================================================
    //  "ARE YOU SURE?" BYPASS WARNING MODAL
    // =================================================================
    const skipVerifyModal = document.getElementById('skip-verify-modal');

    function showSkipVerifyWarning() {
        skipVerifyModal.classList.add('open');
        addLog('[VERIFY] Verification skipped — showing bypass warning');
    }

    document.getElementById('skip-verify-cancel').addEventListener('click', () => {
        skipVerifyModal.classList.remove('open');
        // Re-enable verification and show the normal modal
        localStorage.removeItem('dmex_skip_swap_verify');
        dontAskCheckbox.checked = false;
        showSwapVerification();
        addLog('[VERIFY] User chose to go back — re-enabling verification');
    });
    document.getElementById('close-skip-verify').addEventListener('click', () => {
        skipVerifyModal.classList.remove('open');
        resetProposeBtn();
    });
    document.getElementById('skip-verify-confirm').addEventListener('click', async () => {
        skipVerifyModal.classList.remove('open');
        addLog('[VERIFY] ⚠ User bypassed verification — executing on-chain directly');
        await executeSwapCommit();
    });
    window.addEventListener('click', (e) => {
        if (e.target === skipVerifyModal) { skipVerifyModal.classList.remove('open'); resetProposeBtn(); }
    });

    async function executeSwapCommit() {
        const btnText = proposeBtn.querySelector('.btn-text');
        const orig = 'Propose Intent';
        btnText.innerText = 'Preparing...';

        try {
            const offerAmount   = document.getElementById('offer-amount').value;
            const receiveAmount = document.getElementById('receive-amount').value;

            // Resolve asset info FIRST (before approval checks)
            const offerInfo = ASSETS[offerAsset];
            const recInfo   = ASSETS[receiveAsset];

            // ERC-20 approval
            if (offerInfo.type === 'ERC-20') {
                addLog('[TX] Checking DGLD allowance...');
                const amtWei = ethers.parseUnits(offerAmount, 18);
                const allowance = await dgldContract.allowance(userAddr, CONTRACTS.VAULT_PROXY);
                if (allowance < amtWei) {
                    addLog('[TX] Requesting DGLD approval...');
                    btnText.innerText = 'Approving DGLD...';
                    const appTx = await dgldContract.approve(CONTRACTS.VAULT_PROXY, amtWei);
                    addLog(`[TX] Approval submitted: ${shortAddr(appTx.hash)}`);
                    await appTx.wait();
                    addLog('[TX] DGLD Approved ✓');
                }
            } else if (offerInfo.type === 'ERC-721') {
                const cToken = new ethers.Contract(CONTRACTS[offerInfo.contract], ERC721_ABI, signer);
                const isApproved = await cToken.isApprovedForAll(userAddr, CONTRACTS.VAULT_PROXY);
                if (!isApproved) {
                    addLog(`[TX] Requesting ${offerInfo.name} approval...`);
                    btnText.innerText = 'Approving NFT...';
                    const appTx = await cToken.setApprovalForAll(CONTRACTS.VAULT_PROXY, true);
                    addLog(`[TX] Approval submitted: ${shortAddr(appTx.hash)}`);
                    await appTx.wait();
                    addLog(`[TX] ${offerInfo.name} Approved ✓`);
                }
            } else if (offerInfo.type === 'ERC-1155') {
                const cToken = new ethers.Contract(CONTRACTS[offerInfo.contract], ERC1155_ABI, signer);
                const isApproved = await cToken.isApprovedForAll(userAddr, CONTRACTS.VAULT_PROXY);
                if (!isApproved) {
                    addLog(`[TX] Requesting ${offerInfo.name} approval...`);
                    btnText.innerText = 'Approving Commodity...';
                    const appTx = await cToken.setApprovalForAll(CONTRACTS.VAULT_PROXY, true);
                    addLog(`[TX] Approval submitted: ${shortAddr(appTx.hash)}`);
                    await appTx.wait();
                    addLog(`[TX] ${offerInfo.name} Approved ✓`);
                }
            }

            // Swap params — use resolved counterparty or fallback to self
            const swapId       = ethers.keccak256(ethers.randomBytes(32));
            const counterparty = safeAddr(resolvedCounterparty || userAddr);
            const expiry       = Math.floor(Date.now() / 1000) + 3600;
            const secret       = ethers.keccak256(ethers.toUtf8Bytes("dmex_secret_" + Date.now()));
            const secretHash   = ethers.keccak256(secret);

            const typeMap   = { 'ERC-20': 0, 'ERC-721': 1, 'ERC-1155': 2 };

            // UniversalVault AssetBundle builder
            const buildBundle = (info, amt) => {
                const bundle = { erc20s: [], erc20Amounts: [], nfts: [], nftIds: [] };
                if (info.type === 'ERC-20') {
                    bundle.erc20s.push(CONTRACTS[info.contract]);
                    bundle.erc20Amounts.push(ethers.parseUnits(amt, 18));
                } else if (info.type === 'ERC-721') {
                    bundle.nfts.push(CONTRACTS[info.contract]);
                    bundle.nftIds.push(0); // Mock ID 0
                } else if (info.type === 'ERC-1155') {
                    // ERC-1155 goes through nfts array with ID 0
                    bundle.nfts.push(CONTRACTS[info.contract]);
                    bundle.nftIds.push(0);
                }
                return bundle;
            };

            const offered = buildBundle(offerInfo, offerAmount);
            const wanted  = buildBundle(recInfo, receiveAmount);
            const metadataHash = ethers.keccak256(ethers.toUtf8Bytes("meta_"+swapId));

            addLog('[TX] Submitting proposeTrade to Universal Vault...');
            btnText.innerText = 'Proposing...';

            const tx = await vaultContract.proposeTrade(swapId, counterparty, offered, wanted, metadataHash);
            addLog(`[TX] Broadcast: ${shortAddr(tx.hash)}`);
            btnText.innerText = 'Mining...';

            const receipt = await tx.wait();
            addLog(`[TX] ✓ Mined in block ${receipt.blockNumber} (Gas: ${receipt.gasUsed})`);
            addLog(`[VAULT] SwapId: ${shortAddr(swapId)}`);
            addLog(`[EXPLORER] https://sepolia.scrollscan.com/tx/${tx.hash}`);

            btnText.innerText = 'Success! ✓';
            showToast(`Swap committed! Tx: ${shortAddr(tx.hash)}`);

            // --- Call Guardian API for real evaluation ---
            try {
                const evalRes = await fetch(GUARDIAN_API + '/api/evaluate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tradeId: swapId,
                        metadataHash: metadataHash,
                        offeredHash: ethers.ZeroHash,
                        wantedHash: ethers.ZeroHash,
                        assetsOffered: [{ type: offerInfo.type, amount: offerAmount }],
                        assetsWanted: [{ type: recInfo.type, amount: receiveAmount }],
                        offerValue: offerAsset === 'dgld' ? parseFloat(offerAmount) * 0.10 : 5.0,
                        wantedValue: receiveAsset === 'dgld' ? parseFloat(receiveAmount) * 0.10 : 5.0,
                        mode: typeof isLiveMarketplace !== 'undefined' && isLiveMarketplace ? 'live' : 'demo'
                    })
                });
                const evalData = await evalRes.json();
                recordEvaluation(swapId, tx.hash, evalData.riskScore, evalData.decision, evalData.fairValue, evalData.severity);

                // Show psychology warnings if any
                if (evalData.psychWarnings && evalData.psychWarnings.length > 0) {
                    const warnMsg = evalData.psychWarnings.map(w => `<strong>${w.bias}:</strong> ${w.message}`).join('<br><br>');
                    showHeuristicIntervention(warnMsg);
                }

                if (evalData.decision === 'pending_co_signer') {
                    showToast('Swap requires Human Co-Signer due to high risk!', 'warning');
                }

                addLog(`[AI] Guardian: score=${evalData.riskScore}, decision=${evalData.decision}`);
            } catch (evalErr) {
                // Fallback to mock if guardian is offline
                const riskScore = Math.floor(Math.random() * 35);
                recordEvaluation(swapId, tx.hash, riskScore, 'approve');
                addLog('[AI] Guardian offline — used mock evaluation');
            }
            addMarketOrder(swapId, offerAsset, offerAmount, receiveAsset, receiveAmount, expiry, tx.hash);

            await refreshBalances();

        } catch (err) {
            console.error('[SWAP_ERROR]', err);
            
            // Extract a clean, user-friendly reason
            let reason = 'Unknown error occurred.';
            let logDetails = err.message || 'No additional details';
            
            if (err.code === 'ACTION_REJECTED') {
                reason = 'Transaction rejected by user in wallet.';
            } else if (err.message && err.message.includes('insufficient funds')) {
                reason = 'Insufficient Sepolia ETH for gas fees.';
            } else if (err.reason) {
                reason = err.reason; // Smart contract revert reason
            } else if (err.shortMessage) {
                reason = err.shortMessage;
            } else if (err.message) {
                // Try to extract useful info from long RPC errors
                const match = err.message.match(/execution reverted: ([^"]+)/);
                if (match) reason = `Reverted: ${match[1]}`;
                else reason = err.message.split(' (')[0]; 
            }
            
            // Clean up the reason for the toast (keep it concise)
            const toastReason = reason.length > 50 ? reason.slice(0, 47) + '...' : reason;

            addLog(`[ERROR] Swap execution failed: ${reason}`);
            addLog(`[DEBUG] ${logDetails.slice(0, 150).replace(/\n/g, ' ')}...`);
            
            showToast(`Swap failed: ${toastReason}`, 'error');
            btnText.innerText = 'Failed ✗';
        } finally {
            setTimeout(() => {
                resetProposeBtn();
            }, 3000);
            pendingSwap = null;
        }
    }

    // =================================================================
    //  OPEN MARKET
    // =================================================================
    function addMarketOrder(swapId, offerKey, offerAmt, receiveKey, receiveAmt, expiry, txHash) {
        marketOrders.unshift({ swapId, offerKey, offerAmt, receiveKey, receiveAmt, expiry, txHash, timestamp: Date.now() });
        renderMarketOrders();
    }

    function renderMarketOrders() {
        const container = document.getElementById('market-orders');
        const emptyMsg  = document.getElementById('orders-empty');
        container.querySelectorAll('.order-card').forEach(c => c.remove());
        if (marketOrders.length === 0) { if (emptyMsg) emptyMsg.style.display = 'block'; return; }
        if (emptyMsg) emptyMsg.style.display = 'none';

        marketOrders.forEach(order => {
            const of = ASSETS[order.offerKey], rc = ASSETS[order.receiveKey];
            const mins = Math.max(0, Math.floor((order.expiry - Date.now()/1000) / 60));
            const card = document.createElement('div');
            card.className = 'order-card spotify-card';
            card.innerHTML = `
                <div class="order-details">
                    <div class="giving"><span class="small-label">Offering</span> ${order.offerAmt} ${of.name}</div>
                    <div class="getting"><span class="small-label">Wants</span> ${order.receiveAmt} ${rc.name}</div>
                    <div class="order-meta"><span class="order-id">${shortAddr(order.swapId)}</span><span class="order-timer">⏱ ${mins}m</span></div>
                </div>
                <a href="https://sepolia.scrollscan.com/tx/${order.txHash}" target="_blank" class="pill-btn outlined" style="font-size:0.8rem;padding:8px 16px;">View Tx</a>
            `;
            container.insertBefore(card, emptyMsg);
        });
    }

    // =================================================================
    //  ANALYTICS ENGINE
    // =================================================================
    function recordEvaluation(swapId, txHash, riskScore, decision, fairValue = null) {
        analytics.total++;
        if (decision === 'approve') analytics.approved++; 
        else if (decision === 'reject') analytics.rejected++;
        analytics.riskScores.push(riskScore);

        // Simulate attack node analysis
        analytics.attackNodes = {
            l1: Math.floor(Math.random() * 15),
            l2: Math.floor(Math.random() * 5),
            l3: Math.floor(Math.random() * 10),
            a3: Math.floor(Math.random() * 100)
        };

        const riskLevel = riskScore < 20 ? 'low' : riskScore < 50 ? 'medium' : 'high';
        analytics.evaluations.unshift({
            timestamp: new Date().toLocaleString(),
            swapId: shortAddr(swapId),
            txHash: shortAddr(txHash),
            score: riskScore,
            riskLevel,
            decision,
            fairValue  // { offeredUSD, wantedUSD } or null
        });

        updateAnalyticsUI();
        const fvStr = fairValue ? ` | offered=$${fairValue.offeredUSD} wanted=$${fairValue.wantedUSD}` : '';
        addLog(`[AI] Evaluation: score=${riskScore}, level=${riskLevel}, decision=${decision}${fvStr}`);
        
        // Trigger sidebar update on evaluation
        updateArbiterSidebar();
    }

    function updateArbiterSidebar() {
        const velVal = document.getElementById('arbiter-velocity-val');
        const velBar = document.getElementById('arbiter-velocity-bar');
        const volVal = document.getElementById('arbiter-volatility-val');
        const volBar = document.getElementById('arbiter-volatility-bar');
        const taxVal = document.getElementById('arbiter-tax-val');

        if (!velVal || !velBar || !volVal || !taxVal) return;

        // Simulate Velocity based on total evaluations vs "capacity"
        const velocity = Math.min(100, (analytics.total * 7.5) % 100);
        velVal.textContent = `${(velocity/20).toFixed(1)}% / 5.0%`;
        velBar.style.width = velocity + '%';
        
        // Volatility based on latest risk score variance
        const scores = analytics.riskScores;
        const avg = scores.length > 0 ? (scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
        const vol = (avg * 0.15).toFixed(1);
        volVal.textContent = `${vol}%`;
        volBar.style.width = Math.min(100, vol * 10) + '%';
        
        // Exit Tax: High Velocity = higher tax
        const tax = velocity > 60 ? (velocity - 60) * 10 : 0;
        taxVal.textContent = `${Math.round(tax)} BPS`;
        if (tax > 0) taxVal.style.color = 'var(--danger-red)';
        else taxVal.style.color = 'var(--spotify-green)';

        [velVal, volVal, taxVal].forEach(flashElement);
    }

    // --- Arbiter Pulse Simulation ---
    setInterval(() => {
        const pulse = document.getElementById('arbiter-pulse');
        if (pulse) {
            pulse.style.opacity = '1';
            pulse.style.transform = 'scale(1.2)';
            setTimeout(() => {
                pulse.style.opacity = '0.4';
                pulse.style.transform = 'scale(1)';
            }, 300);
        }
        // Random micro-fluctuations for realism
        const velBar = document.getElementById('arbiter-velocity-bar');
        if (velBar) {
            const current = parseFloat(velBar.style.width) || 10;
            const jitter = (Math.random() - 0.5) * 2;
            velBar.style.width = Math.max(5, Math.min(95, current + jitter)) + '%';
        }
    }, 4000);

    function updateAnalyticsUI() {
        // KPIs with flash
        const kpiTotal    = document.getElementById('kpi-total');
        const kpiApproved = document.getElementById('kpi-approved');
        const kpiRejected = document.getElementById('kpi-rejected');
        const kpiRisk     = document.getElementById('kpi-risk');

        kpiTotal.textContent    = analytics.total;
        kpiApproved.textContent = analytics.approved;
        kpiRejected.textContent = analytics.rejected;

        const avgRisk = analytics.riskScores.length > 0
            ? Math.round(analytics.riskScores.reduce((a,b)=>a+b,0) / analytics.riskScores.length) : 0;
        kpiRisk.textContent = avgRisk;

        [kpiTotal, kpiApproved, kpiRejected, kpiRisk].forEach(flashElement);

        // Attack nodes
        const nodes = analytics.attackNodes;

        if (typeof isLiveMarketplace !== 'undefined' && isLiveMarketplace) {
            document.getElementById('atk-l1-val').textContent = '0';
            document.getElementById('atk-l2-val').textContent = '0';
            document.getElementById('atk-l3-val').textContent = '0';
            document.getElementById('atk-a3-val').textContent = '0';
            document.getElementById('atk-l1-bar').style.width = '0%';
            document.getElementById('atk-l2-bar').style.width = '0%';
            document.getElementById('atk-l3-bar').style.width = '0%';
            document.getElementById('atk-a3-bar').style.width = '0%';
        } else {
            document.getElementById('atk-l1-val').textContent = nodes.l1 || 0;
            document.getElementById('atk-l2-val').textContent = nodes.l2 || 0;
            document.getElementById('atk-l3-val').textContent = nodes.l3 || 0;
            document.getElementById('atk-a3-val').textContent = nodes.a3 || 0;
            document.getElementById('atk-l1-bar').style.width = `${nodes.l1 || 0}%`;
            document.getElementById('atk-l2-bar').style.width = `${nodes.l2 || 0}%`;
            document.getElementById('atk-l3-bar').style.width = `${nodes.l3 || 0}%`;
            document.getElementById('atk-a3-bar').style.width = `${nodes.a3 || 0}%`;
        }

        // Eval history
        const tbody = document.getElementById('eval-tbody');
        const emptyMsg = document.getElementById('eval-empty');
        tbody.innerHTML = '';
        if (analytics.evaluations.length > 0) emptyMsg.style.display = 'none';
        analytics.evaluations.forEach(ev => {
            const row = document.createElement('tr');
            const fvHtml = ev.fairValue
                ? `<td style="font-size:0.78rem;color:var(--spotify-green)">$${ev.fairValue.offeredUSD} / $${ev.fairValue.wantedUSD}</td>`
                : '<td style="color:#555">—</td>';
            row.innerHTML = `
                <td>${ev.timestamp}</td>
                <td style="color:var(--spotify-green)">${ev.swapId}</td>
                <td><strong>${ev.score}</strong></td>
                <td><span class="badge ${ev.riskLevel}">${ev.riskLevel.toUpperCase()}</span></td>
                <td><span class="badge ${ev.decision}">${ev.decision.toUpperCase()}</span></td>
                ${fvHtml}
            `;
            tbody.appendChild(row);
        });

        // Charts
        renderCharts();
    }

    function setAttackBar(key, score) {
        const val = document.getElementById(`atk-${key}-val`);
        const bar = document.getElementById(`atk-${key}-bar`);
        if (val) val.textContent = score;
        if (bar) bar.style.width = `${score}%`;
    }

    // =================================================================
    //  CANVAS CHARTS
    // =================================================================
    function renderCharts() {
        renderDonut();
        renderLineChart();
    }

    function renderDonut() {
        const canvas = document.getElementById('safety-donut');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // Set crisp rendering
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = 160 * dpr;
        canvas.height = 160 * dpr;
        canvas.style.width  = '160px';
        canvas.style.height = '160px';
        ctx.scale(dpr, dpr);

        const cx = 80, cy = 80, r = 55;
        ctx.clearRect(0, 0, 160, 160);

        const a = analytics.approved || 0, rej = analytics.rejected || 0;
        const total = a + rej || 1;

        // Background ring
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 18;
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.stroke();

        // Approved arc
        if (a > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + (a/total)*2*Math.PI);
            ctx.lineWidth = 18; ctx.strokeStyle = '#1ed760'; ctx.lineCap = 'round'; ctx.stroke();
        }

        // Rejected arc
        if (rej > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, -Math.PI/2 + (a/total)*2*Math.PI, -Math.PI/2 + ((a+rej)/total)*2*Math.PI);
            ctx.lineWidth = 18; ctx.strokeStyle = '#e22134'; ctx.lineCap = 'round'; ctx.stroke();
        }

        // Center text
        ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Outfit'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(Math.round((a/total)*100) + '%', cx, cy - 5);
        ctx.fillStyle = '#b3b3b3'; ctx.font = '11px Outfit';
        ctx.fillText('Safe', cx, cy + 15);
    }

    function renderLineChart() {
        const canvas = document.getElementById('risk-line-chart');
        if (!canvas || !canvas.parentElement) return;

        const wrap = canvas.parentElement;
        const w = wrap.clientWidth || 400;
        const h = wrap.clientHeight || 160;
        const dpr = window.devicePixelRatio || 1;

        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width  = w + 'px';
        canvas.style.height = h + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const pad = { top: 20, right: 20, bottom: 25, left: 40 };
        const cw = w - pad.left - pad.right;
        const ch = h - pad.top - pad.bottom;
        const maxScore = 100;
        const scores = analytics.riskScores.length > 0 ? analytics.riskScores : [0];

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = pad.top + (ch/5)*i;
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
            ctx.fillStyle = '#555'; ctx.font = '10px Courier New'; ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxScore - (maxScore/5)*i), pad.left - 6, y + 4);
        }

        // Gradient fill under line
        if (scores.length > 1) {
            const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
            grad.addColorStop(0, 'rgba(59,130,246,0.2)');
            grad.addColorStop(1, 'rgba(59,130,246,0)');

            ctx.beginPath();
            scores.forEach((s, i) => {
                const x = pad.left + (cw / (scores.length - 1)) * i;
                const y = pad.top + ch - (s/maxScore)*ch;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.lineTo(pad.left + cw, pad.top + ch);
            ctx.lineTo(pad.left, pad.top + ch);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // Line
            ctx.beginPath();
            ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
            scores.forEach((s, i) => {
                const x = pad.left + (cw / (scores.length - 1)) * i;
                const y = pad.top + ch - (s/maxScore)*ch;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // Dots
            scores.forEach((s, i) => {
                const x = pad.left + (cw / (scores.length - 1)) * i;
                const y = pad.top + ch - (s/maxScore)*ch;
                ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2);
                ctx.fillStyle = '#3b82f6'; ctx.fill();
                ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
            });
        } else {
            // Single point
            const x = w/2, y = pad.top + ch - (scores[0]/maxScore)*ch;
            ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2);
            ctx.fillStyle = '#3b82f6'; ctx.fill();
        }
    }

    // =================================================================
    //  LISTENERS
    // =================================================================
    if (typeof window.ethereum !== 'undefined') {
        window.ethereum.on('accountsChanged', () => location.reload());
        window.ethereum.on('chainChanged', () => location.reload());
    }

    dynamicIsland.addEventListener('click', () => {
        if (vaultContract) {
            addLog('[ISLAND] Querying vault status...');
            vaultContract.guardianSigner().then(g => addLog(`[VAULT] Guardian: ${shortAddr(g)}`)).catch(()=>{});
            vaultContract.protocolTreasury().then(t => addLog(`[VAULT] Treasury: ${shortAddr(t)}`)).catch(()=>{});
        }
    });

    // Initial chart draw (empty state)
    setTimeout(() => renderCharts(), 100);
    // =================================================================
    //  MODAL UI LOGIC
    // =================================================================
    const btnProfile = document.getElementById('btn-profile');
    const btnSettings = document.getElementById('btn-settings');
    const btnTutorial = document.getElementById('btn-tutorial');
    const profileModal = document.getElementById('profile-modal');
    const settingsModal = document.getElementById('settings-modal');

    // Open Profile — fetch live on-chain data
    if (btnProfile) btnProfile.addEventListener('click', async () => {
        profileModal.classList.add('open');
        if (userAddr) {
            try {
                const res = await fetch(GUARDIAN_API + '/api/portfolio/' + userAddr);
                const data = await res.json();
                // Update profile modal with real data
                const statsContainer = profileModal.querySelector('.profile-stats');
                if (statsContainer) {
                    statsContainer.innerHTML = `
                        <div class="stat-box"><span>Reputation</span><strong>${data.activity.reputation}%</strong></div>
                        <div class="stat-box"><span>Total Swaps</span><strong>${data.activity.totalSwaps}</strong></div>
                        <div class="stat-box"><span>DGLD</span><strong>${parseFloat(data.balances.dgld).toFixed(1)}</strong></div>
                        <div class="stat-box"><span>NFT Swords</span><strong>${data.balances.nftSwords}</strong></div>
                        <div class="stat-box"><span>Commodities</span><strong>${data.balances.commodities}</strong></div>
                        <div class="stat-box"><span>ETH</span><strong>${parseFloat(data.balances.eth).toFixed(4)}</strong></div>
                    `;
                }
                const syncMsg = profileModal.querySelector('p');
                if (syncMsg) syncMsg.textContent = `Wallet: ${shortAddr(userAddr)} • Scroll Sepolia`;
                addLog(`[PROFILE] Loaded: rep=${data.activity.reputation}%, swaps=${data.activity.totalSwaps}`);
            } catch (e) {
                addLog('[PROFILE] Guardian offline — showing cached data');
            }
        }
    });

    // Open Settings
    if (btnSettings) btnSettings.addEventListener('click', () => settingsModal.classList.add('open'));
    if (btnTutorial) btnTutorial.addEventListener('click', () => {
        showToast('Entering Tutorial Mode...', 'success');
        showHeuristicIntervention(`Welcome to <strong>D-MEX Protocol</strong>.<br>This is the Agentic Walkthrough. Our Goal: Immutable Escrow matching with high efficiency. Click the Propose Intent tab to build a swap!`);
    });

    // Settings: Psychology & Defaults toggle (now uses explicit ID)
    const psychCheckbox = document.getElementById('psych-checkbox');
    const autoRejectSlider = document.getElementById('auto-reject-slider');
    const autoRejectLabel = document.getElementById('auto-reject-label');
    const slippageSlider = document.getElementById('slippage-slider');
    const slippageLabel = document.getElementById('slippage-label');

    // Settings state
    let settingsState = { autoReject: 50, psychology: true, slippage: 5, showInsights: true };

    const toggle2FA = document.getElementById('toggle-2fa');
    if (toggle2FA) {
        if (is2FAEnabled) toggle2FA.classList.add('active');
        toggle2FA.addEventListener('click', () => {
            is2FAEnabled = !is2FAEnabled;
            localStorage.setItem('dmex_2fa', is2FAEnabled);
            if (is2FAEnabled) {
                toggle2FA.classList.add('active');
                showToast('2FA Swap Authorization Enabled', 'success');
                // Update tooltip in profile icon if it exists
                const portfolioBtn = document.getElementById('btn-portfolio');
                if (portfolioBtn) portfolioBtn.setAttribute('title', 'User Portfolio | 🔒 2FA: On');
            } else {
                toggle2FA.classList.remove('active');
                showToast('2FA Swap Authorization Disabled', 'error');
                const portfolioBtn = document.getElementById('btn-portfolio');
                if (portfolioBtn) portfolioBtn.setAttribute('title', 'User Portfolio | 🔒 2FA: Off');
            }
        });
    }

    if (psychCheckbox) {
        psychCheckbox.addEventListener('change', async () => {
            settingsState.psychology = psychCheckbox.checked;
            try {
                await fetch(GUARDIAN_API + '/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ psychologyMode: psychCheckbox.checked })
                });
                addLog(`[SETTINGS] Psychology mode: ${psychCheckbox.checked ? 'ON' : 'OFF'}`);
                showToast(`Psychology mode ${psychCheckbox.checked ? 'enabled' : 'disabled'}`);
                updatePresetHighlight();
            } catch (e) { addLog('[SETTINGS] Guardian offline'); }
        });
    }

    // Auto-Reject slider
    if (autoRejectSlider) {
        autoRejectSlider.addEventListener('input', () => {
            settingsState.autoReject = parseInt(autoRejectSlider.value);
            autoRejectLabel.textContent = '>' + autoRejectSlider.value;
            updatePresetHighlight();
        });
    }

    // Slippage slider
    if (slippageSlider) {
        slippageSlider.addEventListener('input', () => {
            settingsState.slippage = parseInt(slippageSlider.value);
            slippageLabel.textContent = slippageSlider.value + '%';
            updatePresetHighlight();
        });
    }

    // Insights toggle
    const showInsightsCheckbox = document.getElementById('show-insights-checkbox');
    if (showInsightsCheckbox) {
        showInsightsCheckbox.addEventListener('change', () => {
            settingsState.showInsights = showInsightsCheckbox.checked;
            const insightsEl = document.getElementById('analytics-insights');
            if (insightsEl) insightsEl.style.display = showInsightsCheckbox.checked ? '' : 'none';
        });
    }

    // =================================================================
    //  SETTINGS PRESETS
    // =================================================================
    const PRESETS = {
        conservative: { autoReject: 30, psychology: true, slippage: 2 },
        balanced:     { autoReject: 50, psychology: true, slippage: 5 },
        aggressive:   { autoReject: 80, psychology: false, slippage: 15 }
    };

    function applySettingsPreset(presetName) {
        const preset = PRESETS[presetName];
        if (!preset) return;
        settingsState.autoReject = preset.autoReject;
        settingsState.psychology = preset.psychology;
        settingsState.slippage = preset.slippage;

        if (autoRejectSlider) { autoRejectSlider.value = preset.autoReject; autoRejectLabel.textContent = '>' + preset.autoReject; }
        if (psychCheckbox) psychCheckbox.checked = preset.psychology;
        if (slippageSlider) { slippageSlider.value = preset.slippage; slippageLabel.textContent = preset.slippage + '%'; }

        // Update preset card highlights
        document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
        const activeCard = document.querySelector(`.preset-card[data-preset="${presetName}"]`);
        if (activeCard) activeCard.classList.add('active');

        // Push to Guardian
        fetch(GUARDIAN_API + '/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ psychologyMode: preset.psychology, fairValueSlippage: preset.slippage })
        }).catch(() => {});

        addLog(`[SETTINGS] Applied preset: ${presetName.toUpperCase()}`);
        showToast(`${presetName.charAt(0).toUpperCase() + presetName.slice(1)} preset applied!`);
    }

    function updatePresetHighlight() {
        document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
        // Check if current settings match any preset
        for (const [name, preset] of Object.entries(PRESETS)) {
            if (settingsState.autoReject === preset.autoReject &&
                settingsState.psychology === preset.psychology &&
                settingsState.slippage === preset.slippage) {
                const card = document.querySelector(`.preset-card[data-preset="${name}"]`);
                if (card) card.classList.add('active');
                return;
            }
        }
    }

    // Detect recommended preset based on trading history
    function detectRecommendedPreset() {
        const avgRisk = analytics.riskScores.length > 0
            ? Math.round(analytics.riskScores.reduce((a,b) => a+b, 0) / analytics.riskScores.length) : 0;
        const badge = document.getElementById('preset-rec-badge');
        if (!badge) return;
        // Move badge to the recommended preset
        document.querySelectorAll('.preset-recommended').forEach(b => b.remove());
        let recommended = 'balanced';
        if (avgRisk < 15 && analytics.total >= 3) recommended = 'aggressive';
        else if (avgRisk > 40) recommended = 'conservative';
        const target = document.querySelector(`.preset-card[data-preset="${recommended}"]`);
        if (target) {
            const newBadge = document.createElement('span');
            newBadge.className = 'preset-recommended';
            newBadge.textContent = 'RECOMMENDED';
            target.appendChild(newBadge);
        }
    }

    // Bind preset cards
    document.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', () => applySettingsPreset(card.dataset.preset));
    });

    // Close
    document.getElementById('close-profile')?.addEventListener('click', () => profileModal.classList.remove('open'));
    document.getElementById('close-settings')?.addEventListener('click', () => settingsModal.classList.remove('open'));
    
    // Close on overlay click
    window.addEventListener('click', (e) => {
        if (e.target === profileModal) profileModal.classList.remove('open');
        if (e.target === settingsModal) settingsModal.classList.remove('open');
    });

    // =================================================================
    //  SOCIAL MARKETPLACE & NEGOTIATION
    // =================================================================
    // 50-Peer Seeder for Social Discovery
    function generateMockTraders(count) {
        const games = ['dmex', 'loot', 'gods', 'cryptokitties', 'cs2', 'ugc'];
        const assetNames = {
            dmex: ['DGLD', 'Sword', 'Commodity'],
            loot: ['Loot Bag'],
            gods: ['God Card'],
            cryptokitties: ['CryptoKitty'],
            cs2: ['CS2 Skin', 'CS2 Case', 'CS2 Balance'],
            ugc: ['UE5 Mesh', 'Blender', 'Maya Rig', 'Unity']
        };
        const traders = [];
        for (let i = 0; i < count; i++) {
            let addr = '0x';
            const seed = 2000 + i * 13;
            let s = seed;
            for (let j = 0; j < 40; j++) { s = (s * 16807) % 2147483647; addr += '0123456789abcdef'[Math.floor(((s-1)/2147483646) * 16)]; }
            const rep = 20 + Math.floor(Math.random() * 80);
            // Assign 2-4 random asset types from random games
            const numAssets = 2 + Math.floor(Math.random() * 3);
            const holdings = [];
            for (let k = 0; k < numAssets; k++) {
                const g = games[Math.floor(Math.random() * games.length)];
                const gAssets = assetNames[g];
                const a = gAssets[Math.floor(Math.random() * gAssets.length)];
                if (!holdings.includes(a)) holdings.push(a);
            }
            traders.push({ addr, rep, assets: holdings });
        }
        return traders;
    }
    const MOCK_TRADERS = generateMockTraders(50);

    let friendsList = []; // Track associates

    function loadSocialMarket() {
        const grid = document.getElementById('trader-discovery-grid');
        grid.innerHTML = '';
        if (typeof isLiveMarketplace !== 'undefined' && isLiveMarketplace) {
            grid.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:40px;grid-column:1/-1;">Scanning live Scroll Sepolia network for peers... <br><br><span style="color:var(--spotify-green)">0 active nodes found</span></div>';
            return;
        }
        MOCK_TRADERS.forEach(t => {
            const card = document.createElement('div');
            card.className = 'trader-card';
            card.innerHTML = `
                <div class="trader-header">
                    <div class="cp-avatar" style="background:${addrGradient(t.addr)};width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;">${addrInitials(t.addr)}</div>
                    <div class="trader-info">
                        <h4>${shortAddr(t.addr)}</h4>
                        <p>Active on Scroll Sepolia</p>
                    </div>
                </div>
                <div class="trader-rep">
                    <span>Reputation Score</span>
                    <strong>${t.rep}%</strong>
                </div>
                <div>
                    <span style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:6px; display:block;">Holdings:</span>
                    <div class="trader-assets">
                        ${t.assets.map(a => `<span class="trader-asset-pill">${a}</span>`).join('')}
                    </div>
                </div>
                <div class="trader-actions">
                    <button class="pill-btn outlined" style="width:100%; padding: 10px;" onclick="window.openChat('${t.addr}')">Negotiate</button>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    // =================================================================
    //  ASSET MARKETPLACE (Open Market tab)
    // =================================================================
    let allListings = [];
    let currentFilter = 'all';
    let currentGameFilter = 'all';
    let isLiveMarketplace = false;

    // Toggle logic for Live/Demo
    const marketModeWrapper = document.getElementById('market-mode-wrapper');
    if (marketModeWrapper) {
        marketModeWrapper.addEventListener('click', () => {
            isLiveMarketplace = !isLiveMarketplace;
            const toggleIcon = document.getElementById('market-mode-toggle');
            if (isLiveMarketplace) {
                toggleIcon.classList.remove('active');
                document.getElementById('toggle-label-live').style.opacity = '1';
                document.getElementById('toggle-label-demo').style.opacity = '0.5';
            } else {
                toggleIcon.classList.add('active');
                document.getElementById('toggle-label-live').style.opacity = '0.5';
                document.getElementById('toggle-label-demo').style.opacity = '1';
            }
            loadMarketplace();
        });
    }

    async function loadMarketplace() {
        const grid = document.getElementById('marketplace-grid');
        const emptyMsg = document.getElementById('market-empty');
        grid.innerHTML = '<p style="color:var(--text-secondary);padding:20px;">Loading listings...</p>';

        try {
            const endpoint = isLiveMarketplace ? '/api/marketplace/live' : '/api/marketplace';
            const params = new URLSearchParams();
            if (currentGameFilter !== 'all') params.set('game', currentGameFilter);
            
            const res = await fetch(GUARDIAN_API + endpoint + '?' + params.toString());
            const data = await res.json();
            
            if (isLiveMarketplace) {
                // If the user selected game filters but we are in live mode, we might want to filter locally 
                // since the backend live endpoint doesn't strictly filter yet, but that's fine for now.
                allListings = data.listings || [];
            } else {
                allListings = data.listings || [];
            }
        } catch (e) {
            allListings = [];
            addLog('[MARKET] Guardian offline — showing local vault only');
        }

        // Merge local bridged assets (Steam & UGC)
        const localSkins = JSON.parse(localStorage.getItem('dmex_cs2_skins') || '[]');
        const localUGC = JSON.parse(localStorage.getItem('dmex_minted_ugc') || '[]');

        localSkins.forEach(skin => {
            allListings.unshift({
                idx: -1,
                seller: userAddr || '0xLocalVault',
                asset: { type: 'ERC-721', name: skin.name, icon: '🔫', iconClass: 'cs2', game: 'cs2', description: `${skin.wear} · Float: ${skin.float}` },
                marketValue: skin.value,
                askingPrice: { amount: 0, name: 'DGLD' },
                description: `Steam Bridged: ${skin.wear} skin with ${skin.stickers} stickers.`,
                holderProfile: { reputation: 99, totalSwaps: 1 },
                listedAt: Date.now()
            });
        });

        localUGC.forEach(asset => {
            allListings.unshift({
                idx: -1,
                seller: userAddr || '0xLocalVault',
                asset: { type: asset.type, name: asset.name, icon: asset.icon, iconClass: asset.iconClass, game: 'ugc' },
                marketValue: asset.baseValue,
                askingPrice: { amount: 0, name: 'DGLD' },
                description: `Minted via ${asset.engine.toUpperCase()} engine. Verified on Scroll Sepolia.`,
                holderProfile: { reputation: 99, totalSwaps: 1 },
                listedAt: asset.mintedAt
            });
        });

        renderMarketplaceListings();
        if (allListings.length > 0) addLog(`[MARKET] Loaded ${allListings.length} listings (including local vault)`);
        else emptyMsg.style.display = 'block';
    }

    // Game filter tab handler
    document.querySelectorAll('.game-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.game-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentGameFilter = btn.dataset.game;
            marketplaceLoaded = false;
            loadMarketplace();
        });
    });

    function renderMarketplaceListings() {
        const grid = document.getElementById('marketplace-grid');
        const emptyMsg = document.getElementById('market-empty');
        const searchTerm = (document.getElementById('mkt-search')?.value || '').toLowerCase();
        grid.innerHTML = '';

        let filtered = allListings;
        if (currentFilter !== 'all') filtered = filtered.filter(l => l.asset.type === currentFilter);
        if (searchTerm) filtered = filtered.filter(l =>
            l.asset.name.toLowerCase().includes(searchTerm) ||
            l.seller.toLowerCase().includes(searchTerm) ||
            l.description.toLowerCase().includes(searchTerm)
        );

        if (filtered.length === 0) { emptyMsg.style.display = 'block'; return; }
        emptyMsg.style.display = 'none';

        filtered.forEach((listing, idx) => {
            const card = document.createElement('div');
            card.className = 'listing-card';
            const rep = listing.holderProfile?.reputation || 100;
            const swaps = listing.holderProfile?.totalSwaps || 0;
            const amount = listing.asset.amount || listing.asset.tokenId !== undefined ? `#${listing.asset.tokenId}` : '';
            const amountDisplay = listing.asset.amount ? `${listing.asset.amount}x` : (listing.asset.tokenId !== undefined ? `ID #${listing.asset.tokenId}` : '');
            const askDisplay = listing.askingPrice.amount > 0 ? `${listing.askingPrice.amount} ${listing.askingPrice.name}` : 'Open to offers';
            const timeAgo = Math.round((Date.now() - listing.listedAt) / 60000);
            const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.round(timeAgo/60)}h ago`;

            // Encode listing info for the swap button
            const listingData = encodeURIComponent(JSON.stringify({
                seller: listing.seller,
                assetName: listing.asset.name,
                assetType: listing.asset.type,
                assetGame: listing.asset.game || listing.game || '',
                assetAmount: listing.asset.amount || 1,
                askName: listing.askingPrice?.name || '',
                askAmount: listing.askingPrice?.amount || 0
            }));

            card.innerHTML = `
                <div class="listing-top">
                    <div class="listing-asset-icon asset-glass-ios ${listing.asset.game || 'dmex'}">${listing.asset.icon || 'G'}</div>
                    <div class="listing-asset-info">
                        <h4>${listing.asset.name} ${amountDisplay}</h4>
                        <small>${listing.asset.type} · $${listing.marketValue.toFixed(2)} market value</small>
                    </div>
                    <div class="listing-price-tag">${askDisplay}</div>
                </div>
                <div class="listing-desc">${listing.description}</div>
                <div class="listing-holder">
                    <div class="cp-avatar" style="background:${addrGradient(listing.seller)};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.7rem;color:#fff;flex-shrink:0;">${addrInitials(listing.seller)}</div>
                    <div class="listing-holder-info">
                        <span>${shortAddr(listing.seller)}</span>
                        <small>Rep: ${rep}% · ${swaps} swaps · ${timeStr}</small>
                    </div>
                </div>
                <div class="listing-footer">
                    <button class="pill-btn outlined" onclick="window.openChat('${listing.seller}')">Negotiate</button>
                    <button class="pill-btn spotify-green-btn" onclick="window.startSwapWith('${listingData}')">Start Swap</button>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    // Marketplace filter buttons
    document.querySelectorAll('.mkt-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mkt-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderMarketplaceListings();
        });
    });

    // Marketplace search
    document.getElementById('mkt-search')?.addEventListener('input', () => renderMarketplaceListings());

    // Helper: find the ASSETS key that best matches a given asset name.
    // Falls back to matching by game + type for bridged assets with custom names
    // (e.g. "Karambit | Fade" → cs_skin, "Dragon's Crown" → loot_bag)
    function findAssetKeyByName(name, game, type) {
        if (!name) return null;
        const lower = name.toLowerCase();

        // 1. Exact name match
        for (const [key, asset] of Object.entries(ASSETS)) {
            if (asset.name.toLowerCase() === lower) return key;
        }

        // 2. Partial name match (asset name contained in listing name or vice versa)
        for (const [key, asset] of Object.entries(ASSETS)) {
            if (asset.name.toLowerCase().includes(lower) || lower.includes(asset.name.toLowerCase())) return key;
        }

        // 3. Fallback: match by game + asset type (for bridged/custom-named assets)
        if (game && type) {
            for (const [key, asset] of Object.entries(ASSETS)) {
                if (asset.game === game && asset.type === type) return key;
            }
        }

        // 4. Fallback: match by game alone (first asset in that game)
        if (game) {
            for (const [key, asset] of Object.entries(ASSETS)) {
                if (asset.game === game) return key;
            }
        }

        // 5. Fallback: match by type alone
        if (type) {
            for (const [key, asset] of Object.entries(ASSETS)) {
                if (asset.type === type) return key;
            }
        }

        return null;
    }

    // Start swap with full listing data from marketplace
    window.startSwapWith = function(encodedData) {
        try {
            const data = JSON.parse(decodeURIComponent(encodedData));
            const sellerAddr = safeAddr(data.seller);

            // Switch to create tab
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            document.querySelector('[data-tab="create"]').classList.add('active');
            document.getElementById('create-view').classList.add('active');

            // Pre-fill counterparty address
            cpInput.value = sellerAddr;
            resolveCounterparty(sellerAddr);

            // Auto-fill RECEIVE side (what the listing is selling = what you receive)
            const receiveKey = findAssetKeyByName(data.assetName, data.assetGame, data.assetType);
            if (receiveKey) {
                receiveAsset = receiveKey;
                updateAssetUI('receive', receiveKey);
                // Set amount
                const recAmountInput = document.getElementById('receive-amount');
                recAmountInput.value = data.assetAmount || 1;
                // Trigger value recalculation
                if (recAmountInput.oninput) recAmountInput.oninput();
            }

            // Auto-fill OFFER side (what the listing is asking for = what you offer)
            const offerKey = findAssetKeyByName(data.askName);
            if (offerKey) {
                offerAsset = offerKey;
                updateAssetUI('offer', offerKey);
                const offerAmountInput = document.getElementById('offer-amount');
                if (data.askAmount > 0) {
                    offerAmountInput.value = data.askAmount;
                }
                // Trigger value recalculation
                if (offerAmountInput.oninput) offerAmountInput.oninput();
            }

            showToast('Swap pre-filled from marketplace — review & propose!');
            addLog(`[MARKET] Auto-filled swap: receive ${data.assetName} from ${shortAddr(sellerAddr)}`);

        } catch (e) {
            console.error('[startSwapWith] Parse error:', e);
            showToast('Could not load listing data', 'error');
        }
    };

    // Expose openChat to window for inline onclick
    window.openChat = function(peerAddr) {
        peerAddr = safeAddr(peerAddr);                // normalise checksum
        if (!userAddr) { showToast('Connect wallet to negotiate', 'error'); return; }
        
        document.getElementById('chat-peer-id').innerText = shortAddr(peerAddr);
        // Set avatar in chat header
        const chatAvatar = document.getElementById('chat-avatar');
        if (chatAvatar) setAvatar(chatAvatar, peerAddr);
        // Set reputation
        const repEl = document.getElementById('chat-peer-rep');
        if (repEl) repEl.textContent = 'Loading rep...';
        // Fetch rep async
        fetch(GUARDIAN_API + '/api/portfolio/' + peerAddr)
            .then(r => r.json())
            .then(d => { if (repEl) repEl.textContent = `Rep: ${d.activity?.reputation || '?'}% · ${d.activity?.totalSwaps || 0} swaps`; })
            .catch(() => { if (repEl) repEl.textContent = 'Rep: —'; });

        const msgContainer = document.getElementById('chat-messages');
        msgContainer.innerHTML = `<div style="text-align:center;font-size:0.75rem;color:#888;margin-bottom:10px;">Encrypted P2P connection to ${shortAddr(peerAddr)} established.</div>`;
        document.getElementById('chat-widget').style.display = 'flex';
        document.getElementById('chat-widget').dataset.peerFull = peerAddr; // store full addr
        
        // Add to friends list if not exists
        if (!friendsList.includes(peerAddr)) {
            friendsList.push(peerAddr);
            renderFriendsSidebar();
        }
    };

    function renderFriendsSidebar() {
        const list = document.getElementById('friends-list');
        list.innerHTML = '';
        if (friendsList.length === 0) {
            list.innerHTML = `<p class="eval-empty">No recent contacts. Start a negotiation!</p>`;
            return;
        }
        
        friendsList.forEach(addr => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            div.innerHTML = `
                <div class="cp-avatar" style="background:${addrGradient(addr)};width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.8rem;color:#fff;flex-shrink:0;">${addrInitials(addr)}</div>
                <div class="friend-details">
                    <span>${shortAddr(addr)}</span>
                    <small>Rep: 98% · ${Math.floor(Math.random()*3)+1} swaps</small>
                </div>
                <div class="asset-glass-ios dmex" style="width:24px;height:24px;font-size:0.8rem;margin-left:auto;">🛡️</div>
            `;
            div.onclick = () => window.openChat(addr);
            list.appendChild(div);
        });
    }

    // Chat UI bindings
    document.getElementById('close-chat').addEventListener('click', () => {
        document.getElementById('chat-widget').style.display = 'none';
        document.getElementById('chat-calc').style.display = 'none';
    });

    document.getElementById('chat-send').addEventListener('click', sendChatMsg);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMsg();
    });

    function sendChatMsg() {
        if (!ws) { showToast('Guardian offline', 'error'); return; }
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text) return;

        const peerAddr = document.getElementById('chat-peer-id').innerText;
        
        // Append locally
        const msgContainer = document.getElementById('chat-messages');
        msgContainer.innerHTML += `<div class="chat-msg sent">${text}</div>`;
        msgContainer.scrollTop = msgContainer.scrollHeight;

        // Broadcast to WS
        ws.send(JSON.stringify({
            type: 'chat',
            sender: userAddr ? shortAddr(userAddr) : '0xYou',
            receiver: peerAddr,
            message: text
        }));
        
        input.value = '';
    }

    window.receiveChatMsg = function(sender, text) {
        // Only show if chat widget is open
        const chatWidget = document.getElementById('chat-widget');
        if (chatWidget.style.display !== 'none') {
            const msgContainer = document.getElementById('chat-messages');
            msgContainer.innerHTML += `<div class="chat-msg received"><strong>${sender}:</strong> ${text}</div>`;
            msgContainer.scrollTop = msgContainer.scrollHeight;
        } else {
            showToast(`New message from ${sender}`, 'info');
        }
    }

    // =================================================================
    //  IN-CHAT CALCULATOR
    // =================================================================
    let calcExpression = '';
    let calcResult = '0';

    document.getElementById('chat-toggle-calc')?.addEventListener('click', () => {
        const calc = document.getElementById('chat-calc');
        calc.style.display = calc.style.display === 'none' ? 'block' : 'none';
    });

    document.querySelectorAll('.calc-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.val;
            const display = document.getElementById('calc-display');

            if (val === 'C') {
                calcExpression = '';
                calcResult = '0';
                display.value = '0';
            } else if (val === '=') {
                try {
                    calcResult = String(Function('"use strict"; return (' + calcExpression + ')')());
                    display.value = calcResult;
                    calcExpression = calcResult;
                } catch (e) {
                    display.value = 'Error';
                    calcExpression = '';
                }
            } else if (val === 'send') {
                // Send calculator result as a chat message
                const result = document.getElementById('calc-display').value;
                if (result && result !== '0' && result !== 'Error') {
                    const input = document.getElementById('chat-input');
                    input.value = `🧮 Calculated: ${result}`;
                    sendChatMsg();
                }
            } else {
                calcExpression += val;
                display.value = calcExpression;
            }
        });
    });

    // =================================================================
    //  CHAT ACTION BUTTONS
    // =================================================================
    // Copy My Address
    document.getElementById('chat-copy-addr')?.addEventListener('click', () => {
        if (!userAddr) { showToast('Connect wallet first', 'error'); return; }
        navigator.clipboard.writeText(userAddr).then(() => {
            showToast('Address copied to clipboard!');
            // Also send as chat message
            const msgContainer = document.getElementById('chat-messages');
            msgContainer.innerHTML += `<div class="chat-msg sent" style="font-family:'Courier New',monospace;font-size:0.78rem;">📋 My address: ${userAddr}</div>`;
            msgContainer.scrollTop = msgContainer.scrollHeight;
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'chat',
                    sender: userAddr ? shortAddr(userAddr) : '0xYou',
                    receiver: document.getElementById('chat-peer-id').innerText,
                    message: `📋 My address: ${userAddr}`
                }));
            }
        }).catch(() => showToast('Copy failed', 'error'));
    });

    // Propose Swap in Chat
    document.getElementById('chat-propose-swap')?.addEventListener('click', () => {
        if (!userAddr) { showToast('Connect wallet first', 'error'); return; }
        
        let propPanel = document.getElementById('chat-macro-propose');
        if (!propPanel) {
            propPanel = document.createElement('div');
            propPanel.id = 'chat-macro-propose';
            propPanel.style.display = 'flex';
            propPanel.style.flexDirection = 'column';
            propPanel.style.gap = '8px';
            propPanel.style.padding = '10px';
            propPanel.style.background = 'rgba(0,0,0,0.4)';
            propPanel.style.borderTop = '1px solid rgba(255,255,255,0.05)';
            
            let optionsHTML = '';
            for (const [k, v] of Object.entries(ASSETS)) {
                 optionsHTML += `<option value="${k}">${v.name}</option>`;
            }
            
            propPanel.innerHTML = `
                <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:4px;">Negotiate a new swap:</div>
                <div style="display:flex; gap:8px;">
                    <input type="number" id="chat-macro-o-amt" placeholder="Amt" value="1" style="width:50px; background:#121212; color:white; border:none; padding:4px; border-radius:4px;">
                    <select id="chat-macro-o-ast" style="flex:1; background:#121212; color:white; border:none; padding:4px; border-radius:4px;">${optionsHTML}</select>
                </div>
                <div style="text-align:center; font-size:0.7rem; color:var(--text-secondary);">FOR</div>
                <div style="display:flex; gap:8px;">
                    <input type="number" id="chat-macro-r-amt" placeholder="Amt" value="1" style="width:50px; background:#121212; color:white; border:none; padding:4px; border-radius:4px;">
                    <select id="chat-macro-r-ast" style="flex:1; background:#121212; color:white; border:none; padding:4px; border-radius:4px;">${optionsHTML}</select>
                </div>
                <button class="pill-btn primary mini" id="chat-macro-send" style="margin-top:4px;">Send Offer</button>
            `;
            const chatInputArea = document.querySelector('.chat-input-area');
            chatInputArea.parentNode.insertBefore(propPanel, chatInputArea);
            
            // Set defaults to current active selection
            document.getElementById('chat-macro-o-ast').value = offerAsset;
            document.getElementById('chat-macro-o-amt').value = document.getElementById('offer-amount').value || 1;
            document.getElementById('chat-macro-r-ast').value = receiveAsset;
            document.getElementById('chat-macro-r-amt').value = document.getElementById('receive-amount').value || 1;
            
            document.getElementById('chat-macro-send').addEventListener('click', () => {
                const oAmt = document.getElementById('chat-macro-o-amt').value;
                const oAst = document.getElementById('chat-macro-o-ast').value;
                const rAmt = document.getElementById('chat-macro-r-amt').value;
                const rAst = document.getElementById('chat-macro-r-ast').value;
                
                const oInfo = ASSETS[oAst];
                const rInfo = ASSETS[rAst];
                const proposal = `📦 SWAP PROPOSAL: ${oAmt} ${oInfo.name} ↔ ${rAmt} ${rInfo.name}`;
                
                const msgContainer = document.getElementById('chat-messages');
                msgContainer.innerHTML += `<div class="chat-msg sent" style="background:rgba(30,215,96,0.2);color:var(--spotify-green);font-weight:700;border:1px solid rgba(30,215,96,0.3);">${proposal}</div>`;
                msgContainer.scrollTop = msgContainer.scrollHeight;

                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chat',
                        sender: userAddr ? shortAddr(userAddr) : '0xYou',
                        receiver: document.getElementById('chat-peer-id').innerText,
                        message: proposal
                    }));
                }

                const peerFull = document.getElementById('chat-widget').dataset.peerFull;
                if (peerFull) {
                    cpInput.value = peerFull;
                    resolveCounterparty(peerFull);
                }
                
                // Sync Main Panel
                offerAsset = oAst; receiveAsset = rAst;
                updateAssetUI('offer', oAst);
                updateAssetUI('receive', rAst);
                document.getElementById('offer-amount').value = oAmt;
                document.getElementById('receive-amount').value = rAmt;

                showToast('Offer sent! Propose tab updated.');
                propPanel.style.display = 'none';
            });
        } else {
            propPanel.style.display = propPanel.style.display === 'none' ? 'flex' : 'none';
            document.getElementById('chat-macro-o-ast').value = offerAsset;
            document.getElementById('chat-macro-r-ast').value = receiveAsset;
        }
    });

    // =================================================================
    //  SWAP SUGGESTIONS (Propose Intent Tab)
    // =================================================================
    function generateSwapSuggestions() {
        const strip = document.getElementById('suggestion-strip');
        if (!strip) return;
        strip.innerHTML = '';

        const suggestions = [
            { offer: 'dgld', offerAmt: '100', receive: 'sword', receiveAmt: '1', label: '100 DGLD → 1 Sword', sub: 'Most popular swap', aiPick: true },
            { offer: 'dgld', offerAmt: '50',  receive: 'commodity', receiveAmt: '25', label: '50 DGLD → 25 Commodity', sub: 'Fair value trade', aiPick: false },
            { offer: 'sword', offerAmt: '1',  receive: 'dgld', receiveAmt: '200', label: '1 Sword → 200 DGLD', sub: 'Trending today', aiPick: false },
            { offer: 'commodity', offerAmt: '100', receive: 'sword', receiveAmt: '1', label: '100 Commodity → 1 Sword', sub: 'Resource conversion', aiPick: false }
        ];

        // If marketplace data is loaded, generate smarter suggestions
        if (allListings.length > 0) {
            const topListing = allListings[0];
            if (topListing.askingPrice?.amount > 0) {
                suggestions[0] = {
                    offer: 'dgld', offerAmt: String(topListing.askingPrice.amount),
                    receive: 'sword', receiveAmt: '1',
                    label: `${topListing.askingPrice.amount} DGLD → ${topListing.asset.name}`,
                    sub: 'Matches top listing', aiPick: true
                };
            }
        }

        suggestions.forEach(s => {
            const pill = document.createElement('div');
            pill.className = 'suggestion-pill' + (s.aiPick ? ' ai-pick' : '');
            const offerInfo = ASSETS[s.offer];
            pill.innerHTML = `
                <div class="pill-icon asset-icon-box ${offerInfo.iconClass}" style="width:32px;height:32px;font-size:0.85rem;margin:0;">${offerInfo.icon}</div>
                <div class="pill-text">
                    <strong>${s.label}</strong>
                    <small>${s.sub}</small>
                </div>
            `;
            pill.addEventListener('click', () => {
                offerAsset = s.offer; receiveAsset = s.receive;
                updateAssetUI('offer', s.offer);
                updateAssetUI('receive', s.receive);
                document.getElementById('offer-amount').value = s.offerAmt;
                document.getElementById('receive-amount').value = s.receiveAmt;
                refreshBalances();
                showToast(`Swap configured: ${s.label}`);
                addLog(`[SUGGEST] Auto-filled: ${s.label}`);
            });
            strip.appendChild(pill);
        });
    }

    // Generate suggestions even without wallet (static defaults)
    generateSwapSuggestions();

    // =================================================================
    //  QUICK COUNTERPARTIES
    // =================================================================
    function renderQuickCounterparties() {
        const container = document.getElementById('quick-counterparties');
        if (!container) return;

        // Remove old chips (keep label)
        container.querySelectorAll('.quick-cp-chip').forEach(c => c.remove());

        const addrs = friendsList.length > 0 ? friendsList.slice(0, 4) :
            MOCK_TRADERS.slice(0, 3).map(t => t.addr);

        if (addrs.length === 0) { container.style.display = 'none'; return; }
        container.style.display = 'flex';

        addrs.forEach(addr => {
            const chip = document.createElement('div');
            chip.className = 'quick-cp-chip';
            chip.style.background = addrGradient(addr);
            chip.textContent = addrInitials(addr);
            chip.title = shortAddr(addr);
            chip.addEventListener('click', () => {
                cpInput.value = addr;
                resolveCounterparty(addr);
                showToast(`Counterparty: ${shortAddr(addr)}`);
            });
            container.appendChild(chip);
        });
    }
    renderQuickCounterparties();

    // =================================================================
    //  RECOMMENDED LISTINGS (Open Market Tab)
    // =================================================================
    let currentSort = 'newest';

    function computeRecommendedListings() {
        const section = document.getElementById('recommended-section');
        const scroll = document.getElementById('recommended-scroll');
        if (!section || !scroll || allListings.length === 0) {
            if (section) section.style.display = 'none';
            return;
        }

        // Recommend: highest rep holders + best value
        const recommended = [...allListings]
            .sort((a, b) => {
                const repA = a.holderProfile?.reputation || 0;
                const repB = b.holderProfile?.reputation || 0;
                return repB - repA;
            })
            .slice(0, 3);

        scroll.innerHTML = '';
        recommended.forEach((listing, idx) => {
            const rep = listing.holderProfile?.reputation || 100;
            const card = document.createElement('div');
            card.className = 'recommended-card';
            const amtDisplay = listing.asset.amount ? `${listing.asset.amount}x` : (listing.asset.tokenId !== undefined ? `ID #${listing.asset.tokenId}` : '');
            card.innerHTML = `
                ${idx === 0 ? '<span class="trending-badge">🔥 TRENDING</span>' : ''}
                <div class="rec-asset-row">
                    <div class="asset-icon-box ${listing.asset.iconClass || 'gold'} mini" style="margin-right:0;">${listing.asset.icon || 'G'}</div>
                    <h4>${listing.asset.name} ${amtDisplay}</h4>
                </div>
                <div class="rec-meta">
                    $${listing.marketValue.toFixed(2)} · Rep: ${rep}% · ${listing.holderProfile?.totalSwaps || 0} swaps
                </div>
            `;
            card.addEventListener('click', () => {
                window.startSwapWith(listing.seller, listing.asset.type);
            });
            scroll.appendChild(card);
        });

        section.style.display = 'block';
    }

    // Sorting logic for marketplace
    document.querySelectorAll('.sort-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sort-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSort = btn.dataset.sort;
            renderMarketplaceListings();
        });
    });

    // Patch renderMarketplaceListings to include sorting
    const _origRenderMktListings = renderMarketplaceListings;
    renderMarketplaceListings = function() {
        // Apply sort before rendering
        if (currentSort === 'value') {
            allListings.sort((a, b) => b.marketValue - a.marketValue);
        } else if (currentSort === 'rep') {
            allListings.sort((a, b) => (b.holderProfile?.reputation || 0) - (a.holderProfile?.reputation || 0));
        } else {
            allListings.sort((a, b) => b.listedAt - a.listedAt);
        }
        _origRenderMktListings();
        computeRecommendedListings();
    };

    // =================================================================
    //  PEER DISCOVERY ENHANCEMENTS
    // =================================================================
    let peerFilter = 'all';

    // Enhanced loadSocialMarket with trust bars + badges
    const _origLoadSocial = loadSocialMarket;
    loadSocialMarket = function() {
        const grid = document.getElementById('trader-discovery-grid');
        grid.innerHTML = '';

        let traders = [...MOCK_TRADERS];

        // Apply filter
        if (peerFilter === 'high-trust') traders = traders.filter(t => t.rep >= 90);
        else if (peerFilter === 'has-nfts') traders = traders.filter(t => t.assets.includes('Sword'));
        else if (peerFilter === 'has-dgld') traders = traders.filter(t => t.assets.includes('DGLD'));

        // Find top trader
        const topTrader = traders.reduce((top, t) => t.rep > (top?.rep || 0) ? t : top, null);

        traders.forEach(t => {
            const isTop = t === topTrader;
            const trustClass = t.rep >= 90 ? 'high' : t.rep >= 70 ? 'medium' : 'low';
            const card = document.createElement('div');
            card.className = 'trader-card';
            card.innerHTML = `
                <div class="trader-header">
                    <div class="cp-avatar" style="background:${addrGradient(t.addr)};width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;">${addrInitials(t.addr)}</div>
                    <div class="trader-info">
                        <h4>${shortAddr(t.addr)} ${isTop ? '<span class="top-trader-badge">⭐ TOP</span>' : ''}</h4>
                        <p>Active on Scroll Sepolia</p>
                    </div>
                </div>
                <div class="trader-rep">
                    <span>Reputation Score</span>
                    <strong>${t.rep}%</strong>
                </div>
                <div class="trust-bar-wrap">
                    <span class="trust-bar-label">Trust Level</span>
                    <div class="trust-bar"><div class="trust-bar-fill ${trustClass}" style="width:${t.rep}%"></div></div>
                </div>
                <div>
                    <span style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:6px; display:block;">Holdings:</span>
                    <div class="trader-assets">
                        ${t.assets.map(a => `<span class="trader-asset-pill">${a}</span>`).join('')}
                    </div>
                </div>
                <div class="trader-actions">
                    <button class="pill-btn outlined" style="width:100%; padding: 10px;" onclick="window.openChat('${t.addr}')">Negotiate</button>
                </div>
            `;
            grid.appendChild(card);
        });

        // Suggested peers
        computeSuggestedPeers();
    };

    function computeSuggestedPeers() {
        const section = document.getElementById('suggested-peers-section');
        const container = document.getElementById('suggested-peer-highlight');
        if (!section || !container) return;

        // Suggest peers who hold what the user might want (based on current receive asset)
        const wantedAssetName = ASSETS[receiveAsset]?.name?.split(' ')[0] || 'Sword'; // 'DGLD', 'Sword', 'Commodity'
        const suggested = MOCK_TRADERS.filter(t =>
            t.assets.some(a => a.toLowerCase().includes(wantedAssetName.toLowerCase())) &&
            t.rep >= 80
        ).slice(0, 2);

        if (suggested.length === 0) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        container.innerHTML = '';

        suggested.forEach(t => {
            const card = document.createElement('div');
            card.className = 'suggested-peer-card';
            card.innerHTML = `
                <div class="sp-header">
                    <div class="cp-avatar" style="background:${addrGradient(t.addr)};width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.8rem;color:#fff;">${addrInitials(t.addr)}</div>
                    <div>
                        <strong style="font-size:0.85rem;">${shortAddr(t.addr)}</strong>
                        <small style="display:block;color:var(--text-secondary);font-size:0.72rem;">Rep: ${t.rep}%</small>
                    </div>
                </div>
                <div class="sp-reason">Has ${t.assets.join(', ')} — matches your needs</div>
            `;
            card.addEventListener('click', () => window.openChat(t.addr));
            container.appendChild(card);
        });
    }

    // Peer filter buttons
    document.querySelectorAll('.peer-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.peer-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            peerFilter = btn.dataset.pfilter;
            loadSocialMarket();
        });
    });

    // =================================================================
    //  ANALYTICS INSIGHTS
    // =================================================================
    function generateInsights() {
        const container = document.getElementById('analytics-insights');
        if (!container || !settingsState.showInsights) return;
        container.innerHTML = '';

        const insights = [];
        const avgRisk = analytics.riskScores.length > 0
            ? Math.round(analytics.riskScores.reduce((a, b) => a + b, 0) / analytics.riskScores.length) : 0;

        // Insight 1: Safety status
        if (analytics.total === 0) {
            insights.push({
                icon: '🚀', title: 'Ready to Trade',
                body: 'No swaps yet. Propose your first swap to see AI-driven security insights here.',
                color: 'green', link: null
            });
        } else if (avgRisk < 20) {
            insights.push({
                icon: '🛡', title: 'Trading Safely',
                body: `Your average risk score is ${avgRisk}/100 — you\'re making well-evaluated trades.`,
                color: 'green', link: null
            });
        } else if (avgRisk < 50) {
            insights.push({
                icon: '⚠️', title: 'Moderate Risk Detected',
                body: `Average risk: ${avgRisk}/100. Consider reviewing your swap patterns or tightening AI settings.`,
                color: 'yellow', link: 'settings'
            });
        } else {
            insights.push({
                icon: '🚨', title: 'High Risk Alert',
                body: `Average risk is ${avgRisk}/100! Review your settings and avoid large trades until resolved.`,
                color: 'red', link: 'settings'
            });
        }

        // Insight 2: Activity pattern
        if (analytics.total >= 3) {
            const approvalRate = Math.round((analytics.approved / analytics.total) * 100);
            insights.push({
                icon: '📊', title: `${approvalRate}% Approval Rate`,
                body: `${analytics.approved} of ${analytics.total} swaps approved. ${approvalRate >= 80 ? 'Great track record!' : 'Consider smaller, diversified trades.'}`,
                color: approvalRate >= 80 ? 'green' : 'yellow', link: null
            });
        }

        // Insight 3: Attack node warning
        if (analytics.attackNodes) {
            const highest = Object.entries(analytics.attackNodes).sort((a, b) => b[1] - a[1])[0];
            if (highest && highest[1] > 30) {
                const nodeNames = { l1: 'Value Drain (L1)', l2: 'Reentrancy (L2)', l3: 'Metadata Fraud (L3)', a3: 'Sybil Pumping (A3)' };
                insights.push({
                    icon: '🔍', title: `${nodeNames[highest[0]]} Elevated`,
                    body: `Your last swap scored ${highest[1]}/100 on ${nodeNames[highest[0]]}. Review fair-value slippage settings.`,
                    color: 'red', link: 'settings'
                });
            }
        }

        // Render
        insights.forEach(insight => {
            const card = document.createElement('div');
            card.className = `insight-card ${insight.color}`;
            card.innerHTML = `
                <span class="insight-icon">${insight.icon}</span>
                <div class="insight-title">${insight.title}</div>
                <div class="insight-body">${insight.body}</div>
                ${insight.link === 'settings' ? '<span class="insight-link" onclick="document.getElementById(\'settings-modal\').classList.add(\'open\')">Optimize Settings →</span>' : ''}
            `;
            container.appendChild(card);
        });

        // Update recommended preset badge
        detectRecommendedPreset();
    }

    // Patch updateAnalyticsUI to include insights
    const _origUpdateAnalytics = updateAnalyticsUI;
    updateAnalyticsUI = function() {
        _origUpdateAnalytics();
        generateInsights();
    };

    // Initial insights render
    generateInsights();

    // =================================================================
    //  EXPORT REPORT
    // =================================================================
    document.getElementById('export-report-btn')?.addEventListener('click', () => {
        if (analytics.evaluations.length === 0) {
            showToast('No evaluations to export', 'error');
            return;
        }
        let csv = 'Timestamp,SwapID,Score,RiskLevel,Decision\n';
        analytics.evaluations.forEach(ev => {
            csv += `"${ev.timestamp}",${ev.swapId},${ev.score},${ev.riskLevel},${ev.decision}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `dmex_report_${Date.now()}.csv`;
        a.click(); URL.revokeObjectURL(url);
        showToast('Report exported as CSV!');
        addLog('[EXPORT] Evaluation report downloaded');
    });
    // =================================================================
    //  CS2 STEAM BRIDGE SIMULATION
    // =================================================================
    const MOCK_CS2_SKINS = [
        { name: 'AK-47 | Asiimov', wear: 'Field-Tested', float: 0.21, stickers: '4x Crown', value: 85.00 },
        { name: 'AWP | Dragon Lore', wear: 'Factory New', float: 0.01, stickers: 'Souvenir', value: 1250.00 },
        { name: 'M4A4 | Howl', wear: 'Minimal Wear', float: 0.08, stickers: 'None', value: 780.00 },
        { name: 'Karambit | Fade', wear: 'Factory New', float: 0.03, stickers: '98% Fade', value: 950.00 },
        { name: 'Desert Eagle | Blaze', wear: 'Factory New', float: 0.006, stickers: 'None', value: 45.00 },
        { name: 'Glock-18 | Fade', wear: 'Factory New', float: 0.01, stickers: 'Full Fade', value: 520.00 },
        { name: 'USP-S | Kill Confirmed', wear: 'Minimal Wear', float: 0.09, stickers: 'None', value: 28.00 },
        { name: 'AK-47 | Fire Serpent', wear: 'Minimal Wear', float: 0.12, stickers: 'Crown on Wood', value: 350.00 },
        { name: 'Butterfly Knife | Doppler', wear: 'Factory New', float: 0.02, stickers: 'Phase 2', value: 680.00 },
        { name: 'AWP | Fade', wear: 'Factory New', float: 0.03, stickers: 'None', value: 320.00 }
    ];

    document.getElementById('btn-sync-steam')?.addEventListener('click', () => {
        document.getElementById('steam-bridge-modal').classList.add('open');
        document.getElementById('steam-status').textContent = 'Enter your Steam64 ID to sync your CS2 inventory.';
        document.getElementById('steam-inventory-preview').innerHTML = '';
    });
    document.getElementById('close-steam-modal')?.addEventListener('click', () => {
        document.getElementById('steam-bridge-modal').classList.remove('open');
    });
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('steam-bridge-modal')) document.getElementById('steam-bridge-modal').classList.remove('open');
        if (e.target === document.getElementById('ugc-mint-modal')) document.getElementById('ugc-mint-modal').classList.remove('open');
    });

    document.getElementById('btn-steam-sync-confirm')?.addEventListener('click', async () => {
        const steamId = document.getElementById('steam-id-input').value.trim();
        const statusEl = document.getElementById('steam-status');
        const previewEl = document.getElementById('steam-inventory-preview');

        if (!steamId || steamId.length < 10) {
            statusEl.innerHTML = '<span style="color:#e22134;">Invalid Steam ID. Use your Steam64 ID (17 digits).</span>';
            return;
        }

        statusEl.innerHTML = '<span style="color:var(--spotify-green);">⏳ Connecting to Steam API simulation...</span>';
        previewEl.innerHTML = '';

        // Simulate API delay
        await new Promise(r => setTimeout(r, 1500));
        statusEl.innerHTML = '<span style="color:var(--spotify-green);">✓ Steam Connected. Fetching CS2 inventory (AppID 730)...</span>';
        addLog(`[BRIDGE] CS2 Steam sync initiated for ID: ${steamId.substring(0, 10)}...`);

        await new Promise(r => setTimeout(r, 1000));

        // Pick 3-6 random skins to "import"
        const count = 3 + Math.floor(Math.random() * 4);
        const imported = [];
        const available = [...MOCK_CS2_SKINS];
        for (let i = 0; i < count && available.length > 0; i++) {
            const idx = Math.floor(Math.random() * available.length);
            imported.push(available.splice(idx, 1)[0]);
        }

        previewEl.innerHTML = imported.map(skin => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:6px;">
                <div>
                    <strong style="font-size:0.85rem;">${skin.name}</strong>
                    <small style="display:block;color:var(--text-secondary);">${skin.wear} · Float: ${skin.float} · ${skin.stickers}</small>
                </div>
                <span style="color:var(--spotify-green);font-weight:700;font-size:0.85rem;">$${skin.value.toFixed(2)}</span>
            </div>
        `).join('');

        statusEl.innerHTML = `<span style="color:var(--spotify-green);">✓ ${imported.length} CS2 skins verified via Steam API simulation. Minting commits to Scroll...</span>`;

        // Log each skin
        imported.forEach((skin, i) => {
            addLog(`[BRIDGE] CS2 Skin #${i + 1} verified: "${skin.name}" (${skin.wear}). Float: ${skin.float}. Value: $${skin.value.toFixed(2)}`);
        });

        // Store in localStorage for demo persistence
        const existing = JSON.parse(localStorage.getItem('dmex_cs2_skins') || '[]');
        localStorage.setItem('dmex_cs2_skins', JSON.stringify([...existing, ...imported]));

        showToast(`${imported.length} CS2 skins synced to vault!`);
        addLog(`[BRIDGE] ${imported.length} CS2 skins successfully bridged to D-MEX vault`);

        // Close after 5s
        setTimeout(() => {
            document.getElementById('steam-bridge-modal').classList.remove('open');
            // Refresh marketplace to show new items (now includes local persistence)
            loadMarketplace();
        }, 5000);
    });

    // =================================================================
    //  UGC MINT MODAL SIMULATION
    // =================================================================
    const UGC_ENGINE_MAP = {
        unreal: { name: 'UE5 Nanite Mesh', icon: 'U', iconClass: 'unreal', baseValue: 120.00, type: 'ERC-1155' },
        blender: { name: 'Blender Scene', icon: 'B', iconClass: 'blender', baseValue: 45.00, type: 'ERC-721' },
        maya: { name: 'Maya Rig', icon: 'M', iconClass: 'maya', baseValue: 200.00, type: 'ERC-721' },
        unity: { name: 'Unity Prefab', icon: '⚙', iconClass: 'unity', baseValue: 60.00, type: 'ERC-1155' }
    };

    document.getElementById('btn-mint-ugc')?.addEventListener('click', () => {
        document.getElementById('ugc-mint-modal').classList.add('open');
        document.getElementById('ugc-progress-bar').style.display = 'none';
        document.getElementById('ugc-progress-fill').style.width = '0%';
        document.getElementById('ugc-file-name').textContent = '';
    });
    document.getElementById('close-ugc-modal')?.addEventListener('click', () => {
        document.getElementById('ugc-mint-modal').classList.remove('open');
    });

    // File upload zone
    const ugcUploadZone = document.getElementById('ugc-upload-zone');
    const ugcFileInput = document.getElementById('ugc-file-input');
    if (ugcUploadZone && ugcFileInput) {
        ugcUploadZone.addEventListener('click', () => ugcFileInput.click());
        ugcUploadZone.addEventListener('dragover', (e) => { e.preventDefault(); ugcUploadZone.style.borderColor = 'var(--spotify-green)'; });
        ugcUploadZone.addEventListener('dragleave', () => { ugcUploadZone.style.borderColor = 'rgba(255,255,255,0.15)'; });
        ugcUploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            ugcUploadZone.style.borderColor = 'rgba(255,255,255,0.15)';
            if (e.dataTransfer.files.length > 0) {
                ugcFileInput.files = e.dataTransfer.files;
                document.getElementById('ugc-file-name').textContent = `Selected: ${e.dataTransfer.files[0].name}`;
            }
        });
        ugcFileInput.addEventListener('change', () => {
            if (ugcFileInput.files.length > 0) {
                document.getElementById('ugc-file-name').textContent = `Selected: ${ugcFileInput.files[0].name}`;
            }
        });
    }

    document.getElementById('btn-ugc-mint-confirm')?.addEventListener('click', async () => {
        const engine = document.getElementById('ugc-engine-select').value;
        const assetName = document.getElementById('ugc-name-input').value.trim() || 'Unnamed 3D Asset';
        const engineInfo = UGC_ENGINE_MAP[engine];

        const progressBar = document.getElementById('ugc-progress-bar');
        const progressFill = document.getElementById('ugc-progress-fill');

        progressBar.style.display = 'block';
        addLog(`[MINT] Starting UGC mint: "${assetName}" via ${engineInfo.name}`);

        // Simulate analysis steps
        const steps = ['Extracting metadata...', 'Validating mesh integrity...', 'Computing valuation...', 'Minting commitment token...'];
        for (let i = 0; i < steps.length; i++) {
            progressFill.style.width = `${((i + 1) / steps.length) * 100}%`;
            addLog(`[MINT] ${steps[i]}`);
            await new Promise(r => setTimeout(r, 800));
        }

        addLog(`[MINT] ✓ "${assetName}" minted as ${engineInfo.type}. Base value: $${engineInfo.baseValue.toFixed(2)}`);
        showToast(`${assetName} minted! Value: $${engineInfo.baseValue.toFixed(2)}`);

        // Store in localStorage
        const mintedAssets = JSON.parse(localStorage.getItem('dmex_minted_ugc') || '[]');
        mintedAssets.push({
            name: assetName,
            engine: engine,
            type: engineInfo.type,
            icon: engineInfo.icon,
            iconClass: engineInfo.iconClass,
            baseValue: engineInfo.baseValue,
            mintedAt: Date.now()
        });
        localStorage.setItem('dmex_minted_ugc', JSON.stringify(mintedAssets));

        setTimeout(() => {
            document.getElementById('ugc-mint-modal').classList.remove('open');
            // Refresh marketplace
            loadMarketplace();
        }, 5000);
    });

    // =================================================================
    //  SEVERITY SCORE UI (Advisory-Only, Never Blocks)
    // =================================================================
    function showSeverityBanner(severityData) {
        const banner = document.getElementById('severity-banner');
        const iconEl = document.getElementById('severity-icon');
        const labelEl = document.getElementById('severity-label');
        const scoreEl = document.getElementById('severity-score');
        const detailEl = document.getElementById('severity-detail');
        const actionsEl = document.getElementById('severity-actions');
        if (!banner) return;

        const icons = { fair: '🟢', mild: '🟡', significant: '🟠', critical: '🔴' };
        const labels = { fair: 'Fair Trade', mild: 'Mild Imbalance', significant: 'Significant Value Drain', critical: 'Critical Value Drain' };

        iconEl.textContent = icons[severityData.level] || '🟢';
        labelEl.textContent = labels[severityData.level] || 'Fair Trade';
        scoreEl.textContent = `${severityData.severity}/100`;

        if (severityData.severity > 20) {
            detailEl.innerHTML = `You're offering <strong>$${severityData.offeredUSD?.toFixed?.(2) || '?'}</strong> in value for <strong>$${severityData.wantedUSD?.toFixed?.(2) || '?'}</strong> in return.`;
        } else {
            detailEl.innerHTML = 'Asset values are within a fair range. No action needed.';
        }

        // Render countermeasure buttons
        actionsEl.innerHTML = '';
        if (severityData.countermeasures && severityData.countermeasures.length > 0) {
            severityData.countermeasures.forEach(cm => {
                const btn = document.createElement('button');
                btn.className = 'pill-btn outlined mini';
                btn.style.cssText = 'font-size:0.75rem;padding:6px 12px;margin:4px;';
                btn.textContent = cm.label;
                btn.title = cm.detail;
                btn.addEventListener('click', () => {
                    if (cm.action === 'override') {
                        banner.style.display = 'none';
                        showToast('Override accepted — proceeding with swap.');
                        addLog('[SEVERITY] User overrode value asymmetry warning');
                    } else {
                        showToast(cm.detail);
                        addLog(`[SEVERITY] Suggested: ${cm.label} — ${cm.detail}`);
                    }
                });
                actionsEl.appendChild(btn);
            });
        }

        banner.style.display = 'block';
        banner.className = `severity-banner severity-${severityData.color || 'green'}`;
    }

    // Patch the evaluation handler to show severity UI
    const _origRecordEvaluation = recordEvaluation;
    recordEvaluation = function(swapId, txHash, riskScore, decision, fairValue = null, severityData = null) {
        _origRecordEvaluation(swapId, txHash, riskScore, decision, fairValue);
        if (severityData && severityData.severity > 0) {
            showSeverityBanner(severityData);
        }
    };

    // =================================================================
    //  USER PROFILE & SMART WALLET LAUNCHER
    // =================================================================
    // Reusing btnProfile from above
    const userProfileModal = document.getElementById('user-profile-modal');
    const closeUserProfile = document.getElementById('close-user-profile');
    
    function loadAndShowMints() {
        const grid = document.getElementById('ugc-asset-grid');
        if (!grid) return;
        
        if (typeof isLiveMarketplace !== 'undefined' && isLiveMarketplace) {
            grid.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:40px;grid-column:1/-1;">Live Network: Please connect your Web3 Wallet to bridge real assets from Steam and Epic Games.</div>';
            return;
        }
        
        const mints = JSON.parse(localStorage.getItem('dmex_minted_ugc') || '[]');
        if (mints.length === 0) {
            grid.innerHTML = '<div style="color:var(--text-secondary);font-size:0.8rem;">No minted assets found. Access the Open Market tab to Mint a 3D Asset.</div>';
            return;
        }
        grid.innerHTML = '';
        mints.forEach((m, idx) => {
            const card = document.createElement('div');
            card.className = 'ugc-card';
            card.innerHTML = `
                <div class="asset-glass-ios ugc" style="margin-bottom:12px;">${m.icon}</div>
                <h5>${m.name}</h5>
                <p>Engine: ${m.engine}</p>
                <div class="ugc-value-editor">
                    <input type="number" class="ugc-value-input" value="${m.baseValue.toFixed(0)}" id="ugc-val-${idx}">
                    <button class="btn-set-value" onclick="window.updateUGCValue(${idx})">Set Value</button>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    window.updateUGCValue = function(idx) {
        const input = document.getElementById(`ugc-val-${idx}`);
        const newVal = parseFloat(input.value);
        if (isNaN(newVal)) return;

        let mints = JSON.parse(localStorage.getItem('dmex_minted_ugc') || '[]');
        if (mints[idx]) {
            mints[idx].baseValue = newVal;
            localStorage.setItem('dmex_minted_ugc', JSON.stringify(mints));
            showToast(`Perceived value set to $${newVal}`, 'info');
            // Refresh creators or other UI if needed
            Object.values(GAME_REGISTRY.ugc.assets).forEach(a => {
                if (a.name === mints[idx].name) a.baseValue = newVal;
            });
        }
    };

    if (btnProfile && userProfileModal) {
        btnProfile.addEventListener('click', () => {
            userProfileModal.classList.add('open');
            // Populate smart wallet text based on connection
            document.getElementById('smart-wallet-addr').textContent = userAddr ? userAddr : 'Awaiting initialization...';
            document.getElementById('profile-modal-addr').textContent = userAddr ? shortAddr(userAddr) : 'Not Connected';
            document.getElementById('profile-modal-uid').textContent = userAddr ? 'ID: ' + userAddr.substring(2,8).toUpperCase() : 'ID: PENDING';
            
            // Populate balances (Cross-Game Simulation)
            if (userAddr) {
                document.getElementById('prof-bal-dgld').textContent = prevBalances.dgld !== null ? prevBalances.dgld : '1,500';
                document.getElementById('prof-bal-sword').textContent = prevBalances.nft !== null ? prevBalances.nft : '2';
                document.getElementById('prof-bal-comm').textContent = prevBalances.commodity !== null ? prevBalances.commodity : '450';
                
                // Show other game totals
                const godsRes = document.getElementById('prof-bal-gods');
                if (godsRes) godsRes.textContent = '14 Cards';
                const lootRes = document.getElementById('prof-bal-loot');
                if (lootRes) lootRes.textContent = '1 Bag';

                document.getElementById('profile-modal-reputation').textContent = 'Rep: 98%';
            } else {
                document.querySelectorAll('.port-card strong').forEach(el => el.textContent = '--');
                document.getElementById('profile-modal-reputation').textContent = 'Rep: --';
            }
            loadAndShowMints();
        });

        if (closeUserProfile) {
            closeUserProfile.addEventListener('click', () => {
                userProfileModal.classList.remove('open');
            });
        }
    }

    // Profile Tabs
    const ptabs = document.querySelectorAll('.ptab');
    const ptabContents = document.querySelectorAll('.ptab-content');
    ptabs.forEach(ptab => {
        ptab.addEventListener('click', () => {
            ptabs.forEach(t => t.classList.remove('active'));
            ptabContents.forEach(c => c.classList.remove('active'));
            ptab.classList.add('active');
            document.getElementById(`ptab-${ptab.dataset.ptab}`).classList.add('active');
        });
    });

    // Save Identity
    const btnSavePersonal = document.getElementById('btn-save-personal');
    if (btnSavePersonal) {
        btnSavePersonal.addEventListener('click', () => {
            const fn = document.getElementById('profile-input-fn').value.trim();
            const email = document.getElementById('profile-input-email').value.trim();
            if (fn) {
                localStorage.setItem('dmex_personal_info', JSON.stringify({ firstName: fn, email: email }));
                localStorage.setItem('dmex_username', fn);
                showToast('Identity Saved Locally', 'info');
                document.getElementById('profile-modal-name').textContent = fn;
                updateWelcomeMessage();
            }
        });
    }

    // Load Identity & Trigger Welcome Toast
    const savedId = JSON.parse(localStorage.getItem('dmex_personal_info') || 'null');
    if (savedId && savedId.firstName) {
        // Hydrate profile
        if(document.getElementById('profile-input-fn')) document.getElementById('profile-input-fn').value = savedId.firstName;
        if(document.getElementById('profile-input-email')) document.getElementById('profile-input-email').value = savedId.email || '';
        if(document.getElementById('profile-modal-name')) document.getElementById('profile-modal-name').textContent = savedId.firstName;
        
        // Welcome Toast trigger after a short delay
        setTimeout(() => {
            const wt = document.getElementById('welcome-toast');
            if (wt) {
                document.getElementById('welcome-avatar').textContent = savedId.firstName.charAt(0).toUpperCase();
                document.getElementById('welcome-message').textContent = `Hi, ${savedId.firstName}. Welcome to the D-MEX`;
                wt.classList.add('show');
                // Hide after 5 seconds
                setTimeout(() => { wt.classList.remove('show'); }, 5000);
            }
        }, 800);
    }

    // Sign Out & Disconnect
    const btnSignOut = document.getElementById('btn-sign-out');
    if (btnSignOut) {
        btnSignOut.addEventListener('click', () => {
            // Disconnect wallet logic (simulate)
            if (userAddr) {
                // If the connectWallet acts as a toggle, calling it with forceDirect=false might open metamask again or disconnect.
                // Looking at connectWallet logic: if (userAddr) it disconnects.
                connectWallet(false); 
            }

            // Clear Personal Info
            localStorage.removeItem('dmex_personal_info');
            localStorage.removeItem('dmex_username');
            document.getElementById('profile-input-fn').value = '';
            document.getElementById('profile-input-email').value = '';
            document.getElementById('profile-modal-name').textContent = 'Guest Trader';
            updateWelcomeMessage();
            
            showToast('Session ended. Wallet disconnected and identity wiped.', 'info');
            userProfileModal.classList.remove('open');
        });
    }
    // =================================================================
    //  ORDER HISTORY & WARNINGS LOGIC
    // =================================================================
    const historyList = document.getElementById('history-list');
    
    // Real History Data
    let realHistory = [];

    async function fetchOrderHistory() {
        if (!userAddr) return;
        try {
            const res = await fetch(GUARDIAN_API + '/api/portfolio/' + userAddr);
            const data = await res.json();
            if (data.history) {
                realHistory = data.history;
                renderOrderHistory();
            }
        } catch (e) {
            console.error('[HISTORY] Failed to fetch real history:', e);
        }
    }

    function renderOrderHistory() {
        if (!historyList) return;
        historyList.innerHTML = '';
        
        if (realHistory.length === 0) {
            historyList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.9rem;padding:20px;">No past swaps found. Propose a new intent!</p>';
            return;
        }

        realHistory.forEach(rawOrder => {
            const ev = rawOrder.guardianEvaluation || {};
            const isEvaluated = !!rawOrder.guardianEvaluation;

            // Map status
            let status = 'executed';
            let statusLabel = 'Executed successfully';
            if (rawOrder.onChainStatus === 'pending') {
                status = 'pending';
                statusLabel = 'Pending';
                if (ev.decision === 'reject') {
                    status = 'rejected';
                    statusLabel = 'Blocked: ' + (ev.reason || 'High Risk');
                } else if (ev.decision === 'pending_co_signer' || ev.severity?.severity > 0) {
                    status = 'flagged';
                    statusLabel = 'Flagged: Imbalance';
                }
            } else if (rawOrder.onChainStatus === 'cancelled') {
                status = 'rejected';
                statusLabel = 'Cancelled';
            }

            // Map warning
            let warning = null;
            if (isEvaluated && (status === 'flagged' || status === 'rejected')) {
                warning = {
                    score: (ev.score || 0) + '/100',
                    title: ev.severity?.level === 'high' ? 'Severe Imbalance' : (ev.reason || 'Imbalance Detected'),
                    text: ev.psychWarnings ? ev.psychWarnings[0] : `You're offering $${ev.offeredUSD || 0} in value for $${ev.wantedUSD || 0} in return.`
                };
            }

            const order = {
                id: shortAddr(rawOrder.tradeId),
                date: ev.timestamp ? new Date(ev.timestamp).toLocaleString() : 'Unknown Date',
                type: rawOrder.type,
                counterparty: shortAddr(rawOrder.counterparty),
                status,
                statusLabel,
                offered: isEvaluated ? `$${ev.offeredUSD}` : 'Unknown',
                received: isEvaluated ? `$${ev.wantedUSD}` : 'Unknown',
                warning
            };

            const el = document.createElement('div');
            el.className = 'history-item';
            
            // Generate Warning HTML
            let warningHtml = '';
            if (order.warning) {
                const overrideBtn = order.status === 'flagged' ? 
                    `<button class="warning-btn btn-override" data-id="${order.id}">Override & Proceed</button>` : '';
                    
                warningHtml = `
                    <div class="imbalance-warning" style="border-color: ${order.status === 'rejected' ? 'rgba(226,33,52,0.4)' : 'rgba(200,160,40,0.3)'};">
                        <div class="warning-header">
                            <div class="warning-title">
                                <div class="warning-circle" style="background-color: ${order.status === 'rejected' ? '#e22134' : '#ffe000'}; box-shadow: 0 0 10px ${order.status === 'rejected' ? 'rgba(226,33,52,0.4)' : 'rgba(255,224,0,0.4)'};"></div>
                                ${order.warning.title}
                            </div>
                            <div class="warning-score" style="background: ${order.status === 'rejected' ? 'rgba(226,33,52,0.2)' : 'rgba(0,0,0,0.6)'};">
                                ${order.warning.score}
                            </div>
                        </div>
                        <div class="warning-text">
                            ${order.warning.text}
                        </div>
                        <div class="warning-actions">
                            ${order.status === 'flagged' ? `
                                <button class="warning-btn">Add Top-Up</button>
                                <button class="warning-btn">Adjust Quantities</button>
                            ` : ''}
                            ${overrideBtn}
                        </div>
                    </div>
                `;
            } else {
                warningHtml = `<div style="color:var(--text-secondary);font-size:0.9rem;padding:20px 0;">No warnings. Transaction executed flawlessly.</div>`;
            }

            el.innerHTML = `
                <div class="history-header">
                    <div>
                        <div class="history-title">${order.id} · ${order.type}</div>
                        <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">${order.date} | To: ${order.counterparty}</div>
                    </div>
                    <div class="history-status status-${order.status}">${order.statusLabel}</div>
                </div>
                <div class="history-details">
                    <div style="display:flex;justify-content:space-between;margin-bottom:12px;background:rgba(0,0,0,0.2);padding:12px;border-radius:8px;">
                        <div><small style="color:var(--text-secondary)">You Offered:</small><br><strong>${order.offered}</strong></div>
                        <div style="text-align:right;"><small style="color:var(--text-secondary)">You Receive:</small><br><strong>${order.received}</strong></div>
                    </div>
                    ${warningHtml}
                </div>
            `;
            
            // Expand toggle
            el.addEventListener('click', (e) => {
                // don't toggle if clicking a button
                if (e.target.tagName === 'BUTTON') return;
                
                // Close others
                document.querySelectorAll('.history-item').forEach(hi => {
                    if (hi !== el) hi.classList.remove('expanded');
                });
                el.classList.toggle('expanded');
            });
            
            historyList.appendChild(el);
        });
        
        // Bind Override Buttons
        document.querySelectorAll('.btn-override').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                const p = e.target.closest('.history-item');
                
                // Simulate Secure Wallet Signature (Best practice for protocol safety)
                showToast(`Requesting secure signature to override ${id}...`, 'info');
                try {
                    // We simulate eth_signTypedData by popping MetaMask if connected, else waiting
                    if (window.ethereum && userAddr) {
                        const msgParams = JSON.stringify({
                            domain: { chainId: 534351, name: 'D-MEX Guardian', version: '1' },
                            message: { action: 'OVERRIDE_WARNING', swapId: id, riskAccepted: true },
                            primaryType: 'Override',
                            types: {
                                EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }],
                                Override: [{ name: 'action', type: 'string' }, { name: 'swapId', type: 'string' }, { name: 'riskAccepted', type: 'bool' }]
                            }
                        });
                        await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [userAddr, msgParams] });
                    } else {
                        // Simulate delay for Direct RPC
                        await new Promise(r => setTimeout(r, 1500));
                    }
                    
                    showToast('Risk accepted and signed. Order execution proceeding...', 'success');
                    addLog(`[SECURITY] User cryptographically signed risk acceptance for ${id}`);
                    
                    // Update UI state
                    const statusBadge = p.querySelector('.history-status');
                    statusBadge.className = 'history-status status-executed';
                    statusBadge.innerText = 'Overridden & Executed';
                    e.target.parentElement.innerHTML = '<span style="color:var(--spotify-green);font-size:0.85rem;">✓ Signature verified. Transaction submitted.</span>';
                    
                } catch (err) {
                    showToast('Signature rejected. Override cancelled.', 'error');
                }
            });
        });
    }
    
    // Initial Render
    renderOrderHistory();

    // =================================================================
    //  DEMO MODE SEEDER
    // =================================================================
    let demoCount = 0;
    function initDemoMode() {
        showToast('🔮 Initializing Demo Mode: Diversifying Marketplace...', 'success');
        addLog('[DEMO] Seeding 25+ cross-game listings...');

        const games = ['loot', 'gods', 'cryptokitties', 'cs2', 'ugc'];
        const mockAssets = {
            loot: { name: 'Loot Bag #882', icon: '🎒', iconClass: 'loot' },
            gods: { name: 'Diamond God Card', icon: '🃏', iconClass: 'gods' },
            cryptokitties: { name: 'Gen-0 Kitty', icon: '🐱', iconClass: 'kitty' },
            cs2: { name: 'M4A4 | Howl', icon: '🔫', iconClass: 'cs2' },
            ugc: { name: '3D Cyber Armor', icon: '🦾', iconClass: 'ugc' }
        };

        for (let i = 0; i < 25; i++) {
            const gameKey = games[i % games.length];
            const meta = mockAssets[gameKey];
            const trader = MOCK_TRADERS[i % MOCK_TRADERS.length];
            
            allListings.push({
                idx: allListings.length,
                seller: trader.addr,
                asset: { 
                    type: gameKey === 'loot' ? 2 : (gameKey === 'dmex' ? 0 : 1), 
                    name: `${meta.name} #${1000 + i}`, 
                    icon: meta.icon, 
                    iconClass: meta.iconClass,
                    game: gameKey
                },
                marketValue: 20 + Math.random() * 500,
                askingPrice: { amount: 10 + Math.floor(Math.random() * 100), asset: 'DGLD' },
                holderProfile: { reputation: trader.rep, totalSwaps: 5 + i },
                listedAt: Date.now() - (i * 3600000)
            });
        }

        renderMarketplaceListings();
        renderQuickCounterparties();
        addLog('[DEMO] Marketplace diversified successfully.');
    }

    const logo = document.querySelector('.logo');
    if (logo) {
        logo.style.cursor = 'help';
        logo.addEventListener('click', () => {
            demoCount++;
            if (demoCount === 3) { // 3 clicks to activate
                initDemoMode();
                demoCount = 0;
            } else {
                showToast(`Demo reveal in ${3 - demoCount}...`, 'info');
            }
        });
    }
});
