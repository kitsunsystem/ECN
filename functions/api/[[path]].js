// Cloudflare Pages Trigger Redeploy
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';

// Helper to handle CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    // Initialize Stripe using Cloudflare Environment variable
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    
    // Handle OPTIONS request for CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // Initialize Supabase Client using Environment Variables set on Cloudflare
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_KEY;
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || "MITSU_ADMIN_2026";

    if (!supabaseUrl || !supabaseKey) {
        return new Response(JSON.stringify({ status: 'error', message: 'Cloudflare configuration error: SUPABASE_URL or SUPABASE_KEY is missing' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // --- 1. SIGNUP ---
        if (path === '/api/signup' && request.method === 'POST') {
            const { firstName, lastName, email, password, referredByCode } = await request.json();
            
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
                    return new Response(JSON.stringify({ status: 'error', message: "Erreur de base de données lors de la vérification du parrainage." }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                if (!codeOwner) {
                    return new Response(JSON.stringify({ status: 'error', message: "Le code de parrainage saisi n'existe pas. Veuillez le corriger ou vider le champ." }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
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

            if (error) {
                return new Response(JSON.stringify({ status: 'error', message: error.message }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ status: 'success', message: 'Account created' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 2. LOGIN ---
        if (path === '/api/login' && request.method === 'POST') {
            const { email, password } = await request.json();
            const { data, error } = await supabase.from('users').select('*').eq('email', email).single();

            if (data && await bcrypt.compare(password, data.password)) {
                return new Response(JSON.stringify({ status: 'success', user: { email: data.email, fullName: data.full_name } }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response(JSON.stringify({ status: 'error', message: 'Invalid credentials' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 3. UPDATE PASSWORD ---
        if (path === '/api/update-password' && request.method === 'POST') {
            const { email, oldPassword, newPassword } = await request.json();
            const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
            
            if (user && await bcrypt.compare(oldPassword, user.password)) {
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                const { error } = await supabase.from('users').update({ password: hashedPassword }).eq('email', email);
                if (error) {
                    return new Response(JSON.stringify({ status: 'error', message: error.message }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                return new Response(JSON.stringify({ status: 'success', message: 'Password updated' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response(JSON.stringify({ status: 'error', message: 'Incorrect old password' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 4. MT5 STATS PUSH ---
        if (path === '/api/stats') {
            if (request.method === 'GET') {
                return new Response(JSON.stringify({
                    status: 'active',
                    message: 'Mitsuyoshi EA Stats Endpoint is active. Please send a POST request with account data.'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', { status: 405 });
            }
            const data = await request.json();
            if (!data || !data.email) {
                return new Response('Invalid data', { status: 400 });
            }

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
            const isProp = (config.is_propfirm === true) || (maxDailyProfitTargetPct <= 0.65);
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

            // Check if this account is one of the master accounts
            const { data: masterSettings } = await supabase
                .from('admin_settings')
                .select('*')
                .in('key', ['master_acc_safe', 'master_acc_normal', 'master_acc_debrid']);
            
            const masterIds = (masterSettings || []).map(s => String(s.value));
            const isMaster = masterIds.includes(String(data.account_id));

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
            const targetInt = Math.round(targetVal);
            const targetIntStr = String(targetInt);
            const targetPct = (balanceVal > 0) ? ((targetVal / balanceVal) * 100) : 0.0;
            const targetPctStr = targetPct.toFixed(2);

            const returnConfig = {
                ...config,
                enabled: isMaster ? true : ((config.enabled !== false) && (config.client_enabled !== false) && isPaidOrBypassed),
                
                // Snake Case (Float)
                daily_profit_target: targetVal,
                profit_target: targetVal,
                daily_profit_limit: targetVal,
                daily_limit: targetVal,
                take_profit: targetVal,
                daily_take_profit: targetVal,
                
                // Camel Case (Float)
                dailyProfitTarget: targetVal,
                profitTarget: targetVal,
                dailyProfitLimit: targetVal,
                dailyLimit: targetVal,
                takeProfit: targetVal,
                dailyTakeProfit: targetVal,
                
                // Strings
                daily_profit_target_str: targetStr,
                profit_target_str: targetStr,
                daily_profit_limit_str: targetStr,
                daily_limit_str: targetStr,
                take_profit_str: targetStr,
                daily_take_profit_str: targetStr,
                
                dailyProfitTargetStr: targetStr,
                profitTargetStr: targetStr,
                dailyProfitLimitStr: targetStr,
                dailyLimitStr: targetStr,
                takeProfitStr: targetStr,
                dailyTakeProfitStr: targetStr,
                
                // Cents & Integer
                daily_profit_target_cents: targetInt * 100,
                profit_target_cents: targetInt * 100,
                daily_profit_target_int: targetInt,
                profit_target_int: targetInt,
                daily_profit_target_int_str: targetIntStr,
                profit_target_int_str: targetIntStr,
                
                // Percentage
                daily_profit_target_pct: targetPct,
                profit_target_pct: targetPct,
                daily_profit_target_pct_str: targetPctStr,
                profit_target_pct_str: targetPctStr,
                dailyProfitTargetPct: targetPct,
                profitTargetPct: targetPct
            };
            return new Response(JSON.stringify({ 
                status: 'success', 
                config: returnConfig,
                
                // Snake Case (Float)
                daily_profit_target: targetVal,
                profit_target: targetVal,
                daily_profit_limit: targetVal,
                daily_limit: targetVal,
                take_profit: targetVal,
                daily_take_profit: targetVal,
                
                // Camel Case (Float)
                dailyProfitTarget: targetVal,
                profitTarget: targetVal,
                dailyProfitLimit: targetVal,
                dailyLimit: targetVal,
                takeProfit: targetVal,
                dailyTakeProfit: targetVal,
                
                // Strings
                daily_profit_target_str: targetStr,
                profit_target_str: targetStr,
                daily_profit_limit_str: targetStr,
                daily_limit_str: targetStr,
                take_profit_str: targetStr,
                daily_take_profit_str: targetStr,
                
                dailyProfitTargetStr: targetStr,
                profitTargetStr: targetStr,
                dailyProfitLimitStr: targetStr,
                dailyLimitStr: targetStr,
                takeProfitStr: targetStr,
                dailyTakeProfitStr: targetStr,
                
                // Cents & Integer
                daily_profit_target_cents: targetInt * 100,
                profit_target_cents: targetInt * 100,
                daily_profit_target_int: targetInt,
                profit_target_int: targetInt,
                daily_profit_target_int_str: targetIntStr,
                profit_target_int_str: targetIntStr,
                
                // Percentage
                daily_profit_target_pct: targetPct,
                profit_target_pct: targetPct,
                daily_profit_target_pct_str: targetPctStr,
                profit_target_pct_str: targetPctStr,
                dailyProfitTargetPct: targetPct,
                profitTargetPct: targetPct
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- ADMIN 2FA UTILITIES ---

        // Base32 Alphabet Decode Helper
        function base32Decode(base32) {
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
            base32 = base32.toUpperCase().replace(/=+$/, '');
            let length = base32.length;
            let bits = 0;
            let value = 0;
            let index = 0;
            const buffer = new Uint8Array(Math.floor((length * 5) / 8));

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

        // Generate TOTP using Cloudflare Web Crypto Subtle API
        async function generateTOTP(secret, windowOffset = 0) {
            try {
                const keyBytes = base32Decode(secret);
                const epoch = Math.floor(Date.now() / 1000);
                const counter = Math.floor(epoch / 30) + windowOffset;

                // Convert counter to 8-byte big-endian Uint8Array
                const counterBytes = new Uint8Array(8);
                for (let i = 7; i >= 4; i--) {
                    counterBytes[i] = (counter >> (8 * (7 - i))) & 0xff;
                }

                // Import HMAC Key
                const cryptoKey = await crypto.subtle.importKey(
                    'raw',
                    keyBytes,
                    { name: 'HMAC', hash: { name: 'SHA-1' } },
                    false,
                    ['sign']
                );

                // Sign HMAC
                const hmacBuffer = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
                const hmac = new Uint8Array(hmacBuffer);

                // Dynamic Truncation
                const offset = hmac[hmac.length - 1] & 0xf;
                const code =
                    ((hmac[offset] & 0x7f) << 24) |
                    ((hmac[offset + 1] & 0xff) << 16) |
                    ((hmac[offset + 2] & 0xff) << 8) |
                    (hmac[offset + 3] & 0xff);

                const otp = code % 1000000;
                return String(otp).padStart(6, '0');
            } catch (e) {
                console.error("Cloudflare TOTP Gen Error:", e);
                return null;
            }
        }

        async function verifyTOTP(secret, code) {
            if (!secret || !code) return false;
            for (let i = -1; i <= 1; i++) {
                const generated = await generateTOTP(secret, i);
                if (generated === String(code).trim()) {
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
                    return await verifyTOTP(secretData.value, code);
                }
                return true; // 2FA not enabled, allow access
            } catch (err) {
                console.error("checkAdmin2FA error:", err);
                return false;
            }
        }

        // Unified admin authorization helper
        async function checkAdminAuth(reqData, method, urlParams, require2FA = false) {
            const password = method === 'GET' ? urlParams.get('password') : reqData.password;
            const code = method === 'GET' ? urlParams.get('code') : reqData.code;

            if (password !== ADMIN_PASSWORD) {
                return { authorized: false, status: 403, error: 'Forbidden', message: 'Forbidden' };
            }

            if (require2FA) {
                const isAuthorized2FA = await checkAdmin2FA(code);
                if (!isAuthorized2FA) {
                    return { authorized: false, status: 403, error: 'REQUIRE_2FA', message: 'Code 2FA requis ou incorrect.' };
                }
            }
            return { authorized: true };
        }

        // 2FA Admin Endpoints

        // 1. Get 2FA Enabled Status
        if (path === '/api/admin/2fa-status' && request.method === 'GET') {
            try {
                const { data } = await supabase.from('admin_settings').select('value').eq('key', '2fa_enabled').maybeSingle();
                return new Response(JSON.stringify({ enabled: (data && data.value === 'true') }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 2. Generate 2FA Secret Key
        if (path === '/api/admin/generate-2fa' && request.method === 'POST') {
            const { password } = await request.json();
            if (password !== ADMIN_PASSWORD) {
                return new Response('Forbidden', { status: 403 });
            }

            try {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
                let secret = '';
                for (let i = 0; i < 16; i++) {
                    secret += chars[Math.floor(Math.random() * chars.length)];
                }

                const issuer = 'Mitsuyoshi Admin';
                const label = 'Mitsuyoshi SaaS';
                const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

                return new Response(JSON.stringify({ secret, otpauth_url: otpauthUrl }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 3. Enable 2FA after validation
        if (path === '/api/admin/enable-2fa' && request.method === 'POST') {
            const { password, secret, code } = await request.json();
            if (password !== ADMIN_PASSWORD) {
                return new Response('Forbidden', { status: 403 });
            }
            if (!secret || !code) {
                return new Response('Secret and Code are required', { status: 400 });
            }

            try {
                const isValid = await verifyTOTP(secret, code);
                if (!isValid) {
                    return new Response(JSON.stringify({ status: 'error', message: 'Code 2FA incorrect. Veuillez réessayer.' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                await supabase.from('admin_settings').upsert({ key: 'totp_secret', value: secret });
                await supabase.from('admin_settings').upsert({ key: '2fa_enabled', value: 'true' });

                return new Response(JSON.stringify({ status: 'success', message: 'Double Authentification activée avec succès.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 4. Disable 2FA after validation
        if (path === '/api/admin/disable-2fa' && request.method === 'POST') {
            const { password, code } = await request.json();
            if (password !== ADMIN_PASSWORD) {
                return new Response('Forbidden', { status: 403 });
            }
            if (!code) {
                return new Response('Verification code is required', { status: 400 });
            }

            try {
                const { data: secretData } = await supabase.from('admin_settings').select('value').eq('key', 'totp_secret').maybeSingle();
                if (!secretData || !secretData.value) {
                    return new Response(JSON.stringify({ status: 'error', message: '2FA non configuré.' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const isValid = await verifyTOTP(secretData.value, code);
                if (!isValid) {
                    return new Response(JSON.stringify({ status: 'error', message: 'Code 2FA incorrect.' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                await supabase.from('admin_settings').upsert({ key: '2fa_enabled', value: 'false' });
                await supabase.from('admin_settings').delete().eq('key', 'totp_secret');

                return new Response(JSON.stringify({ status: 'success', message: 'Double Authentification désactivée.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        if (path === '/api/admin/all-data' && request.method === 'GET') {
            const auth = await checkAdminAuth(null, 'GET', url.searchParams, true);
            if (!auth.authorized) {
                return new Response(JSON.stringify({ status: 'error', code: auth.error, message: auth.message || auth.error }), {
                    status: auth.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            const { data: users } = await supabase.from('users').select('*');
            const { data: accounts } = await supabase.from('accounts').select('*');
            
            // Fetch affiliate overrides and crypto addresses
            const { data: settingsData } = await supabase
                .from('admin_settings')
                .select('key, value')
                .in('key', ['affiliate_overrides', 'aff_crypto_addresses']);

            let overrides = {};
            let cryptoAddresses = {};
            if (settingsData) {
                settingsData.forEach(row => {
                    if (row.key === 'affiliate_overrides' && row.value) {
                        try { overrides = JSON.parse(row.value); } catch (e) {}
                    }
                    if (row.key === 'aff_crypto_addresses' && row.value) {
                        try { cryptoAddresses = JSON.parse(row.value); } catch (e) {}
                    }
                });
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
                    affiliate_rank_override: overrides[u.email] || "auto",
                    cryptoAddress: cryptoAddresses[u.email] || ""
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
            
            return new Response(JSON.stringify(results), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        if (path === '/api/admin/toggle-account' && request.method === 'POST') {
            const reqData = await request.json();
            const auth = await checkAdminAuth(reqData, 'POST', null);
            if (!auth.authorized) {
                return new Response(JSON.stringify({ status: 'error', code: auth.error, message: auth.message || auth.error }), {
                    status: auth.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            const { account_id, enabled } = reqData;
            
            const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', account_id).single();
            if (acc) {
                const newConfig = { ...acc.config, enabled };
                await supabase.from('accounts').update({ config: newConfig }).eq('account_id', account_id);
                return new Response(JSON.stringify({ status: 'success' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response('Not Found', { status: 404 });
            }
        }

        if (path === '/api/admin/delete-user' && request.method === 'POST') {
            const reqData = await request.json();
            const auth = await checkAdminAuth(reqData, 'POST', null);
            if (!auth.authorized) {
                return new Response(JSON.stringify({ status: 'error', code: auth.error, message: auth.message || auth.error }), {
                    status: auth.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            const { email } = reqData;
            
            await supabase.from('accounts').delete().eq('email', email);
            const { error } = await supabase.from('users').delete().eq('email', email);
            if (error) {
                return new Response(JSON.stringify({ status: 'error', message: error.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ status: 'success' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 7.5 ADMIN DELETE ACCOUNT ---
        if (path === '/api/admin/delete-account') {
            if (request.method === 'GET') {
                return new Response(JSON.stringify({
                    status: 'active',
                    message: 'Admin Delete Account Endpoint is active. Please send a POST request with credentials.'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', { status: 405 });
            }
            const reqData = await request.json();
            const auth = await checkAdminAuth(reqData, 'POST', null);
            if (!auth.authorized) {
                return new Response(JSON.stringify({ status: 'error', code: auth.error, message: auth.message || auth.error }), {
                    status: auth.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            const { email, account_id } = reqData;
            
            const { error } = await supabase
                .from('accounts')
                .delete()
                .eq('account_id', account_id)
                .eq('email', email);
                
            if (error) {
                return new Response(JSON.stringify({ status: 'error', message: error.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ status: 'success' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 7b. LEADERBOARD ---
        if (path === '/api/affiliation/leaderboard' && request.method === 'GET') {
            try {
                const { data: users, error: usersError } = await supabase
                    .from('users')
                    .select('email, referral_code, referred_by, is_affiliate_active');

                if (usersError) {
                    return new Response(JSON.stringify({ status: 'error', message: usersError.message }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const { data: accounts, error: accountsError } = await supabase
                    .from('accounts')
                    .select('email, initial_price_paid');

                if (accountsError) {
                    return new Response(JSON.stringify({ status: 'error', message: accountsError.message }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

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
                        console.error("Parse overrides error in leaderboard worker:", err);
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

                return new Response(JSON.stringify(leaderboard.slice(0, 50)), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 8. DASHBOARD DATA ---
        if (path === '/api/dashboard' && request.method === 'GET') {
            const email = url.searchParams.get('email');
            const { data: accounts } = await supabase.from('accounts').select('*').eq('email', email);
            
            // Retrieve master account mapping from admin_settings
            const { data: settingsData } = await supabase
                .from('admin_settings')
                .select('*')
                .in('key', ['master_acc_safe', 'master_acc_normal', 'master_acc_debrid']);
            
            const settings = {};
            if (settingsData) {
                settingsData.forEach(s => { settings[s.key] = s.value; });
            }
            
            const result = [];
            for (let i = 0; i < (accounts || []).length; i++) {
                const a = accounts[i];
                const cfg = a.config || {};
                
                if (cfg.status === 'approved') {
                    // Approved copy trading account!
                    const clientMode = cfg.mode || 'low';
                    const investedAmount = parseFloat(cfg.invested_amount) || 0.0;
                    
                    let masterKey = 'master_acc_safe';
                    if (clientMode === 'normal') masterKey = 'master_acc_normal';
                    else if (clientMode === 'extreme') masterKey = 'master_acc_debrid';
                    
                    const masterId = settings[masterKey];
                    let scaledAcc = {
                        account_id: a.account_id,
                        balance: investedAmount,
                        totalResult: 0,
                        winRate: '0%',
                        profitFactor: '0.00',
                        chartData: [],
                        history: [],
                        config: cfg
                    };
                    
                    if (masterId) {
                        const { data: master } = await supabase
                            .from('accounts')
                            .select('*')
                            .eq('account_id', String(masterId))
                            .maybeSingle();
                        
                        if (master) {
                            const masterTotalProfit = parseFloat(master.total_result) || 0.0;
                            const masterBalance = parseFloat(master.balance) || 1.0;
                            const masterInitialBalance = masterBalance - masterTotalProfit;
                            const initialRef = masterInitialBalance <= 0 ? masterBalance : masterInitialBalance;
                            
                            // Scale factor net of 30% performance fee
                            const scale = (investedAmount / initialRef) * 0.70;
                            
                            const clientNetProfit = masterTotalProfit * scale;
                            const clientBalance = investedAmount + clientNetProfit;
                            
                            const scaledChartData = (master.chart_data || []).map(dp => {
                                const masterVal = parseFloat(dp.y) || 0.0;
                                const clientVal = investedAmount + (masterVal - initialRef) * scale;
                                return { x: dp.x, y: clientVal };
                            });
                            
                            const scaledHistory = (master.history || []).map(h => {
                                const rawProfitStr = String(h.resultStr).replace('$', '').replace('+', '');
                                const masterProfit = parseFloat(rawProfitStr) || 0.0;
                                const clientProfit = masterProfit * scale;
                                return {
                                    ...h,
                                    isPositive: clientProfit >= 0,
                                    resultStr: (clientProfit >= 0 ? '+' : '') + '$' + clientProfit.toFixed(2)
                                };
                            });
                            
                            scaledAcc.balance = clientBalance;
                            scaledAcc.totalResult = clientNetProfit;
                            scaledAcc.winRate = master.win_rate;
                            scaledAcc.profitFactor = master.profit_factor;
                            scaledAcc.chartData = scaledChartData;
                            scaledAcc.history = scaledHistory;
                        }
                    }
                    result.push(scaledAcc);
                } else {
                    result.push({
                        account_id: a.account_id,
                        balance: parseFloat(a.balance) || 0.0,
                        totalResult: parseFloat(a.total_result) || 0.0,
                        winRate: a.win_rate,
                        profitFactor: a.profit_factor,
                        chartData: a.chart_data || [],
                        history: a.history || [],
                        config: cfg
                    });
                }
            }
            
            return new Response(JSON.stringify(result), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 8.5. CLIENT ACTIVATION REQUEST ---
        if (path === '/api/activation-request' && request.method === 'POST') {
            const { email, account_id, mode } = await request.json();
            if (!email || !account_id || !mode) {
                return new Response(JSON.stringify({ status: 'error', message: 'Paramètres invalides.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Check if account_id already exists in accounts table
            const { data: existingAcc } = await supabase
                .from('accounts')
                .select('email, config')
                .eq('account_id', String(account_id))
                .maybeSingle();

            if (existingAcc) {
                return new Response(JSON.stringify({ status: 'error', message: 'Ce numéro de compte MT5 est déjà enregistré dans notre système.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Check if this user already has an active or pending account
            const { data: userAccounts } = await supabase
                .from('accounts')
                .select('config')
                .eq('email', email);

            if (userAccounts && userAccounts.some(acc => acc.config && (acc.config.status === 'pending' || acc.config.status === 'approved'))) {
                return new Response(JSON.stringify({ status: 'error', message: 'Vous avez déjà une demande en cours ou un compte actif.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Insert pending account
            const { error: insertError } = await supabase.from('accounts').insert([{
                account_id: String(account_id),
                email: email,
                balance: 0,
                equity: 0,
                currency: 'USD',
                config: {
                    status: 'pending',
                    requested_mode: mode,
                    requested_at: new Date().toISOString()
                },
                last_update: new Date().toISOString()
            }]);

            if (insertError) {
                return new Response(JSON.stringify({ status: 'error', message: insertError.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({ status: 'success', message: 'Demande enregistrée avec succès.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 8.6. ADMIN HANDLE ACTIVATION (APPROVE/REJECT) ---
        if (path === '/api/admin/handle-activation' && request.method === 'POST') {
            const reqData = await request.json();
            const auth = await checkAdminAuth(reqData, 'POST', null, false);
            if (!auth.authorized) {
                return new Response(JSON.stringify({ status: 'error', message: auth.message }), {
                    status: auth.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const { account_id, email, action, invested_amount, mode } = reqData;
            if (!account_id || !email || !action) {
                return new Response(JSON.stringify({ status: 'error', message: 'Paramètres manquants.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            if (action === 'approve') {
                const investedAmt = parseFloat(invested_amount) || 0.0;
                // Update to approved
                const { error: updateError } = await supabase
                    .from('accounts')
                    .update({
                        balance: investedAmt,
                        equity: investedAmt,
                        config: {
                            status: 'approved',
                            mode: mode || 'low',
                            invested_amount: investedAmt,
                            stripe_status: 'active',
                            bypass_payment: true,
                            enabled: true,
                            client_enabled: true
                        },
                        last_update: new Date().toISOString()
                    })
                    .eq('account_id', String(account_id))
                    .eq('email', email);

                if (updateError) {
                    return new Response(JSON.stringify({ status: 'error', message: updateError.message }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            } else if (action === 'reject') {
                // Delete the pending account to let client request again
                const { error: deleteError } = await supabase
                    .from('accounts')
                    .delete()
                    .eq('account_id', String(account_id))
                    .eq('email', email);

                if (deleteError) {
                    return new Response(JSON.stringify({ status: 'error', message: deleteError.message }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            } else {
                return new Response('Invalid Action', { status: 400 });
            }

            return new Response(JSON.stringify({ status: 'success' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 8.7. ADMIN MASTER SETTINGS (GET/POST) ---
        if (path === '/api/admin/master-settings') {
            if (request.method === 'GET') {
                const auth = await checkAdminAuth(null, 'GET', url.searchParams, false);
                if (!auth.authorized) {
                    return new Response(JSON.stringify({ status: 'error', message: auth.message }), {
                        status: auth.status,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const { data: settingsData } = await supabase
                    .from('admin_settings')
                    .select('*')
                    .in('key', ['master_email', 'master_acc_safe', 'master_acc_normal', 'master_acc_debrid']);

                const settings = {};
                if (settingsData) {
                    settingsData.forEach(s => { settings[s.key] = s.value; });
                }

                return new Response(JSON.stringify(settings), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            if (request.method === 'POST') {
                const reqData = await request.json();
                const auth = await checkAdminAuth(reqData, 'POST', null, false);
                if (!auth.authorized) {
                    return new Response(JSON.stringify({ status: 'error', message: auth.message }), {
                        status: auth.status,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const { master_email, master_acc_safe, master_acc_normal, master_acc_debrid } = reqData;

                await supabase.from('admin_settings').upsert({ key: 'master_email', value: master_email || '' });
                await supabase.from('admin_settings').upsert({ key: 'master_acc_safe', value: String(master_acc_safe || '') });
                await supabase.from('admin_settings').upsert({ key: 'master_acc_normal', value: String(master_acc_normal || '') });
                await supabase.from('admin_settings').upsert({ key: 'master_acc_debrid', value: String(master_acc_debrid || '') });

                return new Response(JSON.stringify({ status: 'success' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 9. UPDATE CONFIG ---
        if (path === '/api/update-config' && request.method === 'POST') {
            const { email, account_id, config } = await request.json();
            const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', account_id).single();
            
            if (acc) {
                const newConfig = { ...acc.config, ...config };
                await supabase.from('accounts').update({ config: newConfig }).eq('account_id', account_id);
                return new Response(JSON.stringify({ status: 'success' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response('Not Found', { status: 404 });
            }
        }

        // --- 10. CHECK REFERRAL CODE ---
        if (path === '/api/check-referral-code' && request.method === 'GET') {
            const code = url.searchParams.get('code');
            if (!code) {
                return new Response(JSON.stringify({ available: false, message: 'Le code est requis.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            const cleanCode = code.trim().toUpperCase();
            const regex = /^[A-Z0-9]{4,8}$/;
            if (!regex.test(cleanCode)) {
                return new Response(JSON.stringify({ available: false, message: 'Le code doit contenir entre 4 et 8 caractères alphanumériques.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            const { data: existingUser, error } = await supabase
                .from('users')
                .select('email')
                .ilike('referral_code', cleanCode)
                .maybeSingle();
                
            if (error) {
                return new Response(JSON.stringify({ available: false, message: 'Erreur serveur lors de la vérification.' }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            if (existingUser) {
                return new Response(JSON.stringify({ available: false, message: 'Ce code de parrainage est déjà utilisé par un autre membre.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            return new Response(JSON.stringify({ available: true, message: 'Ce code de parrainage est disponible.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 11. ACTIVATE AFFILIATE ---
        if (path === '/api/activate-affiliate' && request.method === 'POST') {
            const { email, referralCode } = await request.json();
            if (!email || !referralCode) {
                return new Response(JSON.stringify({ status: 'error', message: 'Tous les champs sont requis.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            const cleanCode = referralCode.trim().toUpperCase();
            const regex = /^[A-Z0-9]{4,8}$/;
            if (!regex.test(cleanCode)) {
                return new Response(JSON.stringify({ status: 'error', message: 'Le code doit contenir entre 4 et 8 caractères alphanumériques.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            const { data: codeOwner } = await supabase
                .from('users')
                .select('email')
                .ilike('referral_code', cleanCode)
                .maybeSingle();
                
            if (codeOwner) {
                return new Response(JSON.stringify({ status: 'error', message: 'Ce code de parrainage est déjà pris.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            const { error } = await supabase
                .from('users')
                .update({
                    is_affiliate_active: true,
                    referral_code: cleanCode
                })
                .eq('email', email);
                
            if (error) {
                return new Response(JSON.stringify({ status: 'error', message: error.message }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            return new Response(JSON.stringify({ status: 'success', message: 'Votre espace partenaire a été activé avec le code : ' + cleanCode }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 12. GET AFFILIATION STATS ---
        if (path === '/api/dashboard/affiliation' && request.method === 'GET') {
            const email = url.searchParams.get('email');
            if (!email) {
                return new Response('Email is required', { status: 400 });
            }
            
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('referral_code, is_affiliate_active, is_community_tier, withdrawn_commission')
                .eq('email', email)
                .maybeSingle();
                
            if (userError || !user) {
                return new Response(JSON.stringify({ status: 'error', message: 'Utilisateur non trouvé.' }), {
                    status: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
            let isAffActive = user.is_affiliate_active;
            
            if (!referralCode || referralCode.trim() === "" || !isAffActive) {
                const updatePayload = {};
                if (!referralCode || referralCode.trim() === "") {
                    const prefix = 'MITSU';
                    const randomNum = Math.floor(1000 + Math.random() * 9000);
                    referralCode = `${prefix}${randomNum}`;
                    updatePayload.referral_code = referralCode;
                }
                if (!isAffActive) {
                    isAffActive = true;
                    updatePayload.is_affiliate_active = true;
                }
                await supabase.from('users').update(updatePayload).eq('email', email);
            }
            
            // Retrieve customizable settings from admin_settings
            const { data: settingsRows } = await supabase.from('admin_settings').select('key, value');
            const settings = {};
            (settingsRows || []).forEach(row => {
                settings[row.key] = row.value;
            });
            
            const bronzeLimit = parseFloat(settings['aff_bronze_limit']) || 1000;
            const bronzePct = parseFloat(settings['aff_bronze_pct']) || 4;
            const silverLimit = parseFloat(settings['aff_silver_limit']) || 10000;
            const silverPct = parseFloat(settings['aff_silver_pct']) || 7;
            const goldLimit = parseFloat(settings['aff_gold_limit']) || 100000;
            const goldPct = parseFloat(settings['aff_gold_pct']) || 10;
            
            // Load crypto address
            let cryptoAddresses = {};
            if (settings['aff_crypto_addresses']) {
                try {
                    cryptoAddresses = JSON.parse(settings['aff_crypto_addresses']);
                } catch (e) {
                    console.error("Parse crypto addresses error:", e);
                }
            }
            
            let payoutHistory = [];
            if (settings['aff_payout_history']) {
                try {
                    const allTx = JSON.parse(settings['aff_payout_history']) || [];
                    payoutHistory = allTx.filter(tx => tx.email === email);
                } catch (e) {
                    console.error("Parse payout history error:", e);
                }
            }
            const userCryptoAddress = cryptoAddresses[email] || "";

            // Fetch all users to find direct referrals
            const { data: allUsersForRef } = await supabase.from('users').select('email, full_name, referred_by');
            const cleanRefCode = referralCode.trim().toUpperCase();
            const referredList = (allUsersForRef || []).filter(u => 
                u.referred_by && u.referred_by.trim().toUpperCase() === cleanRefCode
            );
            const referredEmails = referredList.map(ru => ru.email);
            
            let referredAccounts = [];
            if (referredEmails.length > 0) {
                const { data: accounts } = await supabase
                    .from('accounts')
                    .select('email, account_id, config')
                    .in('email', referredEmails);
                referredAccounts = accounts || [];
            }
            
            // Calculate capital brought per referral
            const finalReferredListRaw = referredList.map(ru => {
                const ruAccounts = referredAccounts.filter(a => a.email === ru.email);
                let userCapital = 0;
                ruAccounts.forEach(a => {
                    if (a.config && a.config.status === 'approved') {
                        userCapital += parseFloat(a.config.invested_amount) || 0;
                    }
                });
                return {
                    fullName: ru.full_name,
                    email: ru.email,
                    capital: userCapital,
                    accounts: ruAccounts
                };
            });
            
            const totalCapitalBrought = finalReferredListRaw.reduce((sum, r) => sum + r.capital, 0);
            
            // Determine tier rank and commission rate
            let rank = 'bronze';
            let commissionRate = bronzePct;
            let nextTier = { limit: silverLimit, pct: silverPct };
            
            if (totalCapitalBrought >= goldLimit) {
                rank = 'gold';
                commissionRate = goldPct;
                nextTier = null;
            } else if (totalCapitalBrought >= silverLimit) {
                rank = 'silver';
                commissionRate = silverPct;
                nextTier = { limit: goldLimit, pct: goldPct };
            } else {
                rank = 'bronze';
                commissionRate = bronzePct;
                nextTier = { limit: silverLimit, pct: silverPct };
            }
            
            // Retrieve master accounts to compute weekly returns
            const masterSafeId = settings['master_acc_safe'];
            const masterNormalId = settings['master_acc_normal'];
            const masterDebridId = settings['master_acc_debrid'];
            
            const masterIds = [masterSafeId, masterNormalId, masterDebridId].filter(Boolean);
            let masterAccounts = [];
            if (masterIds.length > 0) {
                const { data: mAccs } = await supabase
                    .from('accounts')
                    .select('*')
                    .in('account_id', masterIds.map(String));
                masterAccounts = mAccs || [];
            }
            
            const masterSafe = masterAccounts.find(m => String(m.account_id) === String(masterSafeId));
            const masterNormal = masterAccounts.find(m => String(m.account_id) === String(masterNormalId));
            const masterDebrid = masterAccounts.find(m => String(m.account_id) === String(masterDebridId));
            
            const getMasterWeeklyReturnPct = (master) => {
                if (!master || !master.history) return 0.0;
                const now = Date.now();
                const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
                
                let weeklyProfit = 0.0;
                (master.history || []).forEach(h => {
                    const tradeDateStr = h.time || h.date;
                    if (!tradeDateStr) return;
                    const tradeDate = new Date(tradeDateStr);
                    if (tradeDate.getTime() >= oneWeekAgo) {
                        const rawProfitStr = String(h.resultStr || '').replace('$', '').replace('+', '');
                        const profit = parseFloat(rawProfitStr) || 0.0;
                        weeklyProfit += profit;
                    }
                });
                
                const masterTotalProfit = parseFloat(master.total_result) || 0.0;
                const masterBalance = parseFloat(master.balance) || 1.0;
                const masterInitialBalance = masterBalance - masterTotalProfit;
                const initialRef = masterInitialBalance <= 0 ? masterBalance : masterInitialBalance;
                
                return weeklyProfit / initialRef;
            };
            
            const pctSafe = getMasterWeeklyReturnPct(masterSafe);
            const pctNormal = getMasterWeeklyReturnPct(masterNormal);
            const pctDebrid = getMasterWeeklyReturnPct(masterDebrid);
            
            let totalWeeklyCommission = 0;
            const finalReferredList = finalReferredListRaw.map(r => {
                let ruWeeklyProfit = 0;
                let ruCommission = 0;
                
                r.accounts.forEach(a => {
                    if (a.config && a.config.status === 'approved') {
                        const cap = parseFloat(a.config.invested_amount) || 0;
                        const mode = a.config.mode || 'low';
                        let mPct = pctSafe;
                        if (mode === 'normal') mPct = pctNormal;
                        else if (mode === 'extreme') mPct = pctDebrid;
                        
                        const netWeeklyProfit = cap * mPct * 0.70;
                        ruWeeklyProfit += netWeeklyProfit;
                        
                        // Sponsors only earn on positive returns
                        const comm = Math.max(0, netWeeklyProfit) * (commissionRate / 100);
                        ruCommission += comm;
                    }
                });
                
                totalWeeklyCommission += ruCommission;
                
                return {
                    fullName: r.fullName,
                    email: r.email,
                    capital: r.capital,
                    weekly_profit: ruWeeklyProfit,
                    commission: ruCommission
                };
            });
            
            return new Response(JSON.stringify({
                status: 'success',
                referral_code: referralCode,
                is_affiliate_active: isAffActive,
                rank: rank,
                commission_rate: commissionRate,
                total_capital: totalCapitalBrought,
                referred_count: finalReferredList.length,
                weekly_commission: totalWeeklyCommission,
                crypto_address: userCryptoAddress,
                next_tier: nextTier,
                referred_list: finalReferredList,
                payout_history: payoutHistory
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
        
        // --- 12B. SAVE AFFILIATE CRYPTO ADDRESS ---
        if (path === '/api/affiliation/crypto' && request.method === 'POST') {
            const { email, crypto_address } = await request.json();
            if (!email || !crypto_address) {
                return new Response('Email and Crypto Address are required', { status: 400 });
            }
            
            // Retrieve current settings
            const { data: settingsRow } = await supabase
                .from('admin_settings')
                .select('value')
                .eq('key', 'aff_crypto_addresses')
                .maybeSingle();
                
            let cryptoAddresses = {};
            if (settingsRow && settingsRow.value) {
                try {
                    cryptoAddresses = JSON.parse(settingsRow.value);
                } catch (e) {
                    console.error("Parse crypto addresses error in post:", e);
                }
            }
            
            cryptoAddresses[email] = crypto_address.trim();
            
            // Update admin settings
            const { error: upsertError } = await supabase
                .from('admin_settings')
                .upsert({
                    key: 'aff_crypto_addresses',
                    value: JSON.stringify(cryptoAddresses)
                });
                
            if (upsertError) {
                return new Response(JSON.stringify({ status: 'error', message: upsertError.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            return new Response(JSON.stringify({ status: 'success' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 12C. GET/SAVE ADMIN AFFILIATION SETTINGS ---
        if (path === '/api/admin/affiliation-settings') {
            if (request.method === 'GET') {
                const auth = await checkAdminAuth(null, 'GET', url.searchParams, true);
                if (!auth.authorized) {
                    return new Response(JSON.stringify({ status: 'error', code: auth.error, message: auth.message || auth.error }), {
                        status: auth.status,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                
                const { data: settingsRows } = await supabase.from('admin_settings').select('key, value');
                const settings = {};
                (settingsRows || []).forEach(row => {
                    settings[row.key] = row.value;
                });
                
                return new Response(JSON.stringify({
                    status: 'success',
                    bronze_limit: parseFloat(settings['aff_bronze_limit']) || 1000,
                    bronze_pct: parseFloat(settings['aff_bronze_pct']) || 4,
                    silver_limit: parseFloat(settings['aff_silver_limit']) || 10000,
                    silver_pct: parseFloat(settings['aff_silver_pct']) || 7,
                    gold_limit: parseFloat(settings['aff_gold_limit']) || 100000,
                    gold_pct: parseFloat(settings['aff_gold_pct']) || 10,
                    crypto_addresses: settings['aff_crypto_addresses'] ? JSON.parse(settings['aff_crypto_addresses']) : {}
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            
            if (request.method === 'POST') {
                const reqData = await request.json();
                const auth = await checkAdminAuth(reqData, 'POST', null);
                if (!auth.authorized) {
                    return new Response(JSON.stringify({ status: 'error', code: auth.error, message: auth.message || auth.error }), {
                        status: auth.status,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                
                const { bronze_limit, bronze_pct, silver_limit, silver_pct, gold_limit, gold_pct } = reqData;
                
                const keys = {
                    'aff_bronze_limit': String(bronze_limit),
                    'aff_bronze_pct': String(bronze_pct),
                    'aff_silver_limit': String(silver_limit),
                    'aff_silver_pct': String(silver_pct),
                    'aff_gold_limit': String(gold_limit),
                    'aff_gold_pct': String(gold_pct)
                };
                
                for (const [k, v] of Object.entries(keys)) {
                    await supabase.from('admin_settings').upsert({ key: k, value: v });
                }
                
                return new Response(JSON.stringify({ status: 'success' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 13. ADMIN UPDATE USER AFFILIATE ---
        if (path === '/api/admin/update-user-affiliate') {
            if (request.method === 'GET') {
                return new Response(JSON.stringify({
                    status: 'active',
                    message: 'Admin Update User Affiliate Endpoint is active. Please send a POST request with credentials.'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', { status: 405 });
            }
            const reqData = await request.json();
            const auth = await checkAdminAuth(reqData, 'POST', null);
            if (!auth.authorized) {
                return new Response(JSON.stringify({ status: 'error', code: auth.error, message: auth.message || auth.error }), {
                    status: auth.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            const { email, is_affiliate_active, is_community_tier, affiliate_rank_override, account_prices, account_modes, account_max_targets, account_monthly_prices, account_bypasses, account_propfirms, initialize_profit_targets } = reqData;
            
            // Check if user already has a referral code, generate one if active and missing
            const { data: user } = await supabase.from('users').select('referral_code, first_name').eq('email', email).maybeSingle();
            let newReferralCode = user ? user.referral_code : null;
            
            if (is_affiliate_active && (!newReferralCode || newReferralCode.trim() === "")) {
                const prefix = ((user && user.first_name) ? user.first_name.trim().replace(/[^a-zA-Z]/g, '') : 'MITSU').substring(0, 4).toUpperCase() || 'MITSU';
                const randomNum = Math.floor(1000 + Math.random() * 9000);
                newReferralCode = `${prefix}${randomNum}`;
            }
            
            const { error: userError } = await supabase
                .from('users')
                .update({ 
                    is_affiliate_active, 
                    is_community_tier,
                    ...(newReferralCode ? { referral_code: newReferralCode } : {})
                })
                .eq('email', email);
                
            if (userError) {
                return new Response(JSON.stringify({ status: 'error', message: userError.message }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

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
                        console.error("Parse overrides error during worker update:", err);
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
            
            if (account_prices && typeof account_prices === 'object') {
                for (const [accountId, price] of Object.entries(account_prices)) {
                    await supabase
                        .from('accounts')
                        .update({ initial_price_paid: parseFloat(price) || 0 })
                        .eq('account_id', accountId)
                        .eq('email', email);
                }
            }

            // 3. Update account modes, monthly prices, max target, bypass and propfirm config if provided
            const allAccountIds = new Set([
                ...Object.keys(account_modes || {}),
                ...Object.keys(account_max_targets || {}),
                ...Object.keys(account_monthly_prices || {}),
                ...Object.keys(account_bypasses || {}),
                ...Object.keys(account_propfirms || {})
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
                        ...(account_bypasses && account_bypasses[accountId] !== undefined ? { bypass_payment: !!account_bypasses[accountId] } : {}),
                        ...(account_propfirms && account_propfirms[accountId] !== undefined ? { is_propfirm: !!account_propfirms[accountId] } : {})
                    };

                    if (initialize_profit_targets) {
                        const isProp = (newConfig.is_propfirm === true) || (maxTarget <= 0.65);
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
            
            return new Response(JSON.stringify({ status: 'success', message: 'Paramètres utilisateur et abonnements mis à jour.', referral_code: newReferralCode }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 14. ADMIN CREATE WITHDRAWAL ---
        if (path === '/api/admin/create-withdrawal' && request.method === 'POST') {
            const reqData = await request.json();
            const auth = await checkAdminAuth(reqData, 'POST', null);
            if (!auth.authorized) {
                return new Response(JSON.stringify({ status: 'error', code: auth.error, message: auth.message || auth.error }), {
                    status: auth.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            const { email, amount } = reqData;
            if (!email || isNaN(parseFloat(amount))) {
                return new Response('Invalid request payload', { status: 400 });
            }

            try {
                const { data: user, error: fetchErr } = await supabase
                    .from('users')
                    .select('withdrawn_commission')
                    .eq('email', email)
                    .maybeSingle();

                if (fetchErr || !user) {
                    return new Response('User not found', { status: 404 });
                }

                const currentWithdrawn = parseFloat(user.withdrawn_commission) || 0.00;
                const newWithdrawn = currentWithdrawn + parseFloat(amount);

                const { error: updateErr } = await supabase
                    .from('users')
                    .update({ withdrawn_commission: newWithdrawn })
                    .eq('email', email);

                if (updateErr) {
                    return new Response(JSON.stringify({ status: 'error', message: updateErr.message }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                // Append transaction record to affiliate payout history in admin_settings
                try {
                    const { data: settingsData } = await supabase
                        .from('admin_settings')
                        .select('key, value')
                        .in('key', ['aff_crypto_addresses', 'aff_payout_history']);
                    
                    let cryptoAddresses = {};
                    let payoutHistory = [];
                    
                    (settingsData || []).forEach(row => {
                        if (row.key === 'aff_crypto_addresses' && row.value) {
                            try { cryptoAddresses = JSON.parse(row.value); } catch(e) {}
                        }
                        if (row.key === 'aff_payout_history' && row.value) {
                            try { payoutHistory = JSON.parse(row.value); } catch(e) {}
                        }
                    });
                    
                    const cryptoAddr = cryptoAddresses[email] || "Non renseignée";
                    
                    const newTx = {
                        id: 'TX' + Math.floor(100000 + Math.random() * 900000),
                        date: new Date().toISOString(),
                        email: email,
                        amount: parseFloat(amount),
                        cryptoAddress: cryptoAddr,
                        status: 'completed'
                    };
                    
                    payoutHistory.unshift(newTx);
                    
                    await supabase.from('admin_settings').upsert({
                        key: 'aff_payout_history',
                        value: JSON.stringify(payoutHistory)
                    });
                } catch (errTx) {
                    console.error("Save payout history transaction error:", errTx);
                }

                return new Response(JSON.stringify({ status: 'success', message: 'Retrait enregistré.', withdrawn_total: newWithdrawn }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 15. STRIPE CREATE CHECKOUT SESSION ---
        if (path === '/api/stripe/create-checkout-session' && request.method === 'POST') {
            const { email, account_id, is_test_zero } = await request.json();
            if (!email || !account_id) {
                return new Response(JSON.stringify({ status: 'error', message: 'Paramètres manquants.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
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
                    success_url: `${request.headers.get('origin') || 'https://mitsuyoshi-system.com'}/dashboard?stripe_status=success&account_id=${account_id}`,
                    cancel_url: `${request.headers.get('origin') || 'https://mitsuyoshi-system.com'}/dashboard?stripe_status=cancel`,
                    metadata: {
                        account_id: String(account_id),
                        email: email,
                        monthly_price: String(monthlyPrice)
                    }
                });

                return new Response(JSON.stringify({ url: session.url }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                console.error("Create Checkout Session Error:", e);
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 16. STRIPE CREATE PORTAL SESSION ---
        if (path === '/api/stripe/create-portal-session' && request.method === 'POST') {
            const { email, account_id } = await request.json();
            if (!email || !account_id) {
                return new Response(JSON.stringify({ status: 'error', message: 'Paramètres manquants.' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            try {
                const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', String(account_id)).single();
                
                let customerId = acc && acc.config && acc.config.stripe_customer_id;
                if (!customerId) {
                    let customerList = await stripe.customers.list({ email: email, limit: 1 });
                    if (customerList.data.length > 0) {
                        customerId = customerList.data[0].id;
                    } else {
                        return new Response(JSON.stringify({ status: 'error', message: "Aucun client Stripe trouvé. Veuillez vous abonner d'abord." }), {
                            status: 400,
                            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                        });
                    }
                }

                const session = await stripe.billingPortal.sessions.create({
                    customer: customerId,
                    return_url: `${request.headers.get('origin') || 'https://mitsuyoshi-system.com'}/dashboard`
                });

                return new Response(JSON.stringify({ url: session.url }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                console.error("Create Portal Session Error:", e);
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 17. STRIPE WEBHOOK ---
        if (path === '/api/stripe/webhook' && request.method === 'POST') {
            const sig = request.headers.get('stripe-signature');
            const endpointSecret = (env.STRIPE_WEBHOOK_SECRET || 'whsec_c10ralQEVI4TeIUW75FTeENFuRFO2s2G').trim();
            
            const rawBody = await request.text();
            
            let event;
            try {
                event = await stripe.webhooks.constructEventAsync(rawBody, sig, endpointSecret);
            } catch (err) {
                console.error("Webhook signature verification failed:", err.message);
                return new Response(`Webhook Error: ${err.message}`, { status: 400 });
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
                
                return new Response(JSON.stringify({ received: true }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                console.error("Webhook processing error:", e);
                return new Response("Internal Webhook Error", { status: 500 });
            }
        }

        // --- COMMUNITY GAINS (dynamic sum of all account profits) ---
        if (path === '/api/community/gains' && request.method === 'GET') {
            try {
                const { data: accounts, error: accountsError } = await supabase
                    .from('accounts')
                    .select('total_result');

                if (accountsError) {
                    return new Response(JSON.stringify({ status: 'error', message: accountsError.message }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                let totalProfit = 0;
                if (accounts) {
                    accounts.forEach(a => {
                        totalProfit += parseFloat(a.total_result) || 0;
                    });
                }

                return new Response(JSON.stringify({ status: 'success', gains: totalProfit }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 404 Default
        return new Response('Not Found', { status: 404 });

    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}
