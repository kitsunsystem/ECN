const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MITSU_ADMIN_2026";

// Configuration Supabase (Variables à configurer sur Vercel)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
// Vérification des variables au démarrage
if (!supabaseUrl || !supabaseKey) {
    console.error("CRITICAL ERROR: SUPABASE_URL or SUPABASE_KEY is missing in environment variables!");
}
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json({ 
    limit: '50mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// --- AUTH ENDPOINTS ---

app.post('/api/signup', async (req, res) => {
    try {
        const { firstName, lastName, email, password, referredByCode } = req.body;
        
        let referralCodeToSave = null;
        if (referredByCode && referredByCode.trim() !== "") {
            const cleanCode = referredByCode.trim().toUpperCase();
            
            // Check if this code actually exists in users database
            const { data: codeOwner, error: queryError } = await supabase
                .from('users')
                .select('email')
                .ilike('referral_code', cleanCode)
                .maybeSingle();
                
            if (queryError) {
                return res.status(500).json({ status: 'error', message: "Erreur de base de données lors de la vérification du parrainage." });
            }
            if (!codeOwner) {
                return res.status(400).json({ status: 'error', message: "Le code de parrainage saisi n'existe pas. Veuillez le corriger ou vider le champ." });
            }
            
            referralCodeToSave = cleanCode;
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const { data, error } = await supabase.from('users').insert([{
            email,
            first_name: firstName,
            last_name: lastName,
            full_name: `${firstName} ${lastName}`,
            password: hashedPassword,
            referred_by: referralCodeToSave
        }]);

        if (error) return res.status(400).json({ status: 'error', message: error.message });
        res.json({ status: 'success', message: 'Account created' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data, error } = await supabase.from('users').select('*').eq('email', email).single();

        if (data && await bcrypt.compare(password, data.password)) {
            res.json({ status: 'success', user: { email: data.email, fullName: data.full_name } });
        } else {
            res.status(401).json({ status: 'error', message: 'Invalid credentials' });
        }
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

app.post('/api/update-password', async (req, res) => {
    const { email, oldPassword, newPassword } = req.body;
    
    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    
    if (user && await bcrypt.compare(oldPassword, user.password)) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const { error } = await supabase.from('users').update({ password: hashedPassword }).eq('email', email);
        if (error) return res.status(500).json({ status: 'error', message: error.message });
        res.json({ status: 'success', message: 'Password updated' });
    } else {
        res.status(401).json({ status: 'error', message: 'Incorrect old password' });
    }
});

// --- EA DATA ENDPOINT ---

app.get('/api/stats', (req, res) => {
    res.json({
        status: 'active',
        message: 'Mitsuyoshi EA Stats Endpoint is active. Please send a POST request with account data.'
    });
});

app.post('/api/stats', async (req, res) => {
    const data = req.body;
    if (!data || !data.email) return res.status(400).send('Invalid data');

    // Auto-create user if not exists
    const { data: userExists } = await supabase.from('users').select('email').eq('email', data.email).single();
    if (!userExists) {
        const defaultHashed = await bcrypt.hash("change_me_123", 10);
        await supabase.from('users').insert([{
            email: data.email,
            full_name: data.name || "MT5 User",
            password: defaultHashed
        }]);
    }

    // Process Stats
    const history = data.history || [];
    let totalProfit = 0, wins = 0, losses = 0, grossProfit = 0, grossLoss = 0, maxLoss = 0;
    history.forEach(trade => {
        const p = Number(trade.profit) || 0;
        totalProfit += p;
        if (p > 0) { wins++; grossProfit += p; }
        else if (p < 0) { losses++; grossLoss += Math.abs(p); if (Math.abs(p) > maxLoss) maxLoss = Math.abs(p); }
    });

    let dailyProfits = {};
    history.forEach(trade => {
        const dateKey = trade.date.split(' ')[0];
        if (!dailyProfits[dateKey]) dailyProfits[dateKey] = 0;
        dailyProfits[dateKey] += Number(trade.profit);
    });

    const sortedDays = Object.keys(dailyProfits).sort();
    let currentBal = Number(data.balance) || 0;
    let chartDataPoints = [{ x: 'Now', y: currentBal }];
    for (let i = sortedDays.length - 1; i >= 0; i--) {
        currentBal -= dailyProfits[sortedDays[i]];
        chartDataPoints.unshift({ x: sortedDays[i], y: currentBal });
        if (chartDataPoints.length >= 31) break;
    }

    const winRate = (wins + losses > 0) ? (wins / (wins + losses) * 100).toFixed(1) : 0;
    const profitFactor = (grossLoss > 0) ? (grossProfit / grossLoss).toFixed(2) : grossProfit.toFixed(2);

    const formattedHistory = [...history].reverse().slice(0, 1000).map(h => ({
        id: h.id, date: h.date, duration: h.duration, type: h.type,
        symbol: h.symbol, size: h.size, isPositive: Number(h.profit) >= 0,
        resultStr: (Number(h.profit) >= 0 ? "+" : "") + "$" + Number(h.profit).toFixed(2)
    }));

    // Fetch existing config & price
    const { data: existingAcc } = await supabase
        .from('accounts')
        .select('config, initial_price_paid')
        .eq('account_id', String(data.account_id))
        .maybeSingle();

    const config = (existingAcc && existingAcc.config) ? existingAcc.config : { lot_multiplier: 1.0, enabled: true, bypass_payment: true };
    const existingPrice = existingAcc ? (parseFloat(existingAcc.initial_price_paid) || 0.00) : 0.00;

    // Auto-initialize daily profit target to max plan limit if not set or invalid
    const balanceVal = parseFloat(data.balance) || 0.0;
    const maxDailyProfitTargetPct = parseFloat(config.max_daily_profit_target_pct) || 2.25;
    const isProp = (maxDailyProfitTargetPct <= 0.65);
    const calcBalance = isProp ? balanceVal : Math.max(1000, balanceVal);
    const maxAllowedDollars = Math.ceil(calcBalance * (maxDailyProfitTargetPct / 100) * 100) / 100;
    const minAllowedDollars = Math.round(calcBalance * (0.1 / 100) * 100) / 100;

    let dailyProfitTarget = parseFloat(config.daily_profit_target) || parseFloat(config.profit_target);
    if (isNaN(dailyProfitTarget) || dailyProfitTarget === 0 || dailyProfitTarget < minAllowedDollars) {
        dailyProfitTarget = maxAllowedDollars;
        config.daily_profit_target = dailyProfitTarget;
        config.profit_target = dailyProfitTarget;
    } else {
        config.daily_profit_target = dailyProfitTarget;
        config.profit_target = dailyProfitTarget;
    }

    // Upsert Account (Safely initialize price to 0.00 for new accounts, but preserve existing price for others)
    const { error: upsertError } = await supabase.from('accounts').upsert({
        account_id: String(data.account_id),
        email: data.email,
        balance: data.balance,
        equity: data.equity,
        broker: data.broker,
        server: data.server,
        currency: data.currency,
        leverage: data.leverage,
        win_rate: winRate + "%",
        profit_factor: String(profitFactor),
        total_result: totalProfit.toFixed(2),
        max_loss: "-$" + maxLoss.toFixed(2),
        chart_data: chartDataPoints,
        history: formattedHistory,
        config: config,
        initial_price_paid: existingPrice,
        last_update: new Date().toISOString()
    });

    if (upsertError) console.error("Upsert Error:", upsertError);
 
    // Check if the user has ANY active subscription across all accounts
    const userEmail = existingAcc ? existingAcc.email : data.email;
    let isUserSubscribed = false;
    if (userEmail) {
        const { data: allAccs } = await supabase
            .from('accounts')
            .select('config')
            .eq('email', userEmail);
        
        if (allAccs) {
            isUserSubscribed = allAccs.some(a => a.config && a.config.stripe_status === 'active');
        }
    }

    const isBypassed = config.bypass_payment !== false;
    const isPaidOrBypassed = isUserSubscribed || isBypassed;

    const targetVal = parseFloat(config.daily_profit_target) || 0.0;
    const targetStr = targetVal.toFixed(2);

    const returnConfig = {
        ...config,
        enabled: (config.enabled !== false) && (config.client_enabled !== false) && isPaidOrBypassed,
        daily_profit_target: targetVal,
        profit_target: targetVal,
        daily_profit_limit: targetVal,
        daily_limit: targetVal,
        take_profit: targetVal,
        daily_take_profit: targetVal,
        
        daily_profit_target_str: targetStr,
        profit_target_str: targetStr,
        daily_profit_limit_str: targetStr,
        daily_limit_str: targetStr,
        take_profit_str: targetStr,
        daily_take_profit_str: targetStr
    };

    res.status(200).json({ 
        status: 'success', 
        config: returnConfig,
        daily_profit_target: targetVal,
        profit_target: targetVal,
        daily_profit_limit: targetVal,
        daily_limit: targetVal,
        take_profit: targetVal,
        daily_take_profit: targetVal,
        
        daily_profit_target_str: targetStr,
        profit_target_str: targetStr,
        daily_profit_limit_str: targetStr,
        daily_limit_str: targetStr,
        take_profit_str: targetStr,
        daily_take_profit_str: targetStr
    });
});

// --- ADMIN 2FA UTILITIES ---

// Base32 Alphabet Decode Helper
function base32Decode(base32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    base32 = base32.toUpperCase().replace(/=+$/, '');
    let length = base32.length;
    let bits = 0;
    let value = 0;
    let index = 0;
    const buffer = Buffer.alloc(Math.floor((length * 5) / 8));

    for (let i = 0; i < length; i++) {
        const val = alphabet.indexOf(base32[i]);
        if (val === -1) throw new Error('Invalid base32 character');
        value = (value << 5) | val;
        bits += 5;
        if (bits >= 8) {
            buffer[index++] = (value >> (bits - 8)) & 255;
            bits -= 8;
        }
    }
    return buffer;
}

// Generate TOTP using crypto module
function generateTOTP(secret, windowOffset = 0) {
    try {
        const key = base32Decode(secret);
        const epoch = Math.floor(Date.now() / 1000);
        const counter = Math.floor(epoch / 30) + windowOffset;

        const buffer = Buffer.alloc(8);
        buffer.writeUInt32BE(0, 0);
        buffer.writeUInt32BE(counter, 4);

        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha1', key).update(buffer).digest();

        const offset = hmac[hmac.length - 1] & 0xf;
        const code =
            ((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff);

        const otp = code % 1000000;
        return String(otp).padStart(6, '0');
    } catch (e) {
        console.error("TOTP Generation Error:", e);
        return null;
    }
}

function verifyTOTP(secret, code) {
    if (!secret || !code) return false;
    for (let i = -1; i <= 1; i++) {
        if (generateTOTP(secret, i) === String(code).trim()) {
            return true;
        }
    }
    return false;
}

// Helper to verify 2FA status in Admin routes
async function checkAdmin2FA(code) {
    try {
        const { data: enabledData } = await supabase.from('admin_settings').select('value').eq('key', '2fa_enabled').maybeSingle();
        if (enabledData && enabledData.value === 'true') {
            const { data: secretData } = await supabase.from('admin_settings').select('value').eq('key', 'totp_secret').maybeSingle();
            if (!secretData || !secretData.value) return false;
            return verifyTOTP(secretData.value, code);
        }
        return true; // 2FA not enabled, allow access
    } catch (err) {
        console.error("checkAdmin2FA error:", err);
        return false;
    }
}

// Middleware to verify Admin password
async function adminAuthMiddleware(req, res, next) {
    const password = req.method === 'GET' ? req.query.password : req.body.password;
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).send('Forbidden');
    }
    next();
}

// 2FA Admin Endpoints

// 1. Get 2FA Enabled Status
app.get('/api/admin/2fa-status', async (req, res) => {
    try {
        const { data } = await supabase.from('admin_settings').select('value').eq('key', '2fa_enabled').maybeSingle();
        res.json({ enabled: (data && data.value === 'true') });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// 2. Generate 2FA Secret Key
app.post('/api/admin/generate-2fa', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');

    try {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let secret = '';
        for (let i = 0; i < 16; i++) {
            secret += chars[Math.floor(Math.random() * chars.length)];
        }

        const issuer = 'Mitsuyoshi Admin';
        const label = 'Mitsuyoshi SaaS';
        const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

        res.json({ secret, otpauth_url: otpauthUrl });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// 3. Enable 2FA after validation
app.post('/api/admin/enable-2fa', async (req, res) => {
    const { password, secret, code } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');
    if (!secret || !code) return res.status(400).send('Secret and Code are required');

    try {
        const isValid = verifyTOTP(secret, code);
        if (!isValid) {
            return res.status(400).json({ status: 'error', message: 'Code 2FA incorrect. Veuillez réessayer.' });
        }

        await supabase.from('admin_settings').upsert({ key: 'totp_secret', value: secret });
        await supabase.from('admin_settings').upsert({ key: '2fa_enabled', value: 'true' });

        res.json({ status: 'success', message: 'Double Authentification activée avec succès.' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// 4. Disable 2FA after validation
app.post('/api/admin/disable-2fa', async (req, res) => {
    const { password, code } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');
    if (!code) return res.status(400).send('Verification code is required');

    try {
        const { data: secretData } = await supabase.from('admin_settings').select('value').eq('key', 'totp_secret').maybeSingle();
        if (!secretData || !secretData.value) {
            return res.status(400).json({ status: 'error', message: '2FA non configuré.' });
        }

        const isValid = verifyTOTP(secretData.value, code);
        if (!isValid) {
            return res.status(400).json({ status: 'error', message: 'Code 2FA incorrect.' });
        }

        await supabase.from('admin_settings').upsert({ key: '2fa_enabled', value: 'false' });
        await supabase.from('admin_settings').delete().eq('key', 'totp_secret');

        res.json({ status: 'success', message: 'Double Authentification désactivée.' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// --- ADMIN ENDPOINTS ---

app.get('/api/admin/all-data', adminAuthMiddleware, async (req, res) => {
    // Check 2FA
    const isAuthorized2FA = await checkAdmin2FA(req.query.code);
    if (!isAuthorized2FA) {
        return res.status(403).json({ status: 'error', code: 'REQUIRE_2FA', message: 'Code 2FA requis ou incorrect.' });
    }
    
    try {
        const { data: users } = await supabase.from('users').select('*');
        const { data: accounts } = await supabase.from('accounts').select('*');
        
        // Fetch affiliate overrides
        const { data: overrideSetting } = await supabase
            .from('admin_settings')
            .select('value')
            .eq('key', 'affiliate_overrides')
            .maybeSingle();

        let overrides = {};
        if (overrideSetting && overrideSetting.value) {
            try {
                overrides = JSON.parse(overrideSetting.value);
            } catch (err) {
                console.error("Parse overrides error in all-data:", err);
            }
        }
        
        const usersList = users || [];
        const accountsList = accounts || [];
        
        let results = usersList.map(u => ({
            user: { 
                email: u.email, 
                fullName: u.full_name,
                referral_code: u.referral_code,
                referred_by: u.referred_by,
                is_affiliate_active: u.is_affiliate_active || false,
                is_community_tier: u.is_community_tier || false,
                withdrawn_commission: parseFloat(u.withdrawn_commission) || 0.00,
                affiliate_rank_override: overrides[u.email] || "auto"
            },
            accounts: accountsList.filter(a => a.email === u.email).map(a => ({
                account_id: a.account_id, 
                balance: a.balance, 
                totalResult: a.total_result,
                winRate: a.win_rate, 
                profitFactor: a.profit_factor, 
                chartData: a.chart_data,
                history: a.history || [], 
                config: a.config || {},
                initial_price_paid: a.initial_price_paid || 0.00
            }))
        }));
        
        res.json(results);
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

app.post('/api/admin/toggle-account', adminAuthMiddleware, async (req, res) => {
    const { account_id, enabled } = req.body;
    
    const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', account_id).single();
    if (acc) {
        const newConfig = { ...acc.config, enabled };
        await supabase.from('accounts').update({ config: newConfig }).eq('account_id', account_id);
        res.json({ status: 'success' });
    } else {
        res.status(404).send('Not Found');
    }
});

app.post('/api/admin/delete-user', adminAuthMiddleware, async (req, res) => {
    const { email } = req.body;
    
    try {
        await supabase.from('accounts').delete().eq('email', email);
        const { error } = await supabase.from('users').delete().eq('email', email);
        if (error) res.status(500).json({ status: 'error', message: error.message });
        else res.json({ status: 'success' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Admin endpoint to manage client affiliate settings and pricing
app.get('/api/admin/update-user-affiliate', async (req, res) => {
    res.json({
        status: 'active',
        message: 'Admin Update User Affiliate Endpoint is active. Please send a POST request with credentials.'
    });
});

app.post('/api/admin/update-user-affiliate', adminAuthMiddleware, async (req, res) => {
    const { email, is_affiliate_active, is_community_tier, affiliate_rank_override, account_prices, account_modes, account_max_targets, account_monthly_prices, account_bypasses, initialize_profit_targets } = req.body;
    
    try {
        // Check if user already has a referral code, generate one if active and missing
        const { data: user } = await supabase.from('users').select('referral_code, first_name').eq('email', email).maybeSingle();
        let newReferralCode = user ? user.referral_code : null;
        
        if (is_affiliate_active && (!newReferralCode || newReferralCode.trim() === "")) {
            const prefix = ((user && user.first_name) ? user.first_name.trim().replace(/[^a-zA-Z]/g, '') : 'MITSU').substring(0, 4).toUpperCase() || 'MITSU';
            const randomNum = Math.floor(1000 + Math.random() * 9000);
            newReferralCode = `${prefix}${randomNum}`;
        }

        // 1. Update user affiliation settings
        const { error: userError } = await supabase
            .from('users')
            .update({ 
                is_affiliate_active, 
                is_community_tier,
                ...(newReferralCode ? { referral_code: newReferralCode } : {})
            })
            .eq('email', email);
            
        if (userError) return res.status(400).json({ status: 'error', message: userError.message });

        // Update affiliate_rank_override in admin_settings key 'affiliate_overrides'
        if (affiliate_rank_override !== undefined) {
            const { data: overrideSetting } = await supabase
                .from('admin_settings')
                .select('value')
                .eq('key', 'affiliate_overrides')
                .maybeSingle();

            let overrides = {};
            if (overrideSetting && overrideSetting.value) {
                try {
                    overrides = JSON.parse(overrideSetting.value);
                } catch (err) {
                    console.error("Parse overrides error during update:", err);
                }
            }

            if (affiliate_rank_override === 'auto') {
                delete overrides[email];
            } else {
                overrides[email] = affiliate_rank_override;
            }

            await supabase
                .from('admin_settings')
                .upsert({ key: 'affiliate_overrides', value: JSON.stringify(overrides) });
        }
        
        // 2. Update initial price paid for accounts if provided
        if (account_prices && typeof account_prices === 'object') {
            for (const [accountId, price] of Object.entries(account_prices)) {
                await supabase
                    .from('accounts')
                    .update({ initial_price_paid: parseFloat(price) || 0 })
                    .eq('account_id', accountId)
                    .eq('email', email);
            }
        }

        // 3. Update account modes, monthly prices, and max profit target pct in JSONB config if provided
        const allAccountIds = new Set([
            ...Object.keys(account_modes || {}),
            ...Object.keys(account_max_targets || {}),
            ...Object.keys(account_monthly_prices || {}),
            ...Object.keys(account_bypasses || {})
        ]);

        for (const accountId of allAccountIds) {
            const { data: acc } = await supabase
                .from('accounts')
                .select('config, balance')
                .eq('account_id', accountId)
                .eq('email', email)
                .maybeSingle();

            if (acc) {
                const balance = parseFloat(acc.balance) || 0.0;
                const currentConfig = acc.config || {};
                
                let maxTarget = 1.25;
                if (account_max_targets && account_max_targets[accountId] !== undefined) {
                    const parsed = parseFloat(account_max_targets[accountId]);
                    if (!isNaN(parsed) && parsed > 0) {
                        maxTarget = parsed < 0.1 ? 0.1 : parsed;
                    }
                } else if (currentConfig.max_daily_profit_target_pct !== undefined) {
                    maxTarget = parseFloat(currentConfig.max_daily_profit_target_pct) || 1.25;
                }

                const newConfig = {
                    ...currentConfig,
                    ...(account_modes && account_modes[accountId] !== undefined ? { mode: account_modes[accountId] } : {}),
                    max_daily_profit_target_pct: maxTarget,
                    ...(account_monthly_prices && account_monthly_prices[accountId] !== undefined ? { monthly_price: parseFloat(account_monthly_prices[accountId]) || 0 } : {}),
                    ...(account_bypasses && account_bypasses[accountId] !== undefined ? { bypass_payment: !!account_bypasses[accountId] } : {})
                };

                if (initialize_profit_targets) {
                    const isProp = (maxTarget <= 0.65);
                    const calcBalance = isProp ? balance : Math.max(1000, balance);
                    const maxAllowedDollars = Math.ceil(calcBalance * (maxTarget / 100) * 100) / 100;
                    newConfig.daily_profit_target = maxAllowedDollars;
                }

                await supabase
                    .from('accounts')
                    .update({ config: newConfig })
                    .eq('account_id', accountId)
                    .eq('email', email);
            }
        }
        
        res.json({ status: 'success', message: 'Paramètres utilisateur et abonnements mis à jour.', referral_code: newReferralCode });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Admin endpoint to delete an MT5 account
app.get('/api/admin/delete-account', async (req, res) => {
    res.json({
        status: 'active',
        message: 'Admin Delete Account Endpoint is active. Please send a POST request with credentials.'
    });
});

app.post('/api/admin/delete-account', adminAuthMiddleware, async (req, res) => {
    const { email, account_id } = req.body;
    
    try {
        const { error } = await supabase
            .from('accounts')
            .delete()
            .eq('account_id', account_id)
            .eq('email', email);
            
        if (error) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
        res.json({ status: 'success' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// --- AFFILIATION PARTNERSHIP ENDPOINTS ---

// Check if a referral code is available
app.get('/api/check-referral-code', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) {
            return res.status(400).json({ available: false, message: 'Le code est requis.' });
        }
        
        const cleanCode = code.trim().toUpperCase();
        
        // Alphanumeric, 4 to 8 chars check
        const regex = /^[A-Z0-9]{4,8}$/;
        if (!regex.test(cleanCode)) {
            return res.status(400).json({ available: false, message: 'Le code doit contenir entre 4 et 8 caractères alphanumériques (lettres et chiffres).' });
        }
        
        // Query users database
        const { data: existingUser, error } = await supabase
            .from('users')
            .select('email')
            .ilike('referral_code', cleanCode)
            .maybeSingle();
            
        if (error) {
            return res.status(500).json({ available: false, message: 'Erreur serveur lors de la vérification.' });
        }
        
        if (existingUser) {
            return res.json({ available: false, message: 'Ce code de parrainage est déjà utilisé par un autre membre.' });
        }
        
        res.json({ available: true, message: 'Ce code de parrainage est disponible.' });
    } catch (e) {
        res.status(500).json({ available: false, message: e.message });
    }
});

// Activate partnership for user with custom code
app.post('/api/activate-affiliate', async (req, res) => {
    try {
        const { email, referralCode } = req.body;
        if (!email || !referralCode) {
            return res.status(400).json({ status: 'error', message: 'Tous les champs sont requis.' });
        }
        
        const cleanCode = referralCode.trim().toUpperCase();
        
        // Validate length and format
        const regex = /^[A-Z0-9]{4,8}$/;
        if (!regex.test(cleanCode)) {
            return res.status(400).json({ status: 'error', message: 'Le code doit contenir entre 4 et 8 caractères alphanumériques.' });
        }
        
        // Check if code taken
        const { data: codeOwner } = await supabase
            .from('users')
            .select('email')
            .ilike('referral_code', cleanCode)
            .maybeSingle();
            
        if (codeOwner) {
            return res.status(400).json({ status: 'error', message: 'Ce code de parrainage est déjà pris.' });
        }
        
        // Update user
        const { error } = await supabase
            .from('users')
            .update({
                is_affiliate_active: true,
                referral_code: cleanCode
            })
            .eq('email', email);
            
        if (error) return res.status(400).json({ status: 'error', message: error.message });
        
        res.json({ status: 'success', message: 'Votre espace partenaire a été activé avec le code : ' + cleanCode });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Get dynamic calculations and list of referred clients for client dashboard
app.get('/api/dashboard/affiliation', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).send('Email is required');
        
        // 1. Fetch current user
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('referral_code, is_affiliate_active, is_community_tier, withdrawn_commission')
            .eq('email', email)
            .maybeSingle();
            
        if (userError || !user) {
            return res.status(404).json({ status: 'error', message: 'Utilisateur non trouvé.' });
        }
        
        // Default response if not active
        if (!user.is_affiliate_active) {
            return res.json({
                is_affiliate_active: false,
                referral_code: null,
                is_community_tier: false,
                stats: { referred_count: 0, sales_count: 0, total_sales_amount: 0, projected_comm: 0, earned_comm: 0, withdrawn_comm: 0, is_eligible: false, min_required: 1 },
                referred_list: [],
                chart_data: []
            });
        }

        // Self-healing database cleanup of whitespaces & casing in referral codes
        try {
            const { data: allUsers } = await supabase.from('users').select('email, referral_code, referred_by');
            if (allUsers) {
                for (const u of allUsers) {
                    let updated = false;
                    const updatePayload = {};
                    if (u.referral_code && u.referral_code !== u.referral_code.trim().toUpperCase()) {
                        updatePayload.referral_code = u.referral_code.trim().toUpperCase();
                        updated = true;
                    }
                    if (u.referred_by && u.referred_by !== u.referred_by.trim().toUpperCase()) {
                        updatePayload.referred_by = u.referred_by.trim().toUpperCase();
                        updated = true;
                    }
                    if (updated) {
                        await supabase.from('users').update(updatePayload).eq('email', u.email);
                    }
                }
            }
        } catch (err) {
            console.error("Cleanup referrals error:", err);
        }
        
        let referralCode = user.referral_code;
        if (!referralCode || referralCode.trim() === "") {
            const prefix = 'MITSU';
            const randomNum = Math.floor(1000 + Math.random() * 9000);
            referralCode = `${prefix}${randomNum}`;
            await supabase.from('users').update({ referral_code: referralCode }).eq('email', email);
        }
        
        // 2. Fetch referred users
        const { data: referredUsers } = await supabase
            .from('users')
            .select('email, full_name')
            .ilike('referred_by', referralCode.trim());
            
        const referredList = referredUsers || [];
        const referredEmails = referredList.map(ru => ru.email);
        
        // 3. Fetch accounts of referred users to calculate active sales
        let referredAccounts = [];
        if (referredEmails.length > 0) {
            const { data: accounts } = await supabase
                .from('accounts')
                .select('email, account_id, initial_price_paid, balance, last_update')
                .in('email', referredEmails);
            referredAccounts = accounts || [];
        }
        
        // 1. Calculate salesCount first
        let salesCount = 0;
        referredList.forEach(ru => {
            const hasActiveAccount = referredAccounts.some(a => a.email === ru.email);
            if (hasActiveAccount) {
                salesCount++;
            }
        });

        // 2. Fetch overrides
        const { data: overrideSetting } = await supabase
            .from('admin_settings')
            .select('value')
            .eq('key', 'affiliate_overrides')
            .maybeSingle();

        let overrides = {};
        if (overrideSetting && overrideSetting.value) {
            try {
                overrides = JSON.parse(overrideSetting.value);
            } catch (err) {
                console.error("Parse overrides error in dashboard:", err);
            }
        }

        const userOverride = overrides[email] || null;

        // 3. Determine rank and commission rate
        let rank = 'bronze';
        let commissionRate = 0.23;
        let rankTitle = 'Ambassadeur Bronze';
        let rankBadge = '🥉';

        const checkRank = userOverride || (
            salesCount >= 50 ? 'diamond' :
            salesCount >= 25 ? 'gold' :
            salesCount >= 10 ? 'silver' : 'bronze'
        );

        if (checkRank === 'diamond' || checkRank === 'diamant') {
            rank = 'diamond';
            commissionRate = 0.40;
            rankTitle = 'Ambassadeur Diamant';
            rankBadge = '👑';
        } else if (checkRank === 'gold' || checkRank === 'or') {
            rank = 'gold';
            commissionRate = 0.35;
            rankTitle = 'Ambassadeur Or';
            rankBadge = '🥇';
        } else if (checkRank === 'silver' || checkRank === 'argent') {
            rank = 'silver';
            commissionRate = 0.30;
            rankTitle = 'Ambassadeur Argent';
            rankBadge = '🥈';
        } else {
            rank = 'bronze';
            commissionRate = 0.23;
            rankTitle = 'Ambassadeur Bronze';
            rankBadge = '🥉';
        }

        // Everyone needs at least 1 sale to withdraw
        const minSalesRequired = 1;

        let totalSalesAmount = 0;
        let projectedComm = 0;
        
        const finalReferredList = referredList.map(ru => {
            const userAccounts = referredAccounts.filter(a => a.email === ru.email);
            const hasActiveAccount = userAccounts.length > 0;
            
            // Total price paid by this user for their accounts
            const pricePaid = userAccounts.reduce((sum, a) => sum + (parseFloat(a.initial_price_paid) || 0), 0);
            const comm = pricePaid * commissionRate;
            
            // Get the earliest last_update as the activation date
            let dateJoined = null;
            if (hasActiveAccount) {
                const updates = userAccounts.map(a => a.last_update).filter(Boolean);
                if (updates.length > 0) {
                    updates.sort((a, b) => new Date(a) - new Date(b));
                    dateJoined = updates[0];
                }
            }
            
            if (hasActiveAccount) {
                totalSalesAmount += pricePaid;
                projectedComm += comm;
            }
            
            return {
                fullName: ru.full_name,
                email: ru.email,
                dateJoined: dateJoined,
                hasActiveAccount: hasActiveAccount,
                pricePaid: pricePaid,
                commission: comm
            };
        });
        
        const isEligible = (salesCount >= minSalesRequired);
        const earnedComm = isEligible ? projectedComm : 0;
        const withdrawnComm = parseFloat(user.withdrawn_commission) || 0.00;
        const withdrawableComm = Math.max(0, earnedComm - withdrawnComm);
        
        // Sort active affiliates chronologically by signup date to build a cumulative timeline
        const activeAffiliates = finalReferredList
            .filter(item => item.hasActiveAccount && item.dateJoined)
            .sort((a, b) => new Date(a.dateJoined) - new Date(b.dateJoined));
            
        let chartData = [{ x: 'Lancement', y: 0 }];
        let cumulativeY = 0;
        
        activeAffiliates.forEach(item => {
            cumulativeY += item.commission;
            const date = new Date(item.dateJoined);
            const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
            
            chartData.push({
                x: dateStr,
                y: parseFloat(cumulativeY.toFixed(2))
            });
        });
        
        res.json({
            is_affiliate_active: true,
            referral_code: user.referral_code,
            is_community_tier: user.is_community_tier || (commissionRate >= 0.30),
            rank: rank,
            rank_title: rankTitle,
            rank_badge: rankBadge,
            commission_rate: commissionRate,
            stats: {
                referred_count: finalReferredList.length,
                sales_count: salesCount,
                total_sales_amount: totalSalesAmount,
                projected_comm: parseFloat(projectedComm.toFixed(2)),
                earned_comm: parseFloat(withdrawableComm.toFixed(2)),
                withdrawn_comm: parseFloat(withdrawnComm.toFixed(2)),
                is_eligible: isEligible,
                min_required: minSalesRequired
            },
            referred_list: finalReferredList,
            chart_data: chartData
        });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

app.get('/api/affiliation/leaderboard', async (req, res) => {
    try {
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('email, referral_code, referred_by, is_affiliate_active');

        if (usersError) return res.status(500).json({ status: 'error', message: usersError.message });

        const { data: accounts, error: accountsError } = await supabase
            .from('accounts')
            .select('email, initial_price_paid');

        if (accountsError) return res.status(500).json({ status: 'error', message: accountsError.message });

        const { data: overrideSetting } = await supabase
            .from('admin_settings')
            .select('value')
            .eq('key', 'affiliate_overrides')
            .maybeSingle();

        let overrides = {};
        if (overrideSetting && overrideSetting.value) {
            try {
                overrides = JSON.parse(overrideSetting.value);
            } catch (err) {
                console.error("Parse overrides error in leaderboard:", err);
            }
        }

        const affiliates = (users || []).filter(u => u.is_affiliate_active && u.referral_code);

        const leaderboard = affiliates.map(aff => {
            const code = aff.referral_code.trim().toUpperCase();
            const referred = users.filter(u => u.referred_by && u.referred_by.trim().toUpperCase() === code);
            
            let salesCount = 0;
            let totalSalesAmount = 0;
            
            referred.forEach(ru => {
                const ruAccounts = accounts.filter(a => a.email === ru.email);
                if (ruAccounts.length > 0) {
                    salesCount++;
                    const pricePaid = ruAccounts.reduce((sum, a) => sum + (parseFloat(a.initial_price_paid) || 0), 0);
                    totalSalesAmount += pricePaid;
                }
            });

            const userOverride = overrides[aff.email] || null;
            const checkRank = userOverride || (
                salesCount >= 50 ? 'diamond' :
                salesCount >= 25 ? 'gold' :
                salesCount >= 10 ? 'silver' : 'bronze'
            );

            let rate = 0.23;
            if (checkRank === 'diamond' || checkRank === 'diamant') rate = 0.40;
            else if (checkRank === 'gold' || checkRank === 'or') rate = 0.35;
            else if (checkRank === 'silver' || checkRank === 'argent') rate = 0.30;

            const projectedComm = totalSalesAmount * rate;

            return {
                referral_code: code,
                sales_count: salesCount,
                gains: parseFloat(projectedComm.toFixed(2))
            };
        });

        leaderboard.sort((a, b) => b.gains - a.gains || b.sales_count - a.sales_count);

        res.json(leaderboard.slice(0, 50));
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// --- DASHBOARD DATA ---

app.get('/api/dashboard', async (req, res) => {
    const email = req.query.email;
    const { data: accounts } = await supabase.from('accounts').select('*').eq('email', email);
    
    res.json(accounts.map(a => ({
        account_id: a.account_id, balance: a.balance, totalResult: a.total_result,
        winRate: a.win_rate, profitFactor: a.profit_factor, chartData: a.chart_data,
        history: a.history, config: a.config
    })));
});

app.post('/api/update-config', async (req, res) => {
    const { email, account_id, config } = req.body;
    const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', account_id).single();
    
    if (acc) {
        const newConfig = { ...acc.config, ...config };
        await supabase.from('accounts').update({ config: newConfig }).eq('account_id', account_id);
        res.json({ status: 'success' });
    } else {
        res.status(404).send('Not Found');
    }
});

// Admin endpoint to record manual payout (withdrawn_commission increment)
app.post('/api/admin/create-withdrawal', adminAuthMiddleware, async (req, res) => {
    const { email, amount } = req.body;
    if (!email || isNaN(parseFloat(amount))) return res.status(400).send('Invalid request payload');

    try {
        const { data: user, error: fetchErr } = await supabase
            .from('users')
            .select('withdrawn_commission')
            .eq('email', email)
            .maybeSingle();

        if (fetchErr || !user) return res.status(404).send('User not found');

        const currentWithdrawn = parseFloat(user.withdrawn_commission) || 0.00;
        const newWithdrawn = currentWithdrawn + parseFloat(amount);

        const { error: updateErr } = await supabase
            .from('users')
            .update({ withdrawn_commission: newWithdrawn })
            .eq('email', email);

        if (updateErr) return res.status(500).json({ status: 'error', message: updateErr.message });

        res.json({ status: 'success', message: 'Retrait enregistré.', withdrawn_total: newWithdrawn });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// --- STRIPE SUBSCRIPTIONS ---
 
app.post('/api/stripe/create-checkout-session', async (req, res) => {
    const { email, account_id, is_test_zero } = req.body;
    if (!email || !account_id) {
        return res.status(400).json({ status: 'error', message: 'Paramètres manquants.' });
    }
 
    try {
        // Fetch the account from Supabase to securely read the monthly price
        const { data: acc } = await supabase
            .from('accounts')
            .select('config')
            .eq('account_id', String(account_id))
            .single();
 
        const config = (acc && acc.config) ? acc.config : {};
        let monthlyPrice = (config.monthly_price !== undefined && config.monthly_price !== null) ? parseFloat(config.monthly_price) : 50.00;
        if (is_test_zero) {
            monthlyPrice = 0.0;
        }
 
        // Get or Create Stripe Customer
        let customerList = await stripe.customers.list({ email: email, limit: 1 });
        let customerId;
        if (customerList.data.length > 0) {
            customerId = customerList.data[0].id;
        } else {
            const customer = await stripe.customers.create({ email: email });
            customerId = customer.id;
        }
 
        // Create Price dynamically
        const price = await stripe.prices.create({
            unit_amount: Math.round(monthlyPrice * 100),
            currency: 'eur',
            recurring: { interval: 'month' },
            product_data: {
                name: `Abonnement Maintenance Mitsuyoshi (Compte #${account_id})`
            }
        });
 
        // Create Checkout Session
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [{ price: price.id, quantity: 1 }],
            mode: 'subscription',
            success_url: `${req.headers.origin || 'https://mitsuyoshi-system.com'}/dashboard?stripe_status=success&account_id=${account_id}`,
            cancel_url: `${req.headers.origin || 'https://mitsuyoshi-system.com'}/dashboard?stripe_status=cancel`,
            metadata: {
                account_id: String(account_id),
                email: email,
                monthly_price: String(monthlyPrice)
            }
        });
 
        res.json({ url: session.url });
    } catch (e) {
        console.error("Create Checkout Session Error:", e);
        res.status(500).json({ status: 'error', message: e.message });
    }
});
 
app.post('/api/stripe/create-portal-session', async (req, res) => {
    const { email, account_id } = req.body;
    if (!email || !account_id) {
        return res.status(400).json({ status: 'error', message: 'Paramètres manquants.' });
    }
 
    try {
        const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', String(account_id)).single();
        
        let customerId = acc && acc.config && acc.config.stripe_customer_id;
        if (!customerId) {
            let customerList = await stripe.customers.list({ email: email, limit: 1 });
            if (customerList.data.length > 0) {
                customerId = customerList.data[0].id;
            } else {
                return res.status(400).json({ status: 'error', message: "Aucun client Stripe trouvé. Veuillez vous abonner d'abord." });
            }
        }
 
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${req.headers.origin || 'https://mitsuyoshi-system.com'}/dashboard`
        });
 
        res.json({ url: session.url });
    } catch (e) {
        console.error("Create Portal Session Error:", e);
        res.status(500).json({ status: 'error', message: e.message });
    }
});
 
app.post('/api/stripe/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = (process.env.STRIPE_WEBHOOK_SECRET || 'whsec_c10ralQEVI4TeIUW75FTeENFuRFO2s2G').trim();
    
    let event;
    try {
        event = await stripe.webhooks.constructEventAsync(req.rawBody, sig, endpointSecret);
    } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
 
    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const metadata = session.metadata || {};
            const customerEmail = session.customer_details ? session.customer_details.email : metadata.email;
            
            if (customerEmail) {
                // Find all accounts belonging to this email
                const { data: accounts } = await supabase.from('accounts').select('account_id, config').eq('email', customerEmail);
                
                let monthlyPrice = 0;
                try {
                    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
                    if (lineItems.data.length > 0) {
                        monthlyPrice = (lineItems.data[0].amount_total || 0) / 100;
                    }
                } catch (e) {
                    console.error("Error retrieving line items:", e);
                }
 
                if (accounts && accounts.length > 0) {
                    for (const acc of accounts) {
                        const newConfig = {
                            ...acc.config,
                            stripe_customer_id: session.customer,
                            stripe_subscription_id: session.subscription,
                            stripe_status: 'active',
                            monthly_price: monthlyPrice,
                            enabled: true // Enable account when paid
                        };
                        await supabase.from('accounts').update({ config: newConfig }).eq('account_id', acc.account_id);
                    }
                }
            }
        } else if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;
            const subId = subscription.id;
            
            // Find all accounts where config has this subscription ID
            const { data: accounts } = await supabase.from('accounts').select('account_id, config');
            if (accounts) {
                const targetAccounts = accounts.filter(a => a.config && a.config.stripe_subscription_id === subId);
                for (const acc of targetAccounts) {
                    const newConfig = {
                        ...acc.config,
                        stripe_status: 'canceled',
                        monthly_price: 0,
                        enabled: false // Disable account when subscription canceled
                    };
                    await supabase.from('accounts').update({ config: newConfig }).eq('account_id', acc.account_id);
                }
            }
        }
        
        res.json({ received: true });
    } catch (e) {
        console.error("Webhook processing error:", e);
        res.status(500).send("Internal Webhook Error");
    }
});
 
// --- GLOBAL CUMULATIVE GAINS ENDPOINTS ---

app.get('/api/community/gains', async (req, res) => {
    try {
        const { data: accounts, error: accountsError } = await supabase
            .from('accounts')
            .select('total_result');
            
        if (accountsError) return res.status(500).json({ status: 'error', message: accountsError.message });
        
        let totalProfit = 0;
        if (accounts) {
            accounts.forEach(a => {
                totalProfit += parseFloat(a.total_result) || 0;
            });
        }
        res.json({ status: 'success', gains: totalProfit });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Export pour Vercel (Mode Serverless)
module.exports = app;

// Garder le listen uniquement pour le local (si lancé via node api_server.js)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`API Server running on port ${PORT}`));
}
