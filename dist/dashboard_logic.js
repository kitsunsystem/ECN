// RubiX Premium Custom Toast System
function showToast(message, type = 'info') {
    let container = document.getElementById('mitsuToastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'mitsuToastContainer';
        container.className = 'mitsu-toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `mitsu-toast ${type}`;
    
    let icon = '💡';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';
    else if (type === 'info') icon = '✨';
    
    toast.innerHTML = `
        <span class="mitsu-toast-icon">${icon}</span>
        <span class="mitsu-toast-message">${message}</span>
        <button class="mitsu-toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4500);
}

// Override native alert to custom toast notification
window.alert = function(message) {
    showToast(message, 'info');
};

function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// Robust cross-browser date parser helper (supports YYYY/MM/DD and DD/MM/YYYY)
function parseDate(dateStr) {
    if (!dateStr) return new Date();
    // Convert to string and normalize delimiters: replace dots with slashes
    const cleanStr = String(dateStr).replace(/\./g, '/').trim();
    // Expected format: DD/MM/YYYY HH:MM:SS or YYYY/MM/DD HH:MM:SS
    const parts = cleanStr.split(' ');
    const datePart = parts[0]; 
    const timePart = parts[1] || "00:00:00"; 

    const dateBits = datePart.split('/');
    if (dateBits.length !== 3) {
        const parsed = new Date(cleanStr);
        return isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    let day, month, year;
    // Check if the first bit is a 4-digit year (e.g. YYYY/MM/DD)
    if (dateBits[0].length === 4) {
        year = parseInt(dateBits[0], 10);
        month = parseInt(dateBits[1], 10) - 1;
        day = parseInt(dateBits[2], 10);
    } else {
        // Otherwise assume standard DD/MM/YYYY
        day = parseInt(dateBits[0], 10);
        month = parseInt(dateBits[1], 10) - 1;
        year = parseInt(dateBits[2], 10);
    }

    const timeBits = timePart.split(':');
    const hours = parseInt(timeBits[0] || '0', 10);
    const minutes = parseInt(timeBits[1] || '0', 10);
    const seconds = parseInt(timeBits[2] || '0', 10);

    const d = new Date(year, month, day, hours, minutes, seconds);
    if (isNaN(d.getTime())) {
        return new Date();
    }
    return d;
}

let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem('mitsu_user')); } catch(e) { currentUser = null; }
let currentAccountId = null;
let loadedAccounts = {};
let currentChart = null;
let currentTimeframe = '1M';
let historyLimit = 15;

const API_URL = "/api";

// ─────────────────────────────────────────
// ONBOARDING & SIMULATION STATE
// ─────────────────────────────────────────

let botSimChart = null;
let currentBotMode = 'lowcost';
let currentCapitalType = 'perso'; // 'perso' or 'propfirm'
let selectedBotId = null;

// Mock accounts cleaned up

// ─────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────
function switchAuth(tab) {
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabSignup').classList.toggle('active', tab === 'signup');
    document.getElementById('formLogin').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('formSignup').style.display = tab === 'signup' ? 'block' : 'none';
}

async function handleSignup() {
    const firstName = document.getElementById('signFirst').value.trim();
    const lastName  = document.getElementById('signLast').value.trim();
    const email     = document.getElementById('signEmail').value.trim();
    const password  = document.getElementById('signPass').value;
    const referredByCode = document.getElementById('signRefCode').value.trim();

    if (!firstName || !lastName || !email || !password) {
        return showToast("Veuillez remplir tous les champs obligatoires.", "error");
    }

    try {
        const res  = await fetch(`${API_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, email, password, referredByCode })
        });
        const data = await res.json();
        if (data.status === 'success') {
            localStorage.setItem('mitsu_just_signed_up', 'true');
            showToast("Compte créé avec succès ! Connectez-vous.", "success");
            switchAuth('login');
        } else {
            showToast(data.message, "error");
        }
    } catch (e) {
        console.error("Signup Error:", e);
        showToast("Connexion au serveur échouée : " + e.message, "error");
    }
}

async function handleLogin() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPass').value;

    if (!email || !password) {
        return showToast("Veuillez remplir tous les champs.", "error");
    }

    try {
        const res  = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.status === 'success') {
            localStorage.setItem('mitsu_user', JSON.stringify(data.user));
            currentUser = data.user;
            showToast("Connexion réussie. Bienvenue !", "success");
            initDashboard();
        } else {
            showToast(data.message, "error");
        }
    } catch (e) {
        console.error("Login Error:", e);
        showToast("Échec de la connexion : " + e.message, "error");
    }
}

function logout() {
    localStorage.removeItem('mitsu_user');
    sessionStorage.removeItem('mitsu_welcomed');
    location.reload();
}

async function changePassword() {
    const oldPassword = document.getElementById('oldPass').value;
    const newPassword = document.getElementById('newPass').value;
    if (!oldPassword || !newPassword) return alert("Veuillez remplir les deux champs.");

    try {
        const res  = await fetch(`${API_URL}/update-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email, oldPassword, newPassword })
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert("Mot de passe mis à jour avec succès !");
            document.getElementById('oldPass').value = '';
            document.getElementById('newPass').value = '';
        } else {
            alert(data.message);
        }
    } catch (e) {
        alert("Erreur lors de la mise à jour du mot de passe.");
    }
}

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
// Automatically skip welcome modal in presentation simulator mode or iframe
if (window.isPresentationPlayer || window.parent !== window) {
    sessionStorage.setItem('mitsu_welcomed', 'true');
}

// Welcome flow logic
function triggerWelcomeFlow() {
    const welcomed = sessionStorage.getItem('mitsu_welcomed');
    if (welcomed !== 'true') {
        const welcomeModal = document.getElementById('mitsuWelcomeModal');
        if (welcomeModal) {
            welcomeModal.style.display = 'flex';
        }
    } else {
        startSubsequentFlows();
    }
}

async function closeWelcomeModal() {
    const welcomeModal = document.getElementById('mitsuWelcomeModal');
    if (welcomeModal) {
        welcomeModal.classList.add('fade-out-blur');
        setTimeout(() => {
            welcomeModal.style.display = 'none';
            welcomeModal.classList.remove('fade-out-blur');
            sessionStorage.setItem('mitsu_welcomed', 'true');
            startSubsequentFlows();
        }, 550); // Matches the fade-out duration
    } else {
        sessionStorage.setItem('mitsu_welcomed', 'true');
        startSubsequentFlows();
    }
}

async function startSubsequentFlows() {
    if (!currentUser) return;
    const tutoCompletedKey = `mitsu_tutorial_completed_${currentUser.email}`;
    
    // Auto trigger tutorial if first time (email-specific to support multiple testing/different users)
    if (localStorage.getItem('mitsu_just_signed_up') === 'true') {
        localStorage.removeItem('mitsu_just_signed_up');
        localStorage.removeItem(tutoCompletedKey);
        localStorage.removeItem('mitsu_tutorial_completed');
    }
    
    if (localStorage.getItem(tutoCompletedKey) !== 'true') {
        openTutoVideoModal();
    } else {
        await loadData();
        if (!window.loadDataInterval) {
            window.loadDataInterval = setInterval(loadData, 10000);
        }
    }
}

async function initDashboard() {
    initThemeMode();
    if (!currentUser) {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('dashContent').style.display = 'none';
        
        // Auto pre-fill referral code from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const ref = urlParams.get('ref');
        if (ref) {
            const refField = document.getElementById('signRefCode');
            if (refField) {
                refField.value = ref.trim().toUpperCase();
                switchAuth('signup');
                showToast("Code de parrainage détecté et appliqué : " + ref.trim().toUpperCase(), "info");
            }
        }
        return;
    }

    const authScreen = document.getElementById('authScreen');
    const dashContent = document.getElementById('dashContent');

    // Populate user profile info
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = currentUser.fullName || 'Client';
    const headerNameEl = document.getElementById('headerUserName');
    if (headerNameEl) headerNameEl.textContent = currentUser.fullName || 'Client';

    const avatarEl = document.getElementById('avatarLetter');
    if (avatarEl) avatarEl.textContent = currentUser.fullName ? currentUser.fullName.charAt(0).toUpperCase() : 'C';
    const headerAvatarEl = document.getElementById('headerAvatarLetter');
    if (headerAvatarEl) headerAvatarEl.textContent = currentUser.fullName ? currentUser.fullName.charAt(0).toUpperCase() : 'C';

    const welcomeUserName = document.getElementById('welcomeUserName');
    if (welcomeUserName) welcomeUserName.textContent = currentUser.fullName || 'Client';
    
    const welcomeAvatar = document.getElementById('welcomeAvatar');
    if (welcomeAvatar) welcomeAvatar.textContent = currentUser.fullName ? currentUser.fullName.charAt(0).toUpperCase() : 'C';

    // Smooth transition from authScreen to dashContent
    if (authScreen && authScreen.style.display !== 'none' && window.getComputedStyle(authScreen).display !== 'none') {
        authScreen.classList.add('fade-out-blur');
        setTimeout(() => {
            authScreen.style.display = 'none';
            authScreen.classList.remove('fade-out-blur');
            
            if (dashContent) {
                dashContent.style.display = 'block';
                dashContent.classList.add('animate-entrance');
                setTimeout(() => {
                    dashContent.classList.remove('animate-entrance');
                }, 1000); // Supprime l'animation pour rétablir la position fixe du menu
            }
            triggerWelcomeFlow();
        }, 550);
    } else {
        if (authScreen) authScreen.style.display = 'none';
        if (dashContent) {
            dashContent.style.display = 'block';
            dashContent.classList.add('animate-entrance');
            setTimeout(() => {
                dashContent.classList.remove('animate-entrance');
            }, 1000); // Supprime l'animation pour rétablir la position fixe du menu
        }
        triggerWelcomeFlow();
    }

    // Init bot calculations
    switchBotMode('lowcost');

    // Initialize custom selects UI
    if (typeof initCustomSelects === 'function') {
        initCustomSelects();
    }

    // Check URL hash or query parameters for initial view redirect (e.g. #bot or ?tab=bot)
    const urlParams = new URLSearchParams(window.location.search);
    const targetTab = urlParams.get('tab') || urlParams.get('view') || window.location.hash.replace('#', '');
    if (targetTab && typeof VIEW_IDS !== 'undefined' && VIEW_IDS.includes(targetTab)) {
        switchView(targetTab);
        if (targetTab === 'bot') {
            selectBot('rubix');
        }
    }
}

// ─────────────────────────────────────────
// DATA LOAD
// ─────────────────────────────────────────
async function loadData() {

    
    try {
        const res      = await fetch(`${API_URL}/dashboard?email=${encodeURIComponent(currentUser.email)}`);
        const accounts = await res.json();

        // If no trading accounts connected yet
        if (!Array.isArray(accounts) || accounts.length === 0) {
            loadedAccounts = {};
            currentAccountId = null;
            updateUI();
            return;
        }

        accounts.forEach(acc => { loadedAccounts[acc.account_id] = acc; });
        if (!currentAccountId || !loadedAccounts[currentAccountId]) currentAccountId = accounts[0].account_id;

        // Render account tabs
        const tabContainer = document.getElementById('accountTabs');
        let tabsHtml = "";
        if (accounts.length > 1) {
            tabsHtml = accounts.map(acc => `
                <button class="btn-tab ${acc.account_id === currentAccountId ? 'active' : ''}"
                        onclick="switchAccount('${acc.account_id}')">
                    MT5 #${acc.account_id}
                </button>
            `).join('');
        } else {
            tabsHtml = `
                <span style="font-size:10px; color:var(--theme); font-weight:700; text-transform:uppercase; letter-spacing:2px; display:inline-flex; align-items:center; margin-right:10px;">
                    Terminal Actif : #${accounts[0].account_id}
                </span>`;
        }
        
        // Append the "Ajouter un compte MT5" button to the end
        tabsHtml += `
            <button class="btn-tab" onclick="requestAddMT5Account()" style="background: rgba(224,17,95,0.06); border-color: rgba(224,17,95,0.3); color: var(--theme); font-weight: 700; margin-left: 8px;">
                ＋ Ajouter un compte MT5
            </button>`;
            
        tabContainer.innerHTML = tabsHtml;

        updateUI();
        loadCommunityData();
    } catch (e) {
        console.error("Data fetch error:", e);
    }
}

function switchAccount(id) {
    currentAccountId = id;
    // Update tab highlight
    document.querySelectorAll('#accountTabs .btn-tab').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.includes(id));
    });
    updateUI();
}

// ─────────────────────────────────────────
// UI UPDATE & LOCKED EMPTY STATES
// ─────────────────────────────────────────
function updateUI() {
    const hasAccounts = currentAccountId && loadedAccounts[currentAccountId];
    
    const lockOverlay     = document.getElementById('dashboardLockOverlay');
    const realContent     = document.getElementById('dashboardRealContent');
    const configLockMask  = document.getElementById('configLockMask');
    
    if (!hasAccounts) {
        // Blur and Lock Dashboard + Configuration
        if (lockOverlay) lockOverlay.style.display = 'flex';
        if (realContent) {
            realContent.style.filter = 'blur(16px)';
            realContent.style.pointerEvents = 'none';
        }
        if (configLockMask) configLockMask.style.display = 'flex';
        
        // Reset dashboard values to empty placeholders
        document.getElementById('statBalance').textContent = '$0.00';
        document.getElementById('statProfit').textContent  = '$0.00';
        document.getElementById('statWin').textContent     = '0%';
        document.getElementById('statPF').textContent      = '0.00';
        
        const todayEl = document.getElementById('statToday');
        if (todayEl) {
            todayEl.textContent = '$0.00';
            todayEl.style.color = 'var(--theme)';
        }
        
        const tabContainer = document.getElementById('accountTabs');
        if (tabContainer) tabContainer.innerHTML = '';
        
        renderHistory([]);
        renderDailyHistory([], 0);
        return;
    }
    
    // Normal unlocked state: hide overlays
    if (lockOverlay) lockOverlay.style.display = 'none';
    if (realContent) {
        realContent.style.filter = 'none';
        realContent.style.pointerEvents = 'auto';
    }
    if (configLockMask) configLockMask.style.display = 'none';

    const acc = loadedAccounts[currentAccountId];
    const cfg = acc.config || {};

    // ── Core Stats ──
    const balance     = parseFloat(acc.balance) || 0;
    const totalResult = parseFloat(acc.totalResult) || 0;

    document.getElementById('statBalance').textContent = '$' + balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('statProfit').textContent  = (totalResult >= 0 ? '+' : '') + '$' + totalResult.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('statWin').textContent     = acc.winRate    || '0%';
    document.getElementById('statPF').textContent      = acc.profitFactor || '0.00';

    // ── Gain du Jour ──
    const nowParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    nowParis.setHours(0, 0, 0, 0);
    const startOfToday = new Date(nowParis.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));

    let todayProfit = 0;
    (acc.history || []).forEach(h => {
        const tradeDate = parseDate(h.date);
        if (tradeDate >= startOfToday) {
            todayProfit += parseFloat(String(h.resultStr).replace('$', '').replace('+', '')) || 0;
        }
    });

    const todayEl = document.getElementById('statToday');
    if (todayEl) {
        todayEl.textContent = (todayProfit >= 0 ? '+' : '') + '$' + todayProfit.toFixed(2);
        todayEl.style.color = todayProfit > 0 ? 'var(--success)' : todayProfit < 0 ? 'var(--danger)' : 'var(--theme)';
    }
    const summaryTodayEl = document.getElementById('summaryToday');
    if (summaryTodayEl) summaryTodayEl.textContent = (todayProfit >= 0 ? '+' : '') + '$' + todayProfit.toFixed(2);

    // ── Config values ──
    const lotMult    = parseFloat(cfg.lot_multiplier) || 1.0;
    const adminOn    = cfg.enabled !== false;          
    const clientOn   = cfg.client_enabled !== false;   
    const monthlyPrice = parseFloat(cfg.monthly_price) || 0.0;

    let maxDailyProfitTargetPct = 1.25;
    if (cfg.max_daily_profit_target_pct !== undefined && cfg.max_daily_profit_target_pct !== null) {
        const parsedPct = parseFloat(cfg.max_daily_profit_target_pct);
        if (!isNaN(parsedPct)) {
            maxDailyProfitTargetPct = parsedPct;
        }
    }

    const isProp = (maxDailyProfitTargetPct <= 0.65);
    currentCapitalType = isProp ? 'propfirm' : 'perso';
    
    // Automatically toggle active capital type tab in client UI
    const tabPerso = document.getElementById('tabCapPerso');
    const tabPropfirm = document.getElementById('tabCapPropfirm');
    if (tabPerso && tabPropfirm) {
        if (isProp) {
            tabPropfirm.classList.add('active');
            tabPerso.classList.remove('active');
        } else {
            tabPerso.classList.add('active');
            tabPropfirm.classList.remove('active');
        }
    }

    // Update simple mode UI labels dynamically
    const simpleCapMinLabel = document.getElementById('simpleCapMinLabel');
    const simpleCapRecLabel = document.getElementById('simpleCapRecLabel');
    const simpleCapMaxLabel = document.getElementById('simpleCapMaxLabel');
    const simpleCapitalLabelText = document.getElementById('simpleCapitalLabelText');
    const simpleGainMinLabel = document.getElementById('simpleGainMinLabel');
    const simpleGainMaxLabel = document.getElementById('simpleGainMaxLabel');
    const simpleCapInput = document.getElementById('inputSimpleCapital');
    const simpleCapSlider = document.getElementById('sliderSimpleCapital');
    const simpleGainInput = document.getElementById('inputSimpleGain');
    const simpleGainSlider = document.getElementById('sliderSimpleGain');

    if (isProp) {
        if (simpleCapitalLabelText) simpleCapitalLabelText.textContent = "Taille du Compte challenge (Prop Firm)";
        if (simpleCapMinLabel) simpleCapMinLabel.textContent = "Min: 10 000 €/$";
        if (simpleCapRecLabel) simpleCapRecLabel.textContent = "Recommandé: 50 000 €/$ +";
        if (simpleCapMaxLabel) simpleCapMaxLabel.textContent = "Max: 400 000 €/$";
        if (simpleGainMinLabel) simpleGainMinLabel.textContent = "Min: 100 €/$";
        if (simpleGainMaxLabel) simpleGainMaxLabel.textContent = "Max recommandé: 26 000 €/$";
        
        if (simpleCapInput && simpleCapSlider) {
            simpleCapInput.min = "10000"; simpleCapInput.max = "400000"; simpleCapInput.step = "5000";
            simpleCapSlider.min = "10000"; simpleCapSlider.max = "400000"; simpleCapSlider.step = "5000";
        }
        if (simpleGainInput && simpleGainSlider) {
            simpleGainInput.min = "100"; simpleGainInput.max = "26000"; simpleGainInput.step = "100";
            simpleGainSlider.min = "100"; simpleGainSlider.max = "26000"; simpleGainSlider.step = "100";
        }
    } else {
        if (simpleCapitalLabelText) simpleCapitalLabelText.textContent = "Capital total à investir";
        if (simpleCapMinLabel) simpleCapMinLabel.textContent = "Min: 500 €/$";
        if (simpleCapRecLabel) simpleCapRecLabel.textContent = "Recommandé: 2 500 €/$ +";
        if (simpleCapMaxLabel) simpleCapMaxLabel.textContent = "Max: 10 000 €/$";
        if (simpleGainMinLabel) simpleGainMinLabel.textContent = "Min: 10 €/$";
        if (simpleGainMaxLabel) simpleGainMaxLabel.textContent = "Max recommandé: 6 500 €/$";
        
        if (simpleCapInput && simpleCapSlider) {
            simpleCapInput.min = "500"; simpleCapInput.max = "10000"; simpleCapInput.step = "100";
            simpleCapSlider.min = "500"; simpleCapSlider.max = "10000"; simpleCapSlider.step = "100";
        }
        if (simpleGainInput && simpleGainSlider) {
            simpleGainInput.min = "10"; simpleGainInput.max = "6500"; simpleGainInput.step = "10";
            simpleGainSlider.min = "10"; simpleGainSlider.max = "6500"; simpleGainSlider.step = "10";
        }
    }

    const calcBalance = isProp ? balance : Math.max(1000, balance);
    const maxAllowedDollars = Math.ceil(calcBalance * (maxDailyProfitTargetPct / 100) * 100) / 100;
    const minAllowedDollars = Math.round(calcBalance * (0.1 / 100) * 100) / 100;

    let dailyProfitTarget = parseFloat(cfg.daily_profit_target);
    if (isNaN(dailyProfitTarget) || dailyProfitTarget === 0 || dailyProfitTarget < minAllowedDollars) {
        dailyProfitTarget = maxAllowedDollars;
    }

    // Update config inputs (only if not focused)
    setInputIfUnfocused('inputLotMult',   lotMult.toFixed(2));
    setInputIfUnfocused('inputDailyProfitTarget', dailyProfitTarget.toFixed(2));
    
    const limitLabelEl = document.getElementById('dailyProfitLimitLabel');
    if (limitLabelEl) {
        limitLabelEl.textContent = `Limite max : ${maxAllowedDollars.toFixed(2)} $ (${maxDailyProfitTargetPct.toFixed(2)}%)`;
    }

    // Summary sidebar
    const summaryLotEl = document.getElementById('summaryLot');
    if (summaryLotEl) summaryLotEl.textContent = lotMult.toFixed(2) + 'x';

    // Stripe validation check across all accounts
    let isUserSubscribed = false;
    for (const accId in loadedAccounts) {
        const a = loadedAccounts[accId];
        if (a && a.config && a.config.stripe_status === 'active') {
            isUserSubscribed = true;
            break;
        }
    }


    const isBypassed = cfg.bypass_payment === true;
    const isPaidOrBypassed = isUserSubscribed || isBypassed;

    // Update active monthly price and Stripe card visibility
    const stripeBillingCard = document.getElementById('stripeBillingCard');
    if (stripeBillingCard) {
        if (isBypassed) {
            stripeBillingCard.style.display = 'none';
        } else {
            stripeBillingCard.style.display = 'block';
            
            // Update monthly price
            const monthlyPriceEl = document.getElementById('configActiveMonthlyPrice');
            if (monthlyPriceEl) {
                monthlyPriceEl.textContent = monthlyPrice.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €';
            }
            
            // Update status badge
            const statusBadge = document.getElementById('stripeStatusBadge');
            const btnCheckout = document.getElementById('btnStripeCheckout');
            const btnPortal = document.getElementById('btnStripePortal');
            const testModeContainer = document.getElementById('stripeTestModeContainer');
            
            const stripeStatus = cfg.stripe_status || 'unpaid';
            
            if (isUserSubscribed) {
                if (statusBadge) {
                    statusBadge.textContent = 'Actif';
                    statusBadge.style.backgroundColor = 'rgba(0, 255, 136, 0.1)';
                    statusBadge.style.color = '#00ff88';
                }
                if (btnCheckout) btnCheckout.style.display = 'none';
                if (btnPortal) btnPortal.style.display = 'block';
                if (testModeContainer) testModeContainer.style.display = 'none';
            } else {
                if (statusBadge) {
                    statusBadge.textContent = stripeStatus === 'canceled' ? 'Résilie / Inactif' : 'Non Payé';
                    statusBadge.style.backgroundColor = 'rgba(255, 68, 68, 0.1)';
                    statusBadge.style.color = '#ff4444';
                }
                if (btnCheckout) btnCheckout.style.display = 'block';
                if (btnPortal) btnPortal.style.display = cfg.stripe_customer_id ? 'block' : 'none';
                if (testModeContainer) testModeContainer.style.display = 'flex';
            }
        }
    }

    // ── Admin suspension banner + client toggle ──
    const banner        = document.getElementById('suspensionBanner');
    const toggleWrapper = document.getElementById('clientToggleWrapper');
    const toggleCheck   = document.getElementById('checkClientEnabled');
    const toggleSubEl   = document.querySelector('#clientToggleWrapper .toggle-sub');

    if (!adminOn) {
        if (banner)        banner.style.display        = 'flex';
        if (toggleWrapper) toggleWrapper.classList.add('disabled');
        if (toggleCheck) {
            toggleCheck.checked  = false;
            toggleCheck.disabled = true;
        }
        if (toggleSubEl) toggleSubEl.textContent = "Suspendu par l'administration";
    } else if (!isPaidOrBypassed) {
        if (banner)        banner.style.display        = 'none';
        if (toggleWrapper) toggleWrapper.classList.add('disabled');
        if (toggleCheck) {
            toggleCheck.checked  = false;
            toggleCheck.disabled = true;
        }
        if (toggleSubEl) toggleSubEl.textContent = "Abonnement requis pour activer";
    } else {
        if (banner)        banner.style.display = 'none';
        if (toggleWrapper) toggleWrapper.classList.remove('disabled');
        if (toggleCheck) {
            toggleCheck.disabled = false;
            toggleCheck.checked  = clientOn;
        }
        if (toggleSubEl) toggleSubEl.textContent = "Activer ou suspendre votre trading";
    }

    // ── Status computation ──
    let statusClass = 'waiting';
    let badgeText   = 'En attente';
    let mainText    = 'En attente des prochaines positions';
    let descText    = "Le robot est actif et surveille les opportunités de marché.";

    if (!adminOn) {
        statusClass = 'suspended';
        badgeText   = 'Suspendu (Admin)';
        mainText    = 'Suspendu par l\'administration';
        descText    = "Votre compte a été temporairement suspendu. Contactez le support.";
    } else if (!clientOn) {
        statusClass = 'suspended';
        badgeText   = 'Trading désactivé';
        mainText    = 'Trading désactivé par le client';
        descText    = "Vous avez désactivé le trading. Réactivez-le dans Configuration.";
    } else {
        const equity      = parseFloat(acc.equity)   || balance;
        const inTrade     = Math.abs(equity - balance) > 0.05;

        if (inTrade) {
            statusClass = 'active-trade';
            badgeText   = 'En cours de trade';
            mainText    = 'Position ouverte en cours';
            descText    = "Une position est actuellement active sur votre compte.";
        }
    }

    const badgeEl = document.getElementById('statusBadge');
    if (badgeEl) {
        badgeEl.className = 'status-badge ' + statusClass;
        const badgeTextEl = document.getElementById('statusBadgeText');
        if (badgeTextEl) badgeTextEl.textContent = badgeText;
    }
    const mainEl = document.getElementById('statusMain');
    if (mainEl) mainEl.textContent = mainText;
    const descEl = document.getElementById('statusDesc');
    if (descEl) descEl.textContent = descText;

    // ── History & Chart ──
    renderHistory(acc.history || []);
    renderDailyHistory(acc.history || [], parseFloat(acc.balance) || 0);
    updateTimeframe(currentTimeframe);
}

function setInputIfUnfocused(id, value) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = value;
}

// ─────────────────────────────────────────
// TOGGLE CHANGE
// ─────────────────────────────────────────
function onToggleChange() {

    const acc = loadedAccounts[currentAccountId];
    if (acc) {
        const balance = parseFloat(acc.balance) || 0;
        const equity = parseFloat(acc.equity) || balance;
        const inTrade = Math.abs(equity - balance) > 0.05;
        const toggleCheck = document.getElementById('checkClientEnabled');
        
        if (inTrade && toggleCheck && !toggleCheck.checked) {
            // Re-check the box
            toggleCheck.checked = true;
            showToast("Action refusée : Impossible de désactiver le trading automatique avec des positions ouvertes sur MT5 pour protéger votre capital.", "error");
        }
    }
}

// ─────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────
function renderHistory(history) {
    const list = document.getElementById('historyList');
    if (!list) return;

    const items = history.slice(0, historyLimit);

    list.innerHTML = items.length
        ? items.map(h => {
            const isPos = h.isPositive;
            return `
                <div class="grid grid-cols-6 gap-2 py-3.5 text-xs text-slate-300 border-b border-white/5 hover:bg-white/[0.02] transition items-center px-2">
                    <span class="font-mono text-amber-400 font-semibold">#${h.id}</span>
                    <span class="text-slate-400 font-light">${h.date}</span>
                    <span class="text-slate-400 font-light font-mono">${h.duration}</span>
                    <span class="${h.type === 'BUY' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20'} font-bold text-[10px] tracking-wider border px-2 py-0.5 rounded-md w-max text-center">${h.type}</span>
                    <span class="font-semibold text-white font-mono">${h.symbol}</span>
                    <b class="${isPos ? 'profit-pos' : 'profit-neg'} text-right font-mono font-bold">${h.resultStr}</b>
                </div>
            `;
        }).join('')
        : `<div style="text-align:center; padding:40px; color:var(--text-dim); font-size:13px;">Aucune transaction disponible.</div>`;

    const btnMore = document.getElementById('btnLoadMore');
    if (btnMore) {
        btnMore.style.display = (history.length > historyLimit) ? 'inline-block' : 'none';
    }
}

function loadMore() {
    historyLimit += 20;
    const acc = loadedAccounts[currentAccountId];
    if (acc) renderHistory(acc.history || []);
}

// ─────────────────────────────────────────
// TIMEFRAME & CHART
// ─────────────────────────────────────────
function updateTimeframe(tf) {
    currentTimeframe = tf;

    document.querySelectorAll('.btn-tf').forEach(b => {
        const onclick = b.getAttribute('onclick') || '';
        const match   = onclick.match(/updateTimeframe\('(.+?)'\)/);
        const btnTf   = match ? match[1] : null;
        b.classList.toggle('active', btnTf === tf);
    });

    const acc = loadedAccounts[currentAccountId];
    if (acc) {
        const points = calculateChart(acc.history || [], parseFloat(acc.balance) || 0);
        renderChart(points);
    }
}

function calculateChart(history, finalBalance) {
    const now = new Date();
    let limitDate = new Date();
    let isHourly  = false;

    if      (currentTimeframe === '1D') { limitDate.setDate(now.getDate() - 1);  isHourly = true; }
    else if (currentTimeframe === '1W') { limitDate.setDate(now.getDate() - 7);  }
    else if (currentTimeframe === '1M') { limitDate.setDate(now.getDate() - 30); }
    else if (currentTimeframe === '3M') { limitDate.setDate(now.getDate() - 90); }

    const filtered = history.filter(h => parseDate(h.date) >= limitDate);

    let buckets = {};
    filtered.forEach(h => {
        const d   = parseDate(h.date);
        const key = isHourly ? `${d.getHours()}h` : `${d.getDate()}/${d.getMonth() + 1}`;
        if (!buckets[key]) buckets[key] = 0;
        buckets[key] += parseFloat(String(h.resultStr).replace('$', '').replace('+', '')) || 0;
    });

    let current = finalBalance;
    let points  = [{ x: 'Maintenant', y: current }];

    const keys = Object.keys(buckets).sort((a, b) => {
        if (isHourly) return parseInt(b) - parseInt(a);
        const parseKey = k => {
            const parts = k.split('/');
            return new Date(new Date().getFullYear(), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        };
        return parseKey(b) - parseKey(a);
    });

    keys.forEach(k => {
        current -= buckets[k];
        points.unshift({ x: k, y: parseFloat(current.toFixed(2)) });
    });

    return points;
}

function renderChart(points) {
    const canvas = document.getElementById('performanceChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (currentChart) currentChart.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 360);
    gradient.addColorStop(0,   'rgba(224, 17, 95, 0.18)');
    gradient.addColorStop(1,   'rgba(224, 17, 95, 0.00)');

    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: points.map(p => p.x),
            datasets: [{
                data: points.map(p => p.y),
                borderColor:     '#E0115F',
                borderWidth:     2,
                fill:            true,
                backgroundColor: gradient,
                tension:         0.35,
                pointRadius:     points.length > 30 ? 0 : 3,
                pointBackgroundColor: '#E0115F',
                pointBorderColor:    'transparent',
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,10,15,0.9)',
                    borderColor: 'rgba(224,17,95,0.3)',
                    borderWidth: 1,
                    titleColor: '#E0115F',
                    bodyColor: '#e4e4e7',
                    padding: 12,
                    callbacks: {
                        label: ctx => ' $' + ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2 })
                    }
                }
            },
            scales: {
                y: {
                    grid:  { color: 'rgba(255,255,255,0.03)' },
                    ticks: { color: '#71717a', font: { size: 11 }, callback: v => '$' + v.toLocaleString() }
                },
                x: {
                    grid:  { display: false },
                    ticks: { color: '#71717a', font: { size: 11 }, maxTicksLimit: 8 }
                }
            }
        }
    });
}

// ─────────────────────────────────────────
// SAVE CONFIG
// ─────────────────────────────────────────
async function saveConfig() {

    const lot_multiplier      = parseFloat(document.getElementById('inputLotMult').value)    || 1.0;
    const client_enabled      = document.getElementById('checkClientEnabled').checked;
    const daily_profit_target = parseFloat(document.getElementById('inputDailyProfitTarget').value) || 0.0;

    const acc = loadedAccounts[currentAccountId];
    if (acc) {
        const balance = parseFloat(acc.balance) || 0;
        const equity = parseFloat(acc.equity) || balance;
        const inTrade = Math.abs(equity - balance) > 0.05;
        
        if (inTrade && !client_enabled) {
            // Force checkbox back to checked
            const toggleCheck = document.getElementById('checkClientEnabled');
            if (toggleCheck) toggleCheck.checked = true;
            
            return showToast("Action refusée : Impossible de désactiver le trading automatique avec des positions ouvertes sur MT5 pour protéger votre capital.", "error");
        }

        // Validate daily profit target limit
        const cfg = acc.config || {};
        let maxDailyProfitTargetPct = 1.25;
        if (cfg.max_daily_profit_target_pct !== undefined && cfg.max_daily_profit_target_pct !== null) {
            const parsedPct = parseFloat(cfg.max_daily_profit_target_pct);
            if (!isNaN(parsedPct)) {
                maxDailyProfitTargetPct = parsedPct;
            }
        }
        const isProp = (maxDailyProfitTargetPct <= 0.65);
        const calcBalance = isProp ? balance : Math.max(1000, balance);
        const maxAllowedDollars = Math.ceil(calcBalance * (maxDailyProfitTargetPct / 100) * 100) / 100;
        const minAllowedDollars = Math.round(calcBalance * (0.1 / 100) * 100) / 100;

        if (daily_profit_target === 0 || daily_profit_target < minAllowedDollars) {
            return showToast(`Action refusée : L'objectif de profit journalier ne peut pas être désactivé (0) ou être inférieur à 0.1% de votre solde (${minAllowedDollars.toFixed(2)} $).`, "error");
        }

        if (daily_profit_target > maxAllowedDollars) {
            return showToast(`Action refusée : Votre objectif de profit journalier (${daily_profit_target.toFixed(2)} $) ne peut pas dépasser la limite maximale autorisée (${maxAllowedDollars.toFixed(2)} $).`, "error");
        }
    }

    const payload = {
        email:      currentUser.email,
        account_id: currentAccountId,
        config: {
            lot_multiplier,
            client_enabled,
            daily_profit_target
        }
    };

    try {
        const res  = await fetch(`${API_URL}/update-config`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert("Configuration sauvegardée !");
            await loadData();
        } else {
            alert("Erreur : " + data.message);
        }
    } catch (e) {
        console.error("Save config error:", e);
        alert("Sauvegarde échouée.");
    }
}

// ─────────────────────────────────────────
// PARTIE BOT: GRILLE DE SELECTION & CONFIGURATEUR DYNAMIQUE
// ─────────────────────────────────────────
// State variables for RubiX Bot Configurator
let mitsuCapType = 'perso'; // 'perso' or 'propfirm'
let mitsuPlan = 'low'; // 'low', 'normal', 'extreme'
let mitsuRegion = 'EU'; // 'EU' or 'AF'
let mitsuChart = null;

// State variables for Lion X Configurator
let lionLicenseType = 'partner'; // 'partner' or 'paid'
let lionChart = null;

function setMitsuRegion(region) {
    mitsuRegion = region;
    
    // Update active state of region buttons (RubiX Bot)
    const btnEU = document.getElementById('btnRegionEU');
    const btnAF = document.getElementById('btnRegionAF');
    if (btnEU) btnEU.classList.toggle('active', region === 'EU');
    if (btnAF) btnAF.classList.toggle('active', region === 'AF');

    // Update active state of region buttons (Lion X)
    const btnLionEU = document.getElementById('btnLionRegionEU');
    const btnLionAF = document.getElementById('btnLionRegionAF');
    if (btnLionEU) btnLionEU.classList.toggle('active', region === 'EU');
    if (btnLionAF) btnLionAF.classList.toggle('active', region === 'AF');
    
    const isEU = (region === 'EU');
    const symbol = isEU ? '€' : '$';
    
    // Update RubiX Bot pricing labels in cards
    document.getElementById('valMitsuLowPrice').textContent = isEU ? '300€' : '300$';
    document.getElementById('valMitsuNormalPrice').textContent = isEU ? '700€' : '700$';
    document.getElementById('valMitsuExtremePrice').textContent = isEU ? '1000€' : '1000$';
    
    safeSetText('valMitsuLowAdd', '');
    safeSetText('valMitsuNormalAdd', '');
    safeSetText('valMitsuExtremeAdd', '');
    
    const labelAdd = document.getElementById('mitsuAccountsAddLabel');
    if (labelAdd) {
        labelAdd.textContent = '';
    }

    // Update Lion X pricing labels
    const valLionPaidPrice = document.getElementById('valLionPaidPrice');
    if (valLionPaidPrice) valLionPaidPrice.textContent = isEU ? '300€' : '300$';
    const valLionPaidPriceSub = document.getElementById('valLionPaidPriceSub');
    if (valLionPaidPriceSub) valLionPaidPriceSub.textContent = isEU ? '300€' : '300$';
    safeSetText('valLionPaidAdd', '');
    
    const lionLabelAdd = document.getElementById('lionAccountsAddLabel');
    if (lionLabelAdd) {
        lionLabelAdd.textContent = '';
    }
    
    updateMitsuCalculator();
    updateLionCalculator();
}

function selectBot(botId) {
    selectedBotId = botId;
    
    document.getElementById('botSelectionStage').style.display = 'none';
    
    if (botId === 'rubix') {
        const rubixStage = document.getElementById('rubixConfiguratorStage');
        if (rubixStage) rubixStage.style.display = 'block';
        const lionxStage = document.getElementById('lionxConfiguratorStage');
        if (lionxStage) lionxStage.style.display = 'none';
        setTimeout(() => {
            initMitsuConfigurator();
            if (typeof initCustomSelects === 'function') {
                initCustomSelects();
            }
        }, 50);
    } else if (botId === 'lionx') {
        const rubixStage = document.getElementById('rubixConfiguratorStage');
        if (rubixStage) rubixStage.style.display = 'none';
        const lionxStage = document.getElementById('lionxConfiguratorStage');
        if (lionxStage) lionxStage.style.display = 'block';
        setTimeout(() => {
            initLionConfigurator();
            if (typeof initCustomSelects === 'function') {
                initCustomSelects();
            }
        }, 50);
    }
}

function activateFolder(bot) {
    const cardMitsu = document.getElementById('tutoSynapXCard') || document.getElementById('tutoRubiXCard');
    const cardLion = document.getElementById('tutoLionXCard');
    if (!cardMitsu || !cardLion) return;
    
    if (bot === 'rubix') {
        cardMitsu.classList.remove('inactive-folder');
        cardMitsu.classList.add('active-folder');
        
        cardLion.classList.remove('active-folder');
        cardLion.classList.add('inactive-folder');
    } else if (bot === 'lionx') {
        cardLion.classList.remove('inactive-folder');
        cardLion.classList.add('active-folder');
        
        cardMitsu.classList.remove('active-folder');
        cardMitsu.classList.add('inactive-folder');
    }
}

function goBackToSelection() {
    selectedBotId = null;
    const rubixStage = document.getElementById('rubixConfiguratorStage');
    if (rubixStage) rubixStage.style.display = 'none';
    const lionxStage = document.getElementById('lionxConfiguratorStage');
    if (lionxStage) lionxStage.style.display = 'none';
    const selectionStage = document.getElementById('botSelectionStage');
    if (selectionStage) selectionStage.style.display = 'block';
}

function initMitsuConfigurator() {
    mitsuCapType = 'perso';
    mitsuPlan = 'low';
    mitsuRegion = 'EU';
    document.getElementById('mitsuAccountsCount').value = 1;
    document.getElementById('mitsuSimCapital').value = 1000;
    if (document.getElementById('mitsuBrokerChoice')) {
        document.getElementById('mitsuBrokerChoice').value = 'partner_vantage';
    }
    
    // Reset buttons
    const btnEU = document.getElementById('btnRegionEU');
    const btnAF = document.getElementById('btnRegionAF');
    if (btnEU) btnEU.classList.add('active');
    if (btnAF) btnAF.classList.remove('active');
    
    const btnLionEU = document.getElementById('btnLionRegionEU');
    const btnLionAF = document.getElementById('btnLionRegionAF');
    if (btnLionEU) btnLionEU.classList.add('active');
    if (btnLionAF) btnLionAF.classList.remove('active');
    
    // Reset pricing labels in cards
    document.getElementById('valMitsuLowPrice').textContent = '300€';
    document.getElementById('valMitsuNormalPrice').textContent = '700€';
    document.getElementById('valMitsuExtremePrice').textContent = '1000€';
    safeSetText('valMitsuLowAdd', '');
    safeSetText('valMitsuNormalAdd', '');
    safeSetText('valMitsuExtremeAdd', '');
    
    const labelAdd = document.getElementById('mitsuAccountsAddLabel');
    if (labelAdd) {
        labelAdd.textContent = '';
    }

    const valLionPaidPrice = document.getElementById('valLionPaidPrice');
    if (valLionPaidPrice) valLionPaidPrice.textContent = '300€';
    const valLionPaidPriceSub = document.getElementById('valLionPaidPriceSub');
    if (valLionPaidPriceSub) valLionPaidPriceSub.textContent = '300€';
    safeSetText('valLionPaidAdd', '');
    const lionLabelAdd = document.getElementById('lionAccountsAddLabel');
    if (lionLabelAdd) {
        lionLabelAdd.textContent = '';
    }
    
    switchMitsuCapType('perso');
    selectMitsuPlan('low');
}

function initLionConfigurator() {
    if (!document.getElementById('lionxAccountsCount')) return;
    lionLicenseType = 'partner';
    document.getElementById('lionxAccountsCount').value = 1;
    document.getElementById('lionSimCapital').value = 1000;
    
    // Reset buttons
    const isEU = (mitsuRegion === 'EU');
    const symbol = isEU ? '€' : '$';
    const btnLionEU = document.getElementById('btnLionRegionEU');
    const btnLionAF = document.getElementById('btnLionRegionAF');
    if (btnLionEU) btnLionEU.classList.toggle('active', isEU);
    if (btnLionAF) btnLionAF.classList.toggle('active', !isEU);
    
    const valLionPaidPrice = document.getElementById('valLionPaidPrice');
    if (valLionPaidPrice) valLionPaidPrice.textContent = isEU ? '300€' : '300$';
    const valLionPaidPriceSub = document.getElementById('valLionPaidPriceSub');
    if (valLionPaidPriceSub) valLionPaidPriceSub.textContent = isEU ? '300€' : '300$';
    safeSetText('valLionPaidAdd', '');
    const lionLabelAdd = document.getElementById('lionAccountsAddLabel');
    if (lionLabelAdd) {
        lionLabelAdd.textContent = '';
    }
    
    selectLionLicense('partner');
}

function switchMitsuCapType(type) {
    mitsuCapType = type;
    document.getElementById('tabMitsuPerso').classList.toggle('active', type === 'perso');
    document.getElementById('tabMitsuProp').classList.toggle('active', type === 'propfirm');
    document.getElementById('mitsuPropShareRow').style.display = (type === 'propfirm') ? 'flex' : 'none';
    updateMitsuCalculator();
}

function selectMitsuPlan(plan) {
    mitsuPlan = plan;
    document.getElementById('cardMitsuLow').classList.toggle('active', plan === 'low');
    document.getElementById('cardMitsuNormal').classList.toggle('active', plan === 'normal');
    document.getElementById('cardMitsuExtreme').classList.toggle('active', plan === 'extreme');
    updateMitsuCalculator();
}

function updateMitsuCalculator() {
    const isEU = (mitsuRegion === 'EU');
    const symbol = isEU ? '€' : '$';
    
    let basePrice = 300;
    if (mitsuPlan === 'normal') basePrice = 700;
    else if (mitsuPlan === 'extreme') basePrice = 1000;
    
    const totalPrice = basePrice;
    
    document.getElementById('mitsuSummaryBasePrice').textContent = basePrice.toFixed(2) + " " + symbol;
    document.getElementById('mitsuSummaryTotalPrice').textContent = totalPrice.toFixed(2) + " " + symbol;
    
    // Update labels in cards dynamically
    const valMitsuLowAdd = document.getElementById('valMitsuLowAdd');
    if (valMitsuLowAdd) valMitsuLowAdd.textContent = '';
    const valMitsuNormalAdd = document.getElementById('valMitsuNormalAdd');
    if (valMitsuNormalAdd) valMitsuNormalAdd.textContent = '';
    const valMitsuExtremeAdd = document.getElementById('valMitsuExtremeAdd');
    if (valMitsuExtremeAdd) valMitsuExtremeAdd.textContent = '';
    
    const labelAdd = document.getElementById('mitsuAccountsAddLabel');
    if (labelAdd) {
        labelAdd.textContent = '';
    }
    
    // Simulation
    let minCap = 500;
    let maxCap = 2500;
    let stepCap = 100;

    if (mitsuCapType === 'propfirm') {
        minCap = 10000;
        maxCap = 400000;
        stepCap = 5000;
    } else {
        if (mitsuPlan === 'normal') maxCap = 5000;
        else if (mitsuPlan === 'extreme') maxCap = 10000;
    }

    const capInput = document.getElementById('mitsuSimCapital');
    if (capInput) {
        capInput.min = minCap;
        capInput.max = maxCap;
        capInput.step = stepCap;
    }

    const labelTitle = document.getElementById('mitsuSimLabelTitle');
    const labelDesc = document.getElementById('mitsuSimLabelDesc');
    if (mitsuCapType === 'propfirm') {
        if (labelTitle) labelTitle.textContent = "Capital sous mandat (Prop Firm) pour simulation";
        if (labelDesc) labelDesc.textContent = "Capital de votre compte Prop Firm";
    } else {
        if (labelTitle) labelTitle.textContent = "Capital initial (Broker) pour simulation";
        if (labelDesc) labelDesc.textContent = "€/$ déposés chez votre broker";
    }

    let capital = parseFloat(document.getElementById('mitsuSimCapital').value);
    if (isNaN(capital)) {
        capital = (mitsuCapType === 'propfirm') ? 50000 : 1000;
    }
    if (capital < minCap) {
        capital = minCap;
        if (capInput) capInput.value = minCap;
    } else if (capital > maxCap) {
        capital = maxCap;
        if (capInput) capInput.value = maxCap;
    }
    
    let monthlyReturn = 25;
    if (mitsuPlan === 'normal') monthlyReturn = 45;
    else if (mitsuPlan === 'extreme') monthlyReturn = 65;
    
    if (mitsuCapType === 'propfirm') {
        monthlyReturn = monthlyReturn / 10;
    }
    
    let simCapital = capital;
    let dataset = [simCapital];
    let labels = ["Départ"];
    
    for (let month = 1; month <= 12; month++) {
        const basis = Math.max(1000, simCapital);
        const monthlyProfit = basis * (monthlyReturn / 100);
        simCapital += monthlyProfit;
        dataset.push(parseFloat(simCapital.toFixed(2)));
        labels.push("Mois " + month);
    }
    
    document.getElementById('mitsuSimFinalCapital').textContent = simCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " " + symbol + "/$";
    
    // Update recap fields
    const recapCap = document.getElementById('recapMitsuCapital');
    if (recapCap) recapCap.textContent = capital.toLocaleString() + ' ' + symbol;
    const recapGain = document.getElementById('recapMitsuMonthlyGain');
    const basisForRecap = Math.max(1000, capital);
    const profitInCurrency = basisForRecap * (monthlyReturn / 100);
    if (recapGain) recapGain.textContent = `~${monthlyReturn.toFixed(1)}% (~${profitInCurrency.toFixed(2)} ${symbol})`;
    const recapPrice = document.getElementById('recapMitsuUniquePrice');
    if (recapPrice) recapPrice.textContent = basePrice.toFixed(2) + ' ' + symbol;
    const recapMonthly = document.getElementById('recapMitsuMonthlyPrice');
    if (recapMonthly) recapMonthly.textContent = '0.00 ' + symbol;
    const recapCapType = document.getElementById('recapMitsuCapType');
    if (recapCapType) recapCapType.textContent = (mitsuCapType === 'propfirm') ? 'Prop Firm' : 'Personnel';
    const recapAcc = document.getElementById('recapMitsuAccounts');
    if (recapAcc) recapAcc.textContent = '1 compte';

    renderMitsuChart(labels, dataset);
    updateMitsuPlanDetails();
}

function updateMitsuPlanDetails() {
    const isProp = (mitsuCapType === 'propfirm');
    const detailsBox = document.getElementById('mitsuPlanDetailsBox');
    if (!detailsBox) return;
    
    let planTitle = "Plan Conservateur";
    let icon = "🛡️";
    let monthlyPct = isProp ? "2.5%" : "7.0% - 15.0%";
    let weeklyPct = isProp ? "0.57%" : "1.6% - 3.4%";
    let risk = isProp ? "Extrêmement Faible" : "Prudent & Modéré";
    let desc = isProp 
        ? "Configuration conçue pour passer et conserver les comptes Prop Firm sans enfreindre la limite maximale de drawdown."
        : "Idéal pour sécuriser un capital régulier avec un drawdown minimal et un risque contrôlé.";
        
    if (mitsuPlan === 'normal') {
        planTitle = "Plan Équilibré";
        icon = "⚖️";
        monthlyPct = isProp ? "4.5%" : "45.0%";
        weeklyPct = isProp ? "0.97%" : "9.7%";
        risk = isProp ? "Faible" : "Équilibré";
        desc = isProp
            ? "Profil de risque équilibré idéal pour les challenges Prop Firm avec un objectif de profit journalier confortable."
            : "Le meilleur ratio performance/risque pour accroître votre capital personnel de façon constante.";
    } else if (mitsuPlan === 'extreme') {
        planTitle = "Plan Débridé";
        icon = "⚡";
        monthlyPct = isProp ? "6.5%" : "jusqu'à 100.0%";
        weeklyPct = isProp ? "1.33%" : "jusqu'à 18.9%";
        risk = isProp ? "Modéré" : "Agressif / Fort Rendement";
        desc = isProp
            ? "Maximise les gains sur Prop Firm en poussant l'algorithme vers des objectifs élevés tout en surveillant la limite quotidienne."
            : "Conçu pour les investisseurs cherchant des performances de croissance rapides grâce aux intérêts composés maximisés.";
    }
    
    document.getElementById('mitsuDetailIcon').textContent = icon;
    document.getElementById('mitsuDetailTitle').textContent = `${planTitle} (${mitsuCapType === 'propfirm' ? 'Prop Firm' : 'Perso'})`;
    
    const listHtml = `
        <li>Objectif de profit mensuel : <strong>~${monthlyPct}</strong> par mois</li>
        <li>Objectif de profit hebdomadaire : <strong>~${weeklyPct}</strong> par semaine</li>
        <li>Niveau de risque statistique : <strong>${risk}</strong></li>
        <li>🎯 <strong>Avantage</strong> : ${desc}</li>
    `;
    document.getElementById('mitsuDetailList').innerHTML = listHtml;
}

function renderMitsuChart(labels, dataPoints) {
    const canvas = document.getElementById('mitsuSimulationChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (mitsuChart) mitsuChart.destroy();
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(224, 17, 95, 0.2)');
    gradient.addColorStop(1, 'rgba(224, 17, 95, 0.0)');
    
    mitsuChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Équité Estimée (12 Mois)',
                data: dataPoints,
                borderColor: '#E0115F',
                borderWidth: 2,
                backgroundColor: gradient,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#E0115F',
                pointBorderColor: 'rgba(255,255,255,0.8)',
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#71717a', font: { size: 9 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#71717a', font: { size: 9 } }
                }
            }
        }
    });
}

function selectLionLicense(type) {
    lionLicenseType = type;
    document.getElementById('optLionPartner').classList.toggle('active', type === 'partner');
    document.getElementById('optLionPaid').classList.toggle('active', type === 'paid');
    document.getElementById('lionPartnerBrokerSelect').style.display = (type === 'partner') ? 'block' : 'none';
    updateLionCalculator();
}

function updateLionCalculator() {
    if (!document.getElementById('lionSummaryBasePrice')) return;
    const isEU = (mitsuRegion === 'EU');
    const symbol = isEU ? '€' : '$';
    const isPartner = (lionLicenseType === 'partner');
    
    let basePrice = isPartner ? 0 : 300;
    let totalPrice = basePrice;
    
    document.getElementById('lionSummaryBasePrice').textContent = basePrice.toFixed(2) + " " + symbol;
    document.getElementById('lionSummaryTotalPrice').textContent = totalPrice.toFixed(2) + " " + symbol;
    
    // Update labels in cards dynamically
    document.getElementById('valLionPaidPrice').textContent = isEU ? '300€' : '300$';
    document.getElementById('valLionPaidPriceSub').textContent = isEU ? '300€' : '300$';
    
    const valLionPaidAdd = document.getElementById('valLionPaidAdd');
    if (valLionPaidAdd) valLionPaidAdd.textContent = '';
    
    const lionLabelAdd = document.getElementById('lionAccountsAddLabel');
    if (lionLabelAdd) {
        lionLabelAdd.textContent = '';
    }
    
    // Simulation
    let minCap = 100;
    let maxCap = 10000;
    
    const capInput = document.getElementById('lionSimCapital');
    if (capInput) {
        capInput.min = minCap;
        capInput.max = maxCap;
    }

    let capital = parseFloat(document.getElementById('lionSimCapital').value);
    if (isNaN(capital)) {
        capital = 1000;
    }
    if (capital < minCap) {
        capital = minCap;
        if (capInput) capInput.value = minCap;
    } else if (capital > maxCap) {
        capital = maxCap;
        if (capInput) capInput.value = maxCap;
    }
    
    let simCapital = capital;
    let dataset = [simCapital];
    let labels = ["Départ"];
    
    for (let week = 1; week <= 12; week++) {
        simCapital = simCapital * 1.50; // 50% growth per week
        dataset.push(parseFloat(simCapital.toFixed(2)));
        labels.push("Semaine " + week);
    }
    
    document.getElementById('lionSimFinalCapital').textContent = simCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " " + symbol + "/$";
    
    // Update recap fields
    const recapLionCap = document.getElementById('recapLionCapital');
    if (recapLionCap) recapLionCap.textContent = capital.toLocaleString() + ' ' + symbol;
    const recapLionPrice = document.getElementById('recapLionUniquePrice');
    if (recapLionPrice) recapLionPrice.textContent = basePrice.toFixed(2) + ' ' + symbol;
    const recapLionMonthly = document.getElementById('recapLionMonthlyPrice');
    if (recapLionMonthly) recapLionMonthly.textContent = '0.00 ' + symbol;
    const recapLionType = document.getElementById('recapLionType');
    if (recapLionType) recapLionType.textContent = isPartner ? 'Partenaire (Gratuit)' : 'Licence Fixe';
    const recapLionAcc = document.getElementById('recapLionAccounts');
    if (recapLionAcc) recapLionAcc.textContent = '1 compte';

    renderLionChart(labels, dataset);
}

function renderLionChart(labels, dataPoints) {
    const canvas = document.getElementById('lionSimulationChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (lionChart) lionChart.destroy();
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(224, 17, 95, 0.25)');
    gradient.addColorStop(1, 'rgba(224, 17, 95, 0.0)');
    
    lionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Équité Estimée (12 Semaines)',
                data: dataPoints,
                borderColor: '#E0115F',
                borderWidth: 2,
                backgroundColor: gradient,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#E0115F',
                pointBorderColor: 'rgba(255,255,255,0.8)',
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#71717a', font: { size: 9 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#71717a', font: { size: 9 } }
                }
            }
        }
    });
}

function sendCustomBotOrderTelegram(botName) {
    let message = `Bonjour YSESTP, je souhaite activer le robot : ${botName}.\n`;
    if (botName === 'RubiX Bot') {
        const capitalType = mitsuCapType === 'perso' ? 'Personnel' : 'Prop Firm';
        const plan = mitsuPlan === 'low' ? 'Low Cost' : mitsuPlan === 'normal' ? 'Normal' : 'Extreme';
        const total = document.getElementById('mitsuSummaryTotalPrice').textContent;
        message += `- Type de Capital : ${capitalType}\n- Plan choisi : ${plan}\n- Prix Unique : ${total}\n`;
    } else {
        const license = lionLicenseType === 'partner' ? 'Partenariat Courtier' : 'Licence Payante (Hors partenariat)';
        const total = document.getElementById('lionSummaryTotalPrice').textContent;
        const broker = document.getElementById('lionBrokerChoice') ? document.getElementById('lionBrokerChoice').value : 'Vantage';
        message += `- Type de Licence : ${license}\n- Prix Unique : ${total}\n`;
        if (lionLicenseType === 'partner') {
            message += `- Broker choisi : ${broker}\n`;
        }
    }
    
    const telegramUrl = `https://t.me/ysestp?text=${encodeURIComponent(message)}`;
    window.open(telegramUrl, '_blank');
}

function switchCapitalType(type) {
    currentCapitalType = type;
    
    const tabPerso = document.getElementById('tabCapPerso');
    const tabPropfirm = document.getElementById('tabCapPropfirm');
    const inputCapital = document.getElementById('inputBotCapital');
    const capitalLabel = document.getElementById('capitalLabelText');
    
    if (tabPerso) {
        if (type === 'perso') tabPerso.classList.add('active');
        else tabPerso.classList.remove('active');
    }
    if (tabPropfirm) {
        if (type === 'propfirm') tabPropfirm.classList.add('active');
        else tabPropfirm.classList.remove('active');
    }
    
    if (capitalLabel) {
        capitalLabel.textContent = (type === 'propfirm') ? "Taille du Compte challenge (Prop Firm)" : "Capital de Départ (Broker)";
    }
    
    if (inputCapital) {
        if (type === 'propfirm') {
            inputCapital.min = "10000";
            inputCapital.max = "400000";
            inputCapital.step = "5000";
            let val = parseFloat(inputCapital.value);
            if (isNaN(val) || val < 10000) inputCapital.value = "10000";
            else if (val > 400000) inputCapital.value = "400000";
        } else {
            inputCapital.min = "500";
            inputCapital.step = "100";
            let maxCap = 10000;
            if (currentBotMode === 'lowcost') maxCap = 2500;
            else if (currentBotMode === 'normal') maxCap = 7000;
            inputCapital.max = maxCap.toString();
            let val = parseFloat(inputCapital.value);
            if (isNaN(val) || val < 500) inputCapital.value = "500";
            else if (val > maxCap) inputCapital.value = maxCap;
        }
    }
    
    // Sync Simple Mode Form elements
    const simpleCapInput = document.getElementById('inputSimpleCapital');
    const simpleCapSlider = document.getElementById('sliderSimpleCapital');
    const simpleGainInput = document.getElementById('inputSimpleGain');
    const simpleGainSlider = document.getElementById('sliderSimpleGain');
    
    const simpleCapMinLabel = document.getElementById('simpleCapMinLabel');
    const simpleCapRecLabel = document.getElementById('simpleCapRecLabel');
    const simpleCapMaxLabel = document.getElementById('simpleCapMaxLabel');
    const simpleCapitalLabelText = document.getElementById('simpleCapitalLabelText');
    const simpleGainMinLabel = document.getElementById('simpleGainMinLabel');
    const simpleGainMaxLabel = document.getElementById('simpleGainMaxLabel');
    
    if (type === 'propfirm') {
        if (simpleCapitalLabelText) simpleCapitalLabelText.textContent = "Taille du Compte challenge (Prop Firm)";
        if (simpleCapMinLabel) simpleCapMinLabel.textContent = "Min: 10 000 €/$";
        if (simpleCapRecLabel) simpleCapRecLabel.textContent = "Recommandé: 50 000 €/$ +";
        if (simpleCapMaxLabel) simpleCapMaxLabel.textContent = "Max: 400 000 €/$";
        if (simpleGainMinLabel) simpleGainMinLabel.textContent = "Min: 100 €/$";
        if (simpleGainMaxLabel) simpleGainMaxLabel.textContent = "Max recommandé: 26 000 €/$";

        if (simpleCapInput && simpleCapSlider) {
            simpleCapInput.min = "10000";
            simpleCapInput.max = "400000";
            simpleCapInput.step = "5000";
            simpleCapSlider.min = "10000";
            simpleCapSlider.max = "400000";
            simpleCapSlider.step = "5000";
            let val = parseFloat(simpleCapInput.value);
            if (isNaN(val) || val < 10000) {
                simpleCapInput.value = "10000";
                simpleCapSlider.value = "10000";
            } else if (val > 400000) {
                simpleCapInput.value = "400000";
                simpleCapSlider.value = "400000";
            }
        }
        if (simpleGainInput && simpleGainSlider) {
            simpleGainInput.min = "100";
            simpleGainInput.max = "26000";
            simpleGainInput.step = "100";
            simpleGainSlider.min = "100";
            simpleGainSlider.max = "26000";
            simpleGainSlider.step = "100";
            let val = parseFloat(simpleGainInput.value);
            if (isNaN(val) || val < 100) {
                simpleGainInput.value = "250";
                simpleGainSlider.value = "250";
            } else if (val > 26000) {
                simpleGainInput.value = "26000";
                simpleGainSlider.value = "26000";
            }
        }
    } else {
        if (simpleCapitalLabelText) simpleCapitalLabelText.textContent = "Capital total à investir";
        if (simpleCapMinLabel) simpleCapMinLabel.textContent = "Min: 500 €/$";
        if (simpleCapRecLabel) simpleCapRecLabel.textContent = "Recommandé: 2 500 €/$ +";
        if (simpleCapMaxLabel) simpleCapMaxLabel.textContent = "Max: 10 000 €/$";
        if (simpleGainMinLabel) simpleGainMinLabel.textContent = "Min: 10 €/$";
        if (simpleGainMaxLabel) simpleGainMaxLabel.textContent = "Max recommandé: 6 500 €/$";

        if (simpleCapInput && simpleCapSlider) {
            simpleCapInput.min = "500";
            simpleCapInput.max = "10000";
            simpleCapInput.step = "100";
            simpleCapSlider.min = "500";
            simpleCapSlider.max = "10000";
            simpleCapSlider.step = "100";
            let val = parseFloat(simpleCapInput.value);
            if (isNaN(val) || val < 500) {
                simpleCapInput.value = "1000";
                simpleCapSlider.value = "1000";
            } else if (val > 10000) {
                simpleCapInput.value = "10000";
                simpleCapSlider.value = "10000";
            }
        }
        if (simpleGainInput && simpleGainSlider) {
            simpleGainInput.min = "10";
            simpleGainInput.max = "6500";
            simpleGainInput.step = "10";
            simpleGainSlider.min = "10";
            simpleGainSlider.max = "6500";
            simpleGainSlider.step = "10";
            let val = parseFloat(simpleGainInput.value);
            if (isNaN(val) || val < 10) {
                simpleGainInput.value = "200";
                simpleGainSlider.value = "200";
            } else if (val > 6500) {
                simpleGainInput.value = "6500";
                simpleGainSlider.value = "6500";
            }
        }
    }
    
    if (typeof updateGainPercentIndicator === 'function') {
        updateGainPercentIndicator();
    }
    
    switchBotMode(currentBotMode);
}

function switchBotMode(mode) {
    currentBotMode = mode;
    
    const tabLC = document.getElementById('tabBotLowCost');
    const tabNM = document.getElementById('tabBotNormal');
    const tabEX = document.getElementById('tabBotExtreme');
    const sliderProfit = document.getElementById('inputBotProfitTarget');
    const sliderPrice  = document.getElementById('inputBotInitialPrice');
    const labelProfit  = document.getElementById('profitTargetLabel');
    const capHelp = document.getElementById('capitalLimitHelp');
    
    if (tabLC) tabLC.classList.remove('active');
    if (tabNM) tabNM.classList.remove('active');
    if (tabEX) tabEX.classList.remove('active');
    
    const maxDrawdownEl = document.getElementById('advMaxDrawdown');
    const risqueDrawdownEl = document.getElementById('advRisqueDrawdown');
    const minBrokerText = document.getElementById('advMinBrokerText');
    
    const isProp = (currentCapitalType === 'propfirm');
    
    if (maxDrawdownEl) {
        maxDrawdownEl.textContent = isProp ? "3% possible" : "30% possible";
    }
    if (risqueDrawdownEl) {
        risqueDrawdownEl.textContent = (mode === 'lowcost' ? "1%" : mode === 'normal' ? "2%" : "3%") + " de probabilité";
    }
    if (minBrokerText) {
        minBrokerText.textContent = isProp ? "10 000 €/$ (obligatoire pour vous)" : "500 €/$ (obligatoire pour vous)";
    }
    
    if (mode === 'lowcost') {
        if (tabLC) tabLC.classList.add('active');
        
        sliderProfit.min = 7;
        sliderProfit.max = 15;
        let val = parseFloat(sliderProfit.value);
        if (isNaN(val) || val > 15) sliderProfit.value = 15;
        else if (val < 7) sliderProfit.value = 7;
        
        labelProfit.textContent = isProp 
            ? "Cible de Profit Mensuel (Mode Conservateur - Prop Firm)" 
            : "Cible de Profit Mensuel (Mode Conservateur)";
        
        sliderPrice.value = 300;
        
        if (capHelp) {
            capHelp.textContent = isProp
                ? "Minimum 10 000 €/$ - Maximum 400 000 €/$ pour ce mode. (Licence : 300€ unique + 25€/mois fixe pour l'hébergement, services, mises à jour et accès)"
                : "Minimum 500 €/$ - Maximum 2 500 €/$ pour ce mode. (Licence : 300€ unique + 25€/mois fixe pour l'hébergement, services, mises à jour et accès)";
        }
    } else if (mode === 'normal') {
        if (tabNM) tabNM.classList.add('active');
        
        sliderProfit.min = 10;
        sliderProfit.max = 45;
        let val = parseFloat(sliderProfit.value);
        if (isNaN(val) || val > 45) sliderProfit.value = 45;
        else if (val < 10) sliderProfit.value = 10;
        
        labelProfit.textContent = isProp 
            ? "Cible de Profit Mensuel (Mode Équilibré - Prop Firm)" 
            : "Cible de Profit Mensuel (Mode Équilibré)";
        
        sliderPrice.value = 600;
        
        if (capHelp) {
            capHelp.textContent = isProp
                ? "Minimum 10 000 €/$ - Maximum 400 000 €/$ pour ce mode. (Licence : 600€ unique + 50€/mois fixe pour l'hébergement, services, mises à jour et accès)"
                : "Minimum 500 €/$ - Maximum 7 000 €/$ pour ce mode. (Licence : 600€ unique + 50€/mois fixe pour l'hébergement, services, mises à jour et accès)";
        }
    } else if (mode === 'extreme') {
        if (tabEX) tabEX.classList.add('active');
        
        sliderProfit.min = 10;
        sliderProfit.max = 100;
        let val = parseFloat(sliderProfit.value);
        if (isNaN(val) || val > 100) sliderProfit.value = 100;
        else if (val < 10) sliderProfit.value = 10;
        
        labelProfit.textContent = isProp 
            ? "Cible de Profit Mensuel (Mode Débridé - Prop Firm)" 
            : "Cible de Profit Mensuel (Mode Débridé)";
        
        sliderPrice.value = 950;
        
        if (capHelp) {
            capHelp.textContent = isProp
                ? "Minimum 10 000 €/$ - Maximum 400 000 €/$ pour ce mode. (Licence : 950€ unique + 100€/mois fixe pour l'hébergement, services, mises à jour et accès)"
                : "Minimum 500 €/$ - Maximum 10 000 €/$ pour ce mode. (Licence : 950€ unique + 100€/mois fixe pour l'hébergement, services, mises à jour et accès)";
        }
    }
    
    updateBotCalculator();
}

function updateBotCalculator() {
    const inputCapital = document.getElementById('inputBotCapital');
    const inputProfitTarget = document.getElementById('inputBotProfitTarget');
    const inputInitialPrice = document.getElementById('inputBotInitialPrice');
    
    if (!inputCapital || !inputProfitTarget || !inputInitialPrice) return;
    
    const isProp = (currentCapitalType === 'propfirm');
    const minCapital = isProp ? 10000 : 500;
    
    // Clamp maximum capital based on mode
    let maxCapital = 10000;
    if (isProp) {
        maxCapital = 400000;
    } else {
        if (currentBotMode === 'lowcost') {
            maxCapital = 2500;
        } else if (currentBotMode === 'normal') {
            maxCapital = 7000;
        }
    }
    
    let capital = parseFloat(inputCapital.value);
    if (isNaN(capital) || capital < minCapital) {
        capital = minCapital;
        inputCapital.value = minCapital;
    }
    if (capital > maxCapital) {
        capital = maxCapital;
        inputCapital.value = maxCapital;
        if (typeof showToast === 'function') {
            showToast(`Capital limité au maximum de ${maxCapital.toLocaleString()} €/$ pour le mode ${currentBotMode === 'lowcost' ? 'Conservateur' : currentBotMode === 'normal' ? 'Équilibré' : 'Débridé'}.`, "info");
        }
    }
    
    const profitPct = parseFloat(inputProfitTarget.value);
    // Scale profit targets: divide by 10 in Prop Firm mode
    const profitPctCalc = isProp ? (profitPct / 10) : profitPct;
    const initialPrice = parseFloat(inputInitialPrice.value);
    
    const accounts = 1;
    let monthlyInfrastructureCost = 25;
    
    if (currentBotMode === 'lowcost') {
        monthlyInfrastructureCost = 25;
    } else if (currentBotMode === 'normal') {
        monthlyInfrastructureCost = 50;
    } else if (currentBotMode === 'extreme') {
        monthlyInfrastructureCost = 100;
    }
    
    // Update live text values
    document.getElementById('profitTargetVal').textContent = (isProp ? profitPctCalc.toFixed(1) : profitPct) + "%";
    document.getElementById('initialPriceVal').textContent = initialPrice + "€";
    document.getElementById('summaryBrokerCapital').textContent = capital.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €/$";
    document.getElementById('summaryInitPrice').textContent = initialPrice.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
    
    document.getElementById('summaryMonthlyPrice').textContent = monthlyInfrastructureCost.toLocaleString(undefined, {minimumFractionDigits: 2}) + " € / mois (Fixe)";
    
    // Run compound interest projection simulation and Break-Even calculations over 12 months
    let simCapital = capital * accounts;
    let dataset = [simCapital];
    let bePoints = [simCapital + initialPrice];
    
    for (let month = 1; month <= 12; month++) {
        // Base profit calculations on 1000 (or 10000 for Prop Firm) minimum
        let baseMinCap = isProp ? 10000 : 1000;
        let calcCapitalForGain = Math.max(baseMinCap, simCapital);
        let grossGain = calcCapitalForGain * (profitPctCalc / 100);
        let netGain = grossGain - monthlyInfrastructureCost;
        
        simCapital = simCapital + netGain;
        if (simCapital < 0) simCapital = 0;
        
        dataset.push(parseFloat(simCapital.toFixed(2)));
        
        let cumulativeExpenses = initialPrice + (monthlyInfrastructureCost * month);
        bePoints.push(parseFloat((capital * accounts + cumulativeExpenses).toFixed(2)));
    }
    
    const beStatusEl = document.getElementById('simBreakEvenStatus');
    if (beStatusEl) {
        beStatusEl.innerHTML = `🎯 Seuil de rentabilité (Break-Even) : Généralement dès le premier mois`;
    }
    
    // Render Simulation Chart
    renderSimulationChart(dataset, bePoints);
    
    document.getElementById('simCapitalFinal').textContent = simCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " €/$";
    
    // Recalculate affiliation simulation
    updateAffiliation();
}

function renderSimulationChart(dataPoints, bePoints) {
    const canvas = document.getElementById('simulationChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (botSimChart) botSimChart.destroy();
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(224, 17, 95, 0.2)');
    gradient.addColorStop(1, 'rgba(224, 17, 95, 0.0)');
    
    const labels = ["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"];
    
    botSimChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Capital Net Projeté",
                    data: dataPoints,
                    borderColor: '#E0115F',
                    borderWidth: 2.5,
                    fill: true,
                    backgroundColor: gradient,
                    tension: 0.35,
                    pointRadius: 3,
                    pointBackgroundColor: '#E0115F',
                    pointBorderColor: 'transparent'
                },
                {
                    label: "Seuil de Rentabilité (BE)",
                    data: bePoints,
                    borderColor: '#ef4444',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,10,15,0.95)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    titleColor: '#E0115F',
                    bodyColor: '#e4e4e7',
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(tooltipItem) {
                            const value = tooltipItem.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2 }) + ' €/$';
                            if (tooltipItem.datasetIndex === 0) {
                                return ' 📈 Capital Net : ' + value;
                            } else {
                                return ' 🎯 Seuil Rentabilité : ' + value;
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.02)' },
                    ticks: { color: '#71717a', font: { size: 10 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#71717a', font: { size: 10 } }
                }
            }
        }
    });
}

function sendBotOrderTelegram() {
    let capital = parseFloat(document.getElementById('inputBotCapital').value) || 500;
    if (capital < 500) {
        capital = 500;
        document.getElementById('inputBotCapital').value = 500;
    }
    
    // Clamp maximum capital based on mode
    let maxCapital = 10000;
    if (currentBotMode === 'lowcost') {
        maxCapital = 2500;
    } else if (currentBotMode === 'normal') {
        maxCapital = 7000;
    }
    if (capital > maxCapital) {
        capital = maxCapital;
        document.getElementById('inputBotCapital').value = maxCapital;
    }
    
    const profitPct = parseFloat(document.getElementById('inputBotProfitTarget').value);
    const initialPrice = parseFloat(document.getElementById('inputBotInitialPrice').value);
    
    let pct = 0;
    let modeText = "";
    
    if (currentBotMode === 'lowcost') {
        pct = 2.5;
        modeText = "Low Cost";
    } else if (currentBotMode === 'normal') {
        pct = 4.5;
        modeText = "Normal";
    } else if (currentBotMode === 'extreme') {
        pct = 5.0;
        modeText = "Extreme";
    }
    
    let calcCapitalForFee = Math.max(1000, capital);
    const monthlyInfrastructureCost = Math.min(1000, calcCapitalForFee * (pct / 100));
    
    const message = `Bonjour Yassine, je souhaite commander un accès personnalisé pour le RubiX Bot.

Voici mes paramètres de configuration :
- Mode de tarification : ${modeText}
- Capital broker de départ : ${capital.toLocaleString()} €/$
- Cible de profit mensuel : ${profitPct}%
- Prix fixe initial d'accès : ${initialPrice.toFixed(2)} €
- Hébergement, maintenance & infrastructure : ${monthlyInfrastructureCost.toFixed(2)} € / mois (${pct.toFixed(2)}% du capital)
- Coût mensuel total : ${monthlyInfrastructureCost.toFixed(2)} € / mois

Merci de préparer mon accès VIP et de m'indiquer la marche à suivre !`;
    
    const telegramUrl = `https://t.me/ysestp?text=${encodeURIComponent(message)}`;
    window.open(telegramUrl, '_blank');
}

function updateAffiliation() {
    const inputBuyers = document.getElementById('inputAffBuyers');
    const inputBuyersNum = document.getElementById('inputAffBuyersNum');
    const inputInitialPrice = document.getElementById('inputBotInitialPrice');
    
    if (!inputBuyers || !inputBuyersNum || !inputInitialPrice) return;
    
    let buyers = parseInt(inputBuyers.value);
    if (isNaN(buyers) || buyers < 1) {
        buyers = 1;
    }
    
    // Sync slider value to text input
    inputBuyersNum.value = buyers;
    
    // Get initial price of the bot
    const initialPrice = parseFloat(inputInitialPrice.value) || 0;
    
    // Commission rates
    const rateParticulier = 0.23;
    const rateCommunity = 0.30;
    
    // Commission per sale
    const commParticulierPerSale = initialPrice * rateParticulier;
    const commCommunityPerSale = initialPrice * rateCommunity;
    
    // Total gross earnings
    const totalParticulier = commParticulierPerSale * buyers;
    const totalCommunity = commCommunityPerSale * buyers;
    
    // Update UI elements
    const affBuyersVal = document.getElementById('affBuyersVal');
    if (affBuyersVal) {
        affBuyersVal.textContent = buyers + (buyers > 1 ? " personnes" : " personne");
    }
    
    const affBotPriceVal = document.getElementById('affBotPriceVal');
    if (affBotPriceVal) {
        affBotPriceVal.textContent = initialPrice.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
    }
    
    const affParticulierPerSale = document.getElementById('affParticulierPerSale');
    if (affParticulierPerSale) {
        affParticulierPerSale.textContent = commParticulierPerSale.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
    }
    
    const affParticulierTotal = document.getElementById('affParticulierTotal');
    if (affParticulierTotal) {
        affParticulierTotal.textContent = totalParticulier.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
    }
    
    const affCommunityPerSale = document.getElementById('affCommunityPerSale');
    if (affCommunityPerSale) {
        affCommunityPerSale.textContent = commCommunityPerSale.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
    }
    
    const affCommunityTotal = document.getElementById('affCommunityTotal');
    if (affCommunityTotal) {
        affCommunityTotal.textContent = totalCommunity.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
    }
    
    // Toggle locking overlay for Community tier (minimum 50 buyers)
    const communityLockOverlay = document.getElementById('communityLockOverlay');
    if (communityLockOverlay) {
        if (buyers < 50) {
            communityLockOverlay.style.opacity = '1';
            communityLockOverlay.style.pointerEvents = 'all';
        } else {
            communityLockOverlay.style.opacity = '0';
            communityLockOverlay.style.pointerEvents = 'none';
        }
    }
}

function updateAffiliationNum() {
    const inputBuyers = document.getElementById('inputAffBuyers');
    const inputBuyersNum = document.getElementById('inputAffBuyersNum');
    
    if (!inputBuyers || !inputBuyersNum) return;
    
    let buyers = parseInt(inputBuyersNum.value);
    if (isNaN(buyers) || buyers < 1) {
        buyers = 1;
    }
    
    // Sync text input value back to slider
    inputBuyers.value = buyers;
    
    // Recalculate
    updateAffiliation();
}

function sendAffiliationTelegram() {
    let capital = parseFloat(document.getElementById('inputBotCapital').value) || 500;
    if (capital < 500) {
        capital = 500;
    }
    
    // Clamp maximum capital based on mode
    let maxCapital = 10000;
    if (currentBotMode === 'lowcost') {
        maxCapital = 2500;
    } else if (currentBotMode === 'normal') {
        maxCapital = 7000;
    }
    if (capital > maxCapital) {
        capital = maxCapital;
    }
    
    const profitPct = parseFloat(document.getElementById('inputBotProfitTarget').value);
    const initialPrice = parseFloat(document.getElementById('inputBotInitialPrice').value);
    const buyers = parseInt(document.getElementById('inputAffBuyers').value) || 1;
    
    let modeText = "";
    if (currentBotMode === 'lowcost') {
        modeText = "Low Cost";
    } else if (currentBotMode === 'normal') {
        modeText = "Normal";
    } else if (currentBotMode === 'extreme') {
        modeText = "Extreme";
    }
    
    const isCommunity = (buyers >= 50);
    const rate = isCommunity ? 0.30 : 0.23;
    const commPerSale = initialPrice * rate;
    const totalComm = commPerSale * buyers;
    const typeLabel = isCommunity ? "Gérant de Communauté (Grande Échelle - 30%)" : "Particulier (Recommandation individuelle - 23%)";
    
    const message = `Bonjour Yassine, je souhaite commercialiser le bot avec ce tarif là pour vous en tant que ${isCommunity ? 'gérant de communauté à grande échelle' : 'particulier'}.

Voici les détails de ma configuration de bot cible :
- Robot sélectionné : RubiX Bot
- Mode de tarification : ${modeText}
- Capital broker de départ : ${capital.toLocaleString()} €/$
- Cible de profit mensuel : ${profitPct}%
- Prix fixe initial d'accès de simulation : ${initialPrice.toFixed(2)} €

Détails de ma simulation d'affiliation :
- Profil d'affilié : ${typeLabel}
- Estimation d'acheteurs : ${buyers} ${buyers > 1 ? 'personnes' : 'personne'}
- Commission par vente : ${commPerSale.toFixed(2)} € (soit ${(rate * 100)}% du prix fixe initial)
- Gain total brut simulé : ${totalComm.toFixed(2)} € brut

Merci de me recontacter pour valider mon accès affilié et configurer mes liens de parrainage !`;
    
    const telegramUrl = `https://t.me/ysestp?text=${encodeURIComponent(message)}`;
    window.open(telegramUrl, '_blank');
}

function toggleAccordion(accId) {
    const content = document.getElementById(accId);
    const arrow = document.getElementById('arrow_' + accId);
    if (!content || !arrow) return;
    
    if (content.style.maxHeight && content.style.maxHeight !== '0px') {
        content.style.maxHeight = '0px';
        arrow.textContent = '＋';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        arrow.textContent = '－';
    }
}

// ─────────────────────────────────────────
// VIDEO TUTORIAL POPUP
// ─────────────────────────────────────────
function openTutoVideoModal() {
    const modal = document.getElementById('tutoVideoModal');
    const iframe = document.getElementById('tutoVideoIframe');
    if (modal && iframe) {
        iframe.src = "https://www.youtube.com/embed/Fxs1wmeQWiI?rel=0&modestbranding=1&color=white&autoplay=1";
        modal.style.display = 'flex';
    }
}

function closeTutoVideoModal() {
    const modal = document.getElementById('tutoVideoModal');
    const iframe = document.getElementById('tutoVideoIframe');
    if (modal) {
        modal.style.display = 'none';
    }
    if (iframe) {
        iframe.src = ""; // Stop video playback
    }
    
    if (currentUser && currentUser.email) {
        const tutoCompletedKey = `mitsu_tutorial_completed_${currentUser.email}`;
        localStorage.setItem(tutoCompletedKey, 'true');
    }
    
    // Load real data
    loadData();
}

// Alias for the "Refaire le tutoriel" button
function restartTutorial() {
    if (currentUser && currentUser.email) {
        localStorage.removeItem(`mitsu_tutorial_completed_${currentUser.email}`);
    }
    openTutoVideoModal();
}

// ─────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
} else {
    initDashboard();
}

// ─────────────────────────────────────────
// PARTIE AFFILIATION LOGIQUE ET FONCTIONS INTERACTIVES
// ─────────────────────────────────────────
let affPerformanceChart = null;

function openCustomCodeModal() {
    const modal = document.getElementById('mitsuPromptModal');
    if (modal) {
        document.getElementById('customReferralCodeInput').value = '';
        modal.style.display = 'flex';
    }
}

function closeCustomCodeModal() {
    const modal = document.getElementById('mitsuPromptModal');
    if (modal) modal.style.display = 'none';
}

async function submitCustomReferralCode() {
    const input = document.getElementById('customReferralCodeInput');
    if (!input) return;
    
    const customCode = input.value.trim().toUpperCase();
    
    // Alphanumeric format check, 4 to 8 characters
    const regex = /^[A-Z0-9]{4,8}$/;
    if (!regex.test(customCode)) {
        return showToast("Le code doit contenir de 4 à 8 caractères (lettres et chiffres uniquement, pas de symboles).", "error");
    }
    
    // Disable confirm button to prevent duplicate clicks
    const btn = document.getElementById('btnConfirmCustomCode');
    if (btn) btn.disabled = true;
    
    try {
        // First check availability
        const checkRes = await fetch(`${API_URL}/check-referral-code?code=${customCode}`);
        const checkData = await checkRes.json();
        
        if (!checkData.available) {
            if (btn) btn.disabled = false;
            return showToast(checkData.message, "error");
        }
        
        // If available, proceed to activate
        const actRes = await fetch(`${API_URL}/activate-affiliate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email, referralCode: customCode })
        });
        
        const actData = await actRes.json();
        if (actData.status === 'success') {
            showToast("Félicitations ! Votre espace partenaire est activé.", "success");
            closeCustomCodeModal();
            
            // Reload user session state and dashboard
            loadAffiliationData();
        } else {
            showToast(actData.message, "error");
        }
    } catch (e) {
        console.error("Activation Error:", e);
        showToast("Erreur lors de l'activation de votre parrainage.", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function showTierBenefits(tier) {
    let title = "";
    let benefits = "";
    let color = "";
    
    if (tier === 'bronze') {
        title = "🥉 Ambassadeur Bronze (Taux: 23%)";
        benefits = "• 23% de commission sur chaque vente.<br>• Supports marketing prêts à l'emploi.<br>• Formation gratuite à la prospection.";
        color = "var(--theme)";
    } else if (tier === 'argent') {
        title = "🥈 Ambassadeur Argent (Taux: 30%)";
        benefits = "• Débloqué à partir de <strong>10 ventes actives</strong>.<br>• 30% de commission sur chaque vente.<br>• Badge officiel RubiX.<br>• Visibilité sur le site.";
        color = "#00ff88";
    } else if (tier === 'or') {
        title = "🥇 Ambassadeur Or (Taux: 35%)";
        benefits = "• Débloqué à partir de <strong>25 ventes actives</strong>.<br>• 35% de commission sur chaque vente.<br>• Accès à des outils marketing exclusifs.";
        color = "#ffd700";
    } else if (tier === 'diamant') {
        title = "👑 Ambassadeur Diamant (Taux: 40%)";
        benefits = "• Débloqué à partir de <strong>50 ventes actives</strong>.<br>• 40% de commission sur chaque vente.<br>• Validation communauté VIP.<br>• Accès direct aux fondateurs (Telegram direct).<br>• Priorité absolue sur les nouveautés.";
        color = "#00ffff";
    }
    
    showToast(`
        <strong style="color:${color}; display:block; margin-bottom:6px; font-size:13px;">${title}</strong>
        <span style="font-size:11px; line-height:1.5; color:rgba(255,255,255,0.85);">${benefits}</span>
    `, 'info');
}

async function loadAffiliationData() {
    if (!currentUser || !currentUser.email) return;
    
    try {
        const res = await fetch(`${API_URL}/dashboard/affiliation?email=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        
        const overlay = document.getElementById('affiliationBlurOverlay');
        const realContent = document.getElementById('affiliationRealContent');
        if (!data.is_affiliate_active) {
            if (overlay) overlay.style.display = 'flex';
            if (realContent) realContent.style.display = 'none';
            return;
        }
        
        // Hide activation mask
        if (overlay) overlay.style.display = 'none';
        if (realContent) realContent.style.display = 'block';
        
        // Populate parrainage link
        const affReferralLinkInput = document.getElementById('affReferralLinkInput');
        if (affReferralLinkInput) {
            // Build the link utilizing the origin pointing to registration with parameter
            const referralLink = window.location.origin + window.location.pathname + "?ref=" + data.referral_code;
            affReferralLinkInput.value = referralLink;
        }
        
        // Populate active tier details
        const affActiveTierLabel = document.getElementById('affActiveTierLabel');
        if (affActiveTierLabel) {
            affActiveTierLabel.textContent = `${data.rank_badge} ${data.rank_title} (${(data.commission_rate * 100).toFixed(0)}%)`;
        }
        
        // Hide/show upgrade button based on current status (only show if rate is below 30%)
        const btnUpgrade = document.getElementById('btnUpgradeCommunity');
        if (btnUpgrade) {
            btnUpgrade.style.display = data.commission_rate >= 0.30 ? 'none' : 'inline-block';
        }

        // Update rank card details
        const affCurrentRankBadge = document.getElementById('affCurrentRankBadge');
        if (affCurrentRankBadge) affCurrentRankBadge.textContent = data.rank_badge;

        const affCurrentRankTitle = document.getElementById('affCurrentRankTitle');
        if (affCurrentRankTitle) affCurrentRankTitle.textContent = data.rank_title;

        const affCurrentCommRate = document.getElementById('affCurrentCommRate');
        if (affCurrentCommRate) affCurrentCommRate.textContent = `${(data.commission_rate * 100).toFixed(0)}% de commission`;

        // Update progress bar
        let targetSales = 10;
        let nextRankName = "Argent";
        let progressPercent = 0;
        let progressLabelText = "";
        let nextRankLabelText = "";

        if (data.rank === 'diamond') {
            targetSales = 50;
            nextRankName = "";
            progressPercent = 100;
            progressLabelText = `Ventes : ${data.stats.sales_count} (Maximum atteint)`;
            nextRankLabelText = "👑 Rang Diamant Actif";
        } else if (data.rank === 'gold') {
            targetSales = 50;
            nextRankName = "Diamant";
            progressPercent = Math.min(100, (data.stats.sales_count / targetSales) * 100);
            progressLabelText = `Ventes : ${data.stats.sales_count} / ${targetSales}`;
            nextRankLabelText = `Prochain palier : ${nextRankName}`;
        } else if (data.rank === 'silver') {
            targetSales = 25;
            nextRankName = "Or";
            progressPercent = Math.min(100, (data.stats.sales_count / targetSales) * 100);
            progressLabelText = `Ventes : ${data.stats.sales_count} / ${targetSales}`;
            nextRankLabelText = `Prochain palier : ${nextRankName}`;
        } else {
            // bronze
            targetSales = 10;
            nextRankName = "Argent";
            progressPercent = Math.min(100, (data.stats.sales_count / targetSales) * 100);
            progressLabelText = `Ventes : ${data.stats.sales_count} / ${targetSales}`;
            nextRankLabelText = `Prochain palier : ${nextRankName}`;
        }

        const affProgressLabel = document.getElementById('affProgressLabel');
        if (affProgressLabel) affProgressLabel.textContent = progressLabelText;

        const affNextRankLabel = document.getElementById('affNextRankLabel');
        if (affNextRankLabel) affNextRankLabel.textContent = nextRankLabelText;

        const affProgressBarFill = document.getElementById('affProgressBarFill');
        if (affProgressBarFill) affProgressBarFill.style.width = `${progressPercent}%`;

        // Update timeline steps
        const stepBronze = document.getElementById('stepBronze');
        const stepArgent = document.getElementById('stepArgent');
        const stepOr = document.getElementById('stepOr');
        const stepDiamant = document.getElementById('stepDiamant');
        const timelineProgressFill = document.getElementById('timelineProgressFill');

        if (stepBronze && stepArgent && stepOr && stepDiamant && timelineProgressFill) {
            stepBronze.classList.remove('active');
            stepArgent.classList.remove('active');
            stepOr.classList.remove('active');
            stepDiamant.classList.remove('active');

            let fillPercent = 0;
            const sales = data.stats.sales_count;

            if (data.rank === 'diamond') {
                stepBronze.classList.add('active');
                stepArgent.classList.add('active');
                stepOr.classList.add('active');
                stepDiamant.classList.add('active');
                fillPercent = 100;
            } else if (data.rank === 'gold') {
                stepBronze.classList.add('active');
                stepArgent.classList.add('active');
                stepOr.classList.add('active');
                const segmentProgress = Math.min(1, (sales - 25) / 25);
                fillPercent = 66.6 + (segmentProgress * 33.3);
            } else if (data.rank === 'silver') {
                stepBronze.classList.add('active');
                stepArgent.classList.add('active');
                const segmentProgress = Math.min(1, (sales - 10) / 15);
                fillPercent = 33.3 + (segmentProgress * 33.3);
            } else {
                stepBronze.classList.add('active');
                const segmentProgress = Math.min(1, sales / 10);
                fillPercent = segmentProgress * 33.3;
            }

            timelineProgressFill.style.width = `${fillPercent}%`;
        }

        // Store user override commission rate on the slider for simulator
        const simSalesSlider = document.getElementById('simSalesSlider');
        if (simSalesSlider) {
            simSalesSlider.setAttribute('data-override-rate', data.commission_rate);
        }

        // Run Simulator initially
        if (typeof runAffSim === 'function') {
            runAffSim();
        }

        // Load Leaderboard
        if (typeof loadLeaderboard === 'function') {
            loadLeaderboard();
        }
        
        // Update Stats Counters
        document.getElementById('affStatInscrits').textContent = data.stats.referred_count;
        document.getElementById('affStatActifs').textContent = data.stats.sales_count;
        document.getElementById('affStatCA').textContent = data.stats.total_sales_amount.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
        document.getElementById('affStatCommBrut').textContent = data.stats.projected_comm.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
        document.getElementById('affStatCommNet').textContent = data.stats.earned_comm.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
        
        // Withdrawal condition label
        const condLabel = document.getElementById('affWithdrawalConditionLabel');
        if (condLabel) {
            if (data.stats.is_eligible) {
                condLabel.textContent = "🎯 Condition Validée ! Vos commissions sont dues.";
                condLabel.style.color = "var(--success)";
            } else {
                const missingSales = data.stats.min_required - data.stats.sales_count;
                condLabel.textContent = `⚠️ Minimum requis non validé (${data.stats.sales_count}/${data.stats.min_required} vente). Besoin de ${missingSales} client(s) actif(s) de plus.`;
                condLabel.style.color = "var(--danger)";
            }
        }
        
        // Toggle Withdraw button visibility
        const withdrawBtn = document.getElementById('btnWithdrawCommissions');
        if (withdrawBtn) {
            withdrawBtn.style.display = (data.stats.is_eligible && data.stats.earned_comm > 0) ? 'block' : 'none';
        }
        
        // Populate clients table list
        const tableBody = document.getElementById('referredClientsList');
        if (tableBody) {
            if (data.referred_list.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align: center; color: var(--text-dim); padding: 24px; font-family: 'Inter', sans-serif;">
                            Aucun membre parrainé pour le moment. Partagez votre lien pour commencer !
                        </td>
                    </tr>
                `;
            } else {
                tableBody.innerHTML = data.referred_list.map(client => {
                    const statusText = client.hasActiveAccount 
                        ? `<span style="color: var(--success); font-weight: 700;">🟢 Actif (MT5 lié)</span>`
                        : `<span style="color: var(--text-dim);">⚪ Inscrit</span>`;
                    
                    return `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                            <td style="padding: 14px 8px; font-weight: 600; color: white;">
                                ${client.fullName}
                                <div style="font-size: 10px; color: var(--text-dim); font-weight: 400;">${client.email}</div>
                            </td>
                            <td style="padding: 14px 8px;">${statusText}</td>
                            <td style="padding: 14px 8px; font-weight: 600;">${client.pricePaid > 0 ? client.pricePaid.toFixed(2) + ' €' : '-'}</td>
                            <td style="padding: 14px 8px; text-align: right; font-weight: 700; color: ${client.hasActiveAccount ? 'var(--theme)' : 'var(--text-dim)'};">
                                ${client.hasActiveAccount ? '+' + client.commission.toFixed(2) + ' €' : '0.00 €'}
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
        
        // Render Chart performance timeline
        renderAffiliationChart(data.chart_data);
    } catch (e) {
        console.error("Load Affiliation Data Error:", e);
        showToast("Erreur lors du chargement des statistiques d'affiliation.", "error");
    }
}

function copyReferralLink() {
    const input = document.getElementById('affReferralLinkInput');
    if (!input) return;
    
    input.select();
    input.setSelectionRange(0, 99999); // For mobile devices
    
    navigator.clipboard.writeText(input.value)
        .then(() => {
            showToast("Lien de parrainage copié dans le presse-papiers !", "success");
        })
        .catch(err => {
            console.error('Copy failed', err);
            showToast("Impossible de copier le lien.", "error");
        });
}

// --- AFFILIATION SIMULATOR & LEADERBOARD ---
let leaderboardData = [];

function runAffSim() {
    const simSalesSlider = document.getElementById('simSalesSlider');
    const simSalesCountLabel = document.getElementById('simSalesCountLabel');
    const simPlanChoice = document.getElementById('simPlanChoice');
    const simCAValue = document.getElementById('simCAValue');
    const simRateValue = document.getElementById('simRateValue');
    const simEarningsValue = document.getElementById('simEarningsValue');

    if (!simSalesSlider || !simPlanChoice) return;

    const S = parseInt(simSalesSlider.value) || 1;
    if (simSalesCountLabel) {
        simSalesCountLabel.textContent = S === 1 ? "1 vente" : `${S} ventes`;
    }

    let P = 700;
    const plan = simPlanChoice.value;
    if (plan === 'low') P = 300;
    else if (plan === 'extreme') P = 1000;

    const CA = S * P;

    // Determine simulated rate based on sales count
    let projectedRate = 0.23;
    if (S >= 50) projectedRate = 0.40;
    else if (S >= 25) projectedRate = 0.35;
    else if (S >= 10) projectedRate = 0.30;

    // Read override rate if present
    const overrideRateAttr = simSalesSlider.getAttribute('data-override-rate');
    const overrideRate = overrideRateAttr ? parseFloat(overrideRateAttr) : 0.23;

    const finalRate = Math.max(projectedRate, overrideRate);
    const Gains = CA * finalRate;

    if (simCAValue) simCAValue.textContent = CA.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
    if (simRateValue) simRateValue.textContent = `${(finalRate * 100).toFixed(0)}%`;
    if (simEarningsValue) simEarningsValue.textContent = Gains.toLocaleString(undefined, {minimumFractionDigits: 2}) + " €";
}

async function loadLeaderboard() {
    try {
        const res = await fetch(`${API_URL}/affiliation/leaderboard`);
        leaderboardData = await res.json();
        renderLeaderboard(leaderboardData);
    } catch (e) {
        console.error("Error loading leaderboard:", e);
    }
}

function renderLeaderboard(data) {
    const tableBody = document.getElementById('leaderboardTableBody');
    if (!tableBody) return;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-dim); padding: 16px;">
                    Aucune donnée disponible.
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = data.map((item, idx) => {
        let rankBadge = '';
        if (idx === 0) rankBadge = '🥇';
        else if (idx === 1) rankBadge = '🥈';
        else if (idx === 2) rankBadge = '🥉';
        else rankBadge = `#${idx + 1}`;

        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                <td style="padding: 10px 8px; font-weight: 700; color: white;">${rankBadge}</td>
                <td style="padding: 10px 8px; font-family: monospace; font-size: 12px; color: var(--theme); font-weight: 700;">${item.referral_code}</td>
                <td style="padding: 10px 8px; text-align: center; color: white; font-weight: 600;">${item.sales_count}</td>
                <td style="padding: 10px 8px; text-align: right; font-weight: 700; color: var(--success);">${item.gains.toLocaleString(undefined, {minimumFractionDigits: 2})} €</td>
            </tr>
        `;
    }).join('');
}

function filterLeaderboard() {
    const searchInput = document.getElementById('leaderboardSearchInput');
    if (!searchInput) return;
    const query = searchInput.value.trim().toUpperCase();
    if (!query) {
        renderLeaderboard(leaderboardData);
        return;
    }

    const filtered = leaderboardData.filter(item => 
        item.referral_code.toUpperCase().includes(query)
    );
    renderLeaderboard(filtered);
}

function requestCommunityUpgrade() {
    const message = `Bonjour Yassine, je suis partenaire RubiX et je souhaite demander un upgrade au tier Communauté (30% de commission).

Voici les détails de mon audience / communauté :
- Lien de mon canal ou groupe (Telegram/Discord/YouTube...) : 
- Nombre de membres approximatif : 
- Description rapide de mon activité : 

Merci de vérifier ma communauté pour activer le switch dans mon espace admin !`;
    
    const telegramUrl = `https://t.me/ysestp?text=${encodeURIComponent(message)}`;
    window.open(telegramUrl, '_blank');
}

async function requestWithdrawal() {
    if (!currentUser || !currentUser.email) return;
    try {
        const res = await fetch(`${API_URL}/dashboard/affiliation?email=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (!data || !data.stats) return;
        
        const amount = data.stats.earned_comm;
        if (amount <= 0) {
            showToast("Vous n'avez aucun gain net retirable pour le moment.", "warning");
            return;
        }
        
        const message = `Bonjour Yassine, je souhaite demander le retrait de mes commissions d'affiliation RubiX SaaS.

💵 Montant demandé : ${amount.toFixed(2)} €
📧 Mon email : ${currentUser.email}

Veuillez trouver ci-dessous mes détails de paiement pour procéder au virement manuel :
- Moyen de paiement souhaité (RIB / IBAN / Crypto Wallet / PayPal, etc.) : 
- Détails complets du compte (RIB, Adresse de Wallet & Réseau, Email PayPal, etc.) : 

Merci de traiter ce retrait manuellement et de remettre mon solde à zéro depuis votre espace administrateur une fois le paiement envoyé.`;

        const telegramUrl = `https://t.me/ysestp?text=${encodeURIComponent(message)}`;
        window.open(telegramUrl, '_blank');
    } catch (e) {
        console.error("Error preparing withdrawal request:", e);
        showToast("Impossible de préparer la demande de retrait.", "error");
    }
}

function renderAffiliationChart(points) {
    const canvas = document.getElementById('affiliationPerformanceChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (affPerformanceChart) affPerformanceChart.destroy();
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(0, 255, 136, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 255, 136, 0.0)');
    
    affPerformanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: points.map(p => p.x),
            datasets: [{
                label: "Commissions Cumulées (€)",
                data: points.map(p => p.y),
                borderColor: '#00ff88',
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                backgroundColor: gradient,
                pointBackgroundColor: '#00ff88',
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: { color: '#71717a', font: { size: 10 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#71717a', font: { size: 10 } }
                }
            }
        }
    });
}

async function redirectToStripeCheckout() {

    
    const isTestZero = document.getElementById('checkStripeTestZero') ? document.getElementById('checkStripeTestZero').checked : false;
    
    try {
        const payload = {
            email: currentUser.email,
            account_id: currentAccountId,
            is_test_zero: isTestZero
        };
        
        const res = await fetch(`${API_URL}/stripe/create-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            alert("Erreur lors de la création de la session Stripe : " + (data.message || "inconnue"));
        }
    } catch (e) {
        console.error("Stripe checkout error:", e);
        alert("Impossible de contacter le serveur Stripe.");
    }
}

async function redirectToStripePortal() {

    
    try {
        const payload = {
            email: currentUser.email,
            account_id: currentAccountId
        };
        
        const res = await fetch(`${API_URL}/stripe/create-portal-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            alert("Erreur lors de la création de la session du portail Stripe : " + (data.message || "inconnue"));
        }
    } catch (e) {
        console.error("Stripe portal error:", e);
        alert("Impossible de contacter le serveur Stripe.");
    }
}

function cancelMonthlySubscription() {

    const acc = loadedAccounts[currentAccountId];
    const monthlyPrice = acc && acc.config && acc.config.monthly_price ? parseFloat(acc.config.monthly_price).toFixed(2) : '0.00';
    
    const message = `Bonjour Yassine, je souhaite demander l'annulation de ma mensualité active de ${monthlyPrice} € pour mon compte MT5 #${currentAccountId}.
    
E-mail de mon compte : ${currentUser.email}
    
Merci de me confirmer la prise en compte de ma demande et d'interrompre le prélèvement mensuel du compte.`;

    const telegramUrl = `https://t.me/ysestp?text=${encodeURIComponent(message)}`;
    window.open(telegramUrl, '_blank');
}

function requestAddMT5Account() {

    
    const message = `Bonjour Yassine, je suis partenaire / client RubiX et je souhaite lier un nouveau compte de trading MetaTrader 5 (MT5) à mon espace client.
    
E-mail de mon compte : ${currentUser.email}
Nombre de comptes actuels : ${Object.keys(loadedAccounts).length}
    
Merci de me préparer l'accès de trading et de m'indiquer la marche à suivre pour l'installation !`;

    const telegramUrl = `https://t.me/ysestp?text=${encodeURIComponent(message)}`;
    window.open(telegramUrl, '_blank');
}

// ─────────────────────────────────────────
// MODE CONFIGURATEUR SIMPLE (ASSISTÉ PAR IA)
// ─────────────────────────────────────────
let currentConfigMode = 'simple';

function switchConfigMode(mode) {
    currentConfigMode = mode;
    const btnSimple = document.getElementById('btnConfigModeSimple');
    const btnAdvanced = document.getElementById('btnConfigModeAdvanced');
    const layoutSimple = document.getElementById('configModeSimpleLayout');
    const layoutAdvanced = document.getElementById('configModeAdvancedLayout');
    
    if (mode === 'simple') {
        if (btnSimple) btnSimple.classList.add('active');
        if (btnAdvanced) btnAdvanced.classList.remove('active');
        if (layoutSimple) layoutSimple.style.display = 'block';
        if (layoutAdvanced) layoutAdvanced.style.display = 'none';
    } else {
        if (btnSimple) btnSimple.classList.remove('active');
        if (btnAdvanced) btnAdvanced.classList.add('active');
        if (layoutSimple) layoutSimple.style.display = 'none';
        if (layoutAdvanced) layoutAdvanced.style.display = 'block';
        updateBotCalculator(); // Sync advanced view on tab change
    }
}

function generateAIPhrases(capital, gain) {
    const isProp = (currentCapitalType === 'propfirm');
    const baseMinCap = isProp ? 10000 : 1000;
    const calcCapital = Math.max(baseMinCap, capital);
    const requiredPct = (gain / calcCapital) * 100;
    
    const pool = [
        `Connexion sécurisée aux flux historiques XAUUSD (Gold) en cours...`,
        `Analyse de viabilité sur capital de départ de ${capital.toLocaleString()} €/$...`,
        `Calcul de l'exposition optimale pour générer ${gain.toLocaleString()} €/$ par mois...`,
        `Rendement cible estimé à ${requiredPct.toFixed(1)}% mensuel...`,
        isProp ? `Calcul de drawdown optimal cible à 0.3% (limite max 3% Prop Firm)...` : `Lancement d'une simulation de Monte Carlo (10 000 scénarios de marché)...`,
        `Ajustement du filtre de tendance propriétaire RubiX Hard Trend Filter...`,
        `Calcul du drawdown maximum tolérable pour la cible de ${gain.toLocaleString()} €/$...`,
        `Optimisation du Money Management pour un compte à ${capital.toLocaleString()} €/$...`,
        isProp ? `Vérification des règles quotidiennes et globales de perte autorisée...` : `Vérification de la marge broker requise (effet de levier 1:500)...`,
        `Génération des projections géométriques sur 12 mois...`
    ];
    
    // Shuffle the pool and select 6 phrases
    const shuffled = pool.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 6);
}

function runAISimpleModeAnalysis() {
    const inputCapital = document.getElementById('inputSimpleCapital');
    const inputGain = document.getElementById('inputSimpleGain');
    if (!inputCapital || !inputGain) return;
    
    let capital = parseFloat(inputCapital.value);
    let gain = parseFloat(inputGain.value);
    
    const isProp = (currentCapitalType === 'propfirm');
    const minCapital = isProp ? 10000 : 500;
    const maxCapital = isProp ? 400000 : 10000;
    const minGain = isProp ? 100 : 10;
    const maxGain = isProp ? 26000 : 6500;

    // Bounds checking
    if (isNaN(capital) || capital < minCapital) {
        capital = minCapital;
        inputCapital.value = minCapital;
    }
    if (capital > maxCapital) {
        capital = maxCapital;
        inputCapital.value = maxCapital;
    }
    if (isNaN(gain) || gain < minGain) {
        gain = minGain;
        inputGain.value = minGain;
    }
    if (gain > maxGain) {
        gain = maxGain;
        inputGain.value = maxGain;
    }
    
    const simpleInputs = inputCapital.closest('.glass');
    const loader = document.getElementById('aiLoadingContainer');
    const results = document.getElementById('simpleResultsContainer');
    
    if (simpleInputs) simpleInputs.style.display = 'none';
    if (loader) loader.style.display = 'flex';
    if (results) results.style.display = 'none';
    
    const statusText = document.getElementById('aiLoadingStatus');
    
    const phrases = generateAIPhrases(capital, gain);
    let step = 0;
    if (statusText) statusText.textContent = phrases[0];
    
    const interval = setInterval(() => {
        step++;
        if (step < phrases.length) {
            if (statusText) statusText.textContent = phrases[step];
        }
    }, 380);
    
    setTimeout(() => {
        clearInterval(interval);
        
        generateSimpleModePlans(capital, gain);
        
        if (loader) loader.style.display = 'none';
        if (results) results.style.display = 'block';
    }, 2400);
}

function syncSimpleSlider(type) {
    const input = document.getElementById(`inputSimple${type}`);
    const slider = document.getElementById(`sliderSimple${type}`);
    if (!input || !slider) return;
    
    let val = parseFloat(input.value);
    if (isNaN(val)) return;
    
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    if (val < min) val = min;
    if (val > max) val = max;
    
    slider.value = val;
    updateGainPercentIndicator();
}

function syncSimpleNumber(type) {
    const input = document.getElementById(`inputSimple${type}`);
    const slider = document.getElementById(`sliderSimple${type}`);
    if (!input || !slider) return;
    
    input.value = slider.value;
    updateGainPercentIndicator();
}

function updateGainPercentIndicator() {
    const inputCapital = document.getElementById('inputSimpleCapital');
    const inputGain = document.getElementById('inputSimpleGain');
    const label = document.getElementById('gainPercentIndicator');
    if (!inputCapital || !inputGain || !label) return;
    
    const isProp = (currentCapitalType === 'propfirm');
    const minCapital = isProp ? 10000 : 500;
    const baseMinCap = isProp ? 10000 : 1000;
    const capital = parseFloat(inputCapital.value) || minCapital;
    const gain = parseFloat(inputGain.value) || (isProp ? 250 : 200);
    
    const calcCapital = Math.max(baseMinCap, capital);
    const pct = (gain / calcCapital) * 100;
    
    label.textContent = `Cible : ${pct.toFixed(1)}% du capital / mois ${capital < baseMinCap ? `(base ${baseMinCap.toLocaleString()} €/$)` : ''}`;
}

function resetSimpleForm() {
    const inputCapital = document.getElementById('inputSimpleCapital');
    if (!inputCapital) return;
    const simpleInputs = inputCapital.closest('.glass');
    const loader = document.getElementById('aiLoadingContainer');
    const results = document.getElementById('simpleResultsContainer');
    
    if (simpleInputs) simpleInputs.style.display = 'block';
    if (loader) loader.style.display = 'none';
    if (results) results.style.display = 'none';
    
    // Reset inputs and sliders to defaults based on currentCapitalType
    const sliderCapital = document.getElementById('sliderSimpleCapital');
    const inputGain = document.getElementById('inputSimpleGain');
    const sliderGain = document.getElementById('sliderSimpleGain');
    
    const isProp = (currentCapitalType === 'propfirm');
    const defaultCapital = isProp ? 10000 : 1000;
    const defaultGain = isProp ? 250 : 200;

    if (inputCapital && sliderCapital) {
        inputCapital.value = defaultCapital;
        sliderCapital.value = defaultCapital;
    }
    if (inputGain && sliderGain) {
        inputGain.value = defaultGain;
        sliderGain.value = defaultGain;
    }
    updateGainPercentIndicator();
}

function getProjectionDataset(capital, profitPct, monthlyFee, initialPrice) {
    let dataset = [capital];
    let simCapital = capital;
    const isProp = (currentCapitalType === 'propfirm');
    for (let month = 1; month <= 12; month++) {
        let baseMinCap = isProp ? 10000 : 1000;
        let calcCapitalForGain = Math.max(baseMinCap, simCapital);
        let grossGain = calcCapitalForGain * (profitPct / 100);
        let netGain = grossGain - monthlyFee;
        simCapital += netGain;
        if (simCapital < 0) simCapital = 0;
        dataset.push(simCapital);
    }
    return dataset;
}

function drawSparkline(canvasId, dataset) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const width = canvas.clientWidth || 240;
    const height = canvas.clientHeight || 70;
    canvas.width = width;
    canvas.height = height;
    
    ctx.clearRect(0, 0, width, height);
    
    // Theme colors tailored by plan ID
    let themeColor = '#E0115F'; // gold default
    let glowColor = 'rgba(224, 17, 95, 0.15)';
    if (canvasId.includes('lowcost')) {
        themeColor = '#22c55e'; // green (success)
        glowColor = 'rgba(34, 197, 94, 0.15)';
    } else if (canvasId.includes('normal')) {
        themeColor = '#E0115F'; // gold
        glowColor = 'rgba(224, 17, 95, 0.15)';
    } else if (canvasId.includes('extreme')) {
        themeColor = '#ef4444'; // red (danger)
        glowColor = 'rgba(239, 68, 68, 0.15)';
    }
    
    // Gradient fill under curve
    const fillGlow = ctx.createLinearGradient(0, 0, 0, height);
    fillGlow.addColorStop(0, glowColor);
    fillGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    const minVal = Math.min(...dataset);
    const maxVal = Math.max(...dataset);
    const range = maxVal - minVal || 1;
    
    const points = dataset.map((val, index) => {
        const x = (index / (dataset.length - 1)) * (width - 16) + 8;
        const y = height - ((val - minVal) / range) * (height - 20) - 10;
        return { x, y };
    });
    
    // Draw area path
    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, height);
    ctx.closePath();
    ctx.fillStyle = fillGlow;
    ctx.fill();
    
    // Draw smooth bezier curve line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        const xc = (points[i].x + points[i-1].x) / 2;
        const yc = (points[i].y + points[i-1].y) / 2;
        ctx.quadraticCurveTo(points[i-1].x, points[i-1].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2.5;
    
    // Glow effect
    ctx.shadowColor = themeColor;
    ctx.shadowBlur = 6;
    ctx.stroke();
    
    // Reset shadow
    ctx.shadowBlur = 0;
    
    // Draw final coordinate dot
    const endPoint = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(endPoint.x, endPoint.y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(endPoint.x, endPoint.y, 5, 0, 2 * Math.PI);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function generateSimpleModePlans(capital, gain) {
    const grid = document.getElementById('simplePlansGrid');
    if (!grid) return;
    grid.innerHTML = "";
    
    const isProp = (currentCapitalType === 'propfirm');
    const baseMinCap = isProp ? 10000 : 1000;
    const calcCapitalForGain = Math.max(baseMinCap, capital);
    const requiredPct = (gain / calcCapitalForGain) * 100;
    
    // Define all available configurations with fixed VPS/service fees
    const configOptions = isProp ? [
        {
            id: 'lowcost',
            title: 'Plan Low Cost — Sécurisé',
            maxCapital: 400000,
            maxProfit: 2.5,
            uniquePrice: 300,
            vpsFee: 25,
            drawdown: '3%',
            prob: '1%',
            color: '#22c55e'
        },
        {
            id: 'normal',
            title: 'Plan Normal — Équilibré',
            maxCapital: 400000,
            maxProfit: 4.5,
            uniquePrice: 600,
            vpsFee: 50,
            drawdown: '3%',
            prob: '2%',
            color: '#E0115F'
        },
        {
            id: 'extreme',
            title: 'Plan Extreme — Rendement Max',
            maxCapital: 400000,
            maxProfit: 6.5,
            uniquePrice: 950,
            vpsFee: 100,
            drawdown: '3%',
            prob: '2.5%',
            color: '#ef4444'
        }
    ] : [
        {
            id: 'lowcost',
            title: 'Plan Conservateur — Sécurisé',
            maxCapital: 2500,
            maxProfit: 15,
            uniquePrice: 300,
            vpsFee: 25,
            drawdown: '30%',
            prob: '1%',
            color: '#22c55e'
        },
        {
            id: 'normal',
            title: 'Plan Équilibré — Performance',
            maxCapital: 7000,
            maxProfit: 45,
            uniquePrice: 600,
            vpsFee: 50,
            drawdown: '30%',
            prob: '2%',
            color: '#E0115F'
        },
        {
            id: 'extreme',
            title: 'Plan Débridé — Rendement Max',
            maxCapital: 10000,
            maxProfit: 100,
            uniquePrice: 950,
            vpsFee: 100,
            drawdown: '30%',
            prob: '2.5%',
            color: '#ef4444'
        }
    ];
    
    // 1. Filter by capital limit first
    let allowedPlans = configOptions.filter(opt => capital <= opt.maxCapital);
    
    // 2. Filter by ability to reach requiredPct (if possible)
    let satisfyingPlans = allowedPlans.filter(opt => opt.maxProfit >= requiredPct);
    
    // If no plan can satisfy requiredPct (e.g. target gain is extremely high), we keep the one that gets the closest (the highest allowed plan)
    let finalPlansToRecommend = [];
    if (satisfyingPlans.length > 0) {
        finalPlansToRecommend = satisfyingPlans;
    } else if (allowedPlans.length > 0) {
        // Fallback to the one with the highest limit
        finalPlansToRecommend = [allowedPlans[allowedPlans.length - 1]];
    }
    
    let plans = [];
    
    finalPlansToRecommend.forEach((p, idx) => {
        const minProfitVal = isProp ? 1.0 : 10;
        const profitPct = Math.max(minProfitVal, Math.min(p.maxProfit, requiredPct));
        
        // Fixed monthly cost from plan configuration
        const vpsFee = p.vpsFee;
        const monthlyEst = Math.max(baseMinCap, capital) * (profitPct / 100);
        
        const dataset = getProjectionDataset(capital, profitPct, vpsFee, p.uniquePrice);
        const finalCapital = dataset[dataset.length - 1];
        
        let adviceText = "";
        if (p.id === 'lowcost') {
            adviceText = requiredPct <= p.maxProfit 
                ? "Rendement optimal sécurisé par l'IA. Parfait pour vos objectifs." 
                : `Objectif ambitieux. Gains limités à ${p.maxProfit}% max/mois par sécurité dans ce mode.`;
        } else if (p.id === 'normal') {
            adviceText = requiredPct <= p.maxProfit
                ? "Le meilleur ratio Risque / Rendement calculé par notre algorithme."
                : `Rendement poussé à sa limite (${p.maxProfit}% max/mois) pour s'approcher de votre cible.`;
        } else {
            adviceText = requiredPct <= p.maxProfit
                ? "Profil à fort rendement sur XAUUSD. Idéal pour optimiser les gains."
                : `Rendement exceptionnel au maximum du robot (${p.maxProfit}%) avec risque de drawdown élevé.`;
        }
        
        plans.push({
            id: p.id,
            title: p.title,
            profitPct,
            vpsFee,
            uniquePrice: p.uniquePrice,
            monthlyEst,
            finalCapital,
            dataset,
            advice: adviceText,
            drawdown: p.drawdown,
            prob: p.prob,
            color: p.color
        });
    });
    
    // Build plans HTML
    plans.forEach((p, idx) => {
        const cardHtml = `
            <div class="glass configurator-card" style="padding: 24px; border: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; justify-content: space-between; position: relative;">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h5 style="font-size: 14px; font-weight: 700; color: ${p.color}; font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.5px;">${p.title}</h5>
                        <span style="font-size: 9px; font-weight: 700; background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 99px; font-family: 'Inter', sans-serif;">Option ${idx + 1}</span>
                    </div>
                    
                    <p style="font-size: 11px; color: var(--text-dim); line-height: 1.4; margin-bottom: 16px; min-height: 40px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px; font-style: italic;">
                        "${p.advice}"
                    </p>
                    
                    <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px; margin-bottom: 16px; font-family: 'Inter', sans-serif;">
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 4px;"><span style="color:var(--text-dim);">Cible de Profit :</span> <strong style="color:#fff;">${p.profitPct.toFixed(isProp ? 1 : 0)}% / mois</strong></div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 4px;"><span style="color:var(--text-dim);">Gains mensuels estimés :</span> <strong style="color:var(--success);">+${p.monthlyEst.toFixed(0)} €/$</strong></div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 4px;"><span style="color:var(--text-dim);">Licence d'Accès Unique :</span> <strong style="color:var(--theme);">${p.uniquePrice} €</strong></div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 4px;"><span style="color:var(--text-dim);">Hébergement, services & accès :</span> <strong style="color:var(--theme);">${p.vpsFee.toFixed(2)} € / mois (Fixe)</strong></div>
                        <div style="display: flex; justify-content: space-between; padding-bottom: 4px;"><span style="color:var(--text-dim);">Risque Drawdown Max :</span> <strong style="color:var(--danger);">${p.drawdown} (${p.prob} prob.)</strong></div>
                    </div>
                    
                    <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-dim); margin-bottom: 6px;">
                            <span>Projections Capital (12 mois)</span>
                            <span style="color: var(--success); font-weight: 700;">+${Math.round((p.finalCapital - capital)/capital * 100)}%</span>
                        </div>
                        <canvas id="sparklineCanvas_${p.id}" style="width: 100%; height: 70px; display: block;"></canvas>
                    </div>
                </div>
                
                <button class="btn-gold" onclick="sendSimpleBotOrderTelegram('${p.id}', ${capital}, ${p.profitPct}, ${p.uniquePrice}, ${p.vpsFee})" style="padding: 12px; font-size: 11px; font-weight: 700; width: 100%; margin-top: 10px; border-radius: 8px;">
                    🎯 Choisir & commander ce plan
                </button>
            </div>
        `;
        
        grid.insertAdjacentHTML('beforeend', cardHtml);
    });
    
    // Render sparklines
    setTimeout(() => {
        plans.forEach(p => {
            drawSparkline(`sparklineCanvas_${p.id}`, p.dataset);
        });
    }, 50);
}

function sendSimpleBotOrderTelegram(planId, capital, profitPct, initialPrice, monthlyFee) {
    const isProp = (currentCapitalType === 'propfirm');
    let modeText = planId === 'lowcost' ? 'Conservateur' : planId === 'normal' ? 'Équilibré' : 'Débridé';
    const capLabel = isProp ? "Taille du Compte challenge (Prop Firm)" : "Capital broker de départ";
    const profitText = profitPct.toFixed(isProp ? 1 : 0);
    const message = `Bonjour Yassine, j'ai configuré mon SynapX Bot en Mode Simple Assisté par l'IA.
 
Voici mes paramètres de configuration :
- Plan recommandé choisi : Plan ${modeText} (${isProp ? 'Prop Firm' : 'Capitale Perso'})
- ${capLabel} : ${capital.toLocaleString()} €/$
- Cible de profit mensuel : ${profitText}%
- Prix unique d'accès : ${initialPrice} €
- Hébergement & maintenance de compte : ${monthlyFee.toFixed(2)} € / mois
 
Merci de préparer mon accès VIP et de m'indiquer la marche à suivre pour l'installation !`;
    
    const telegramUrl = `https://t.me/ysestp?text=${encodeURIComponent(message)}`;
    window.open(telegramUrl, '_blank');
}

// ─────────────────────────────────────────
// PREMIUM AUDIO & HARDWARE SIMULATION
// ─────────────────────────────────────────
let audioCtx = null;
function playSoftClick() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        const now = audioCtx.currentTime;
        
        // Premium sine sweep click sound
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);
        
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        
        osc.start(now);
        osc.stop(now + 0.09);
    } catch (e) {
        console.warn("Web Audio click synth failed to execute:", e);
    }
}

// Global listener for soft click feedback
document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    
    if (
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'LABEL' ||
        target.closest('.timeline-step') ||
        target.closest('.nav-item') ||
        target.closest('.card') ||
        target.closest('[onclick]') ||
        target.classList.contains('switch') ||
        target.classList.contains('slider')
    ) {
        playSoftClick();
    }
}, { passive: true });

// ─────────────────────────────────────────
// 30 DAYS DAILY HISTORY TABLE POPULATION
// ─────────────────────────────────────────
function renderDailyHistory(history, finalBalance) {
    const tableBody = document.getElementById('dailyHistoryTableBody');
    if (!tableBody) return;

    if (!history || history.length === 0) {
        let emptyHtml = '';
        const today = new Date();
        for (let i = 0; i < 30; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const displayDate = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
            emptyHtml += `
                <div style="display: grid; grid-template-columns: 1.2fr 1fr 0.8fr; padding: 8px 10px; font-size: 11.5px; border-bottom: 1px solid rgba(255,255,255,0.03); align-items: center; color: var(--text-dim);">
                    <span>${displayDate}</span>
                    <span style="text-align: right;">0,00 $</span>
                    <span style="text-align: right;">0,00%</span>
                </div>
            `;
        }
        tableBody.innerHTML = emptyHtml;
        return;
    }

    // Group history by date key: YYYY-MM-DD
    let dailyProfits = {};
    history.forEach(h => {
        const d = parseDate(h.date);
        if (!d) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!dailyProfits[key]) dailyProfits[key] = 0;
        dailyProfits[key] += parseFloat(String(h.resultStr).replace('$', '').replace('+', '').replace(' ', '')) || 0;
    });

    let rowsHtml = '';
    let currentBalance = finalBalance;

    // Create a list of the last 30 dates (including today)
    let datesList = [];
    const today = new Date();
    for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const displayDate = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        datesList.push({ key, displayDate });
    }

    // Calculate daily starting balances walking back through history sorted descending
    const sortedProfitKeys = Object.keys(dailyProfits).sort((a, b) => new Date(b) - new Date(a));
    let dailyBalances = {};
    let balanceWalk = finalBalance;
    
    sortedProfitKeys.forEach(key => {
        dailyBalances[key] = balanceWalk;
        balanceWalk -= dailyProfits[key];
    });

    datesList.forEach(item => {
        const profit = dailyProfits[item.key] || 0;
        const endingBal = dailyBalances[item.key] || balanceWalk;
        const startingBal = endingBal - profit;
        
        let pct = 0;
        if (startingBal > 0) {
            pct = (profit / startingBal) * 100;
        }

        const profitClass = profit > 0 ? 'profit-pos' : profit < 0 ? 'profit-neg' : '';
        const profitSign = profit > 0 ? '+' : '';
        const pctSign = profit > 0 ? '+' : '';

        rowsHtml += `
            <div style="display: grid; grid-template-columns: 1.2fr 1fr 0.8fr; padding: 8px 10px; font-size: 11.5px; border-bottom: 1px solid rgba(255,255,255,0.03); align-items: center;">
                <span>${item.displayDate}</span>
                <span class="${profitClass}" style="font-weight: 700; text-align: right;">${profitSign}${profit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} $</span>
                <span class="${profitClass}" style="font-weight: 600; text-align: right;">${pctSign}${pct.toFixed(2)}%</span>
            </div>
        `;
    });

    tableBody.innerHTML = rowsHtml;
}

let _communityLastValue = 0;

async function loadCommunityData() {
    try {
        const res = await fetch(`${API_URL}/community/gains`);
        const data = await res.json();
        if (data.status === 'success') {
            const el = document.getElementById('communityTotalGains');
            if (el) {
                const targetValue = data.gains;
                const isPositive = targetValue >= 0;
                el.style.color = isPositive ? 'var(--success)' : 'var(--danger)';

                // Animate count-up
                const startValue = _communityLastValue;
                const duration = 1500;
                const startTime = performance.now();

                function formatGains(val) {
                    const abs = Math.abs(val);
                    const sign = val >= 0 ? '+' : '-';
                    return sign + '$' + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                }

                function easeOutExpo(t) {
                    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
                }

                function animateStep(now) {
                    const elapsed = now - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    const easedProgress = easeOutExpo(progress);
                    const currentVal = startValue + (targetValue - startValue) * easedProgress;
                    el.textContent = formatGains(currentVal);
                    if (progress < 1) {
                        requestAnimationFrame(animateStep);
                    } else {
                        el.textContent = formatGains(targetValue);
                        _communityLastValue = targetValue;
                    }
                }

                requestAnimationFrame(animateStep);
            }
        }
    } catch (e) {
        console.error("Error loading community gains:", e);
    }
}


// ─────────────────────────────────────────
// DARK/LIGHT THEME SWITCHER
// ─────────────────────────────────────────
function toggleThemeMode() {
    const toggle = document.getElementById('themeModeToggle');
    const label = document.getElementById('themeToggleLabel');
    if (toggle.checked) {
        document.body.classList.remove('light-theme');
        if (label) label.textContent = 'Mode Sombre Actif';
        localStorage.setItem('dashboard-theme', 'dark');
    } else {
        document.body.classList.add('light-theme');
        if (label) label.textContent = 'Mode Clair Actif';
        localStorage.setItem('dashboard-theme', 'light');
    }
}

function initThemeMode() {
    const savedTheme = localStorage.getItem('dashboard-theme') || 'dark';
    const toggle = document.getElementById('themeModeToggle');
    const label = document.getElementById('themeToggleLabel');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        if (toggle) toggle.checked = false;
        if (label) label.textContent = 'Mode Clair Actif';
    } else {
        document.body.classList.remove('light-theme');
        if (toggle) toggle.checked = true;
        if (label) label.textContent = 'Mode Sombre Actif';
    }
}
