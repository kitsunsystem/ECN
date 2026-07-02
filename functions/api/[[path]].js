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

            const formattedHistory = [...history].reverse().slice(0, 100).map(h => ({
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

            let dailyProfitTarget = parseFloat(config.daily_profit_target);
            if (isNaN(dailyProfitTarget) || dailyProfitTarget === 0 || dailyProfitTarget < minAllowedDollars) {
                dailyProfitTarget = maxAllowedDollars;
                config.daily_profit_target = dailyProfitTarget;
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

            const returnConfig = {
                ...config,
                enabled: (config.enabled !== false) && (config.client_enabled !== false) && isPaidOrBypassed,
                daily_profit_target: parseFloat(config.daily_profit_target) || 0.0
            };
            return new Response(JSON.stringify({ status: 'success', config: returnConfig }), {
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
                    console.error("Parse overrides error in all-data worker:", err);
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
            
            const result = accounts.map(a => ({
                account_id: a.account_id, balance: a.balance, totalResult: a.total_result,
                winRate: a.win_rate, profitFactor: a.profit_factor, chartData: a.chart_data,
                history: a.history, config: a.config
            }));
            return new Response(JSON.stringify(result), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
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
            
            if (!user.is_affiliate_active) {
                return new Response(JSON.stringify({
                    is_affiliate_active: false,
                    referral_code: null,
                    is_community_tier: false,
                    stats: { referred_count: 0, sales_count: 0, total_sales_amount: 0, projected_comm: 0, earned_comm: 0, withdrawn_comm: 0, is_eligible: false, min_required: 1 },
                    referred_list: [],
                    chart_data: []
                }), {
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
            if (!referralCode || referralCode.trim() === "") {
                const prefix = 'MITSU';
                const randomNum = Math.floor(1000 + Math.random() * 9000);
                referralCode = `${prefix}${randomNum}`;
                await supabase.from('users').update({ referral_code: referralCode }).eq('email', email);
            }
            
            // Fetch all users and filter in JS (mirrors working admin logic)
            const { data: allUsersForRef, error: queryError } = await supabase
                .from('users')
                .select('email, full_name, referred_by');
                
            const cleanRefCode = referralCode.trim().toUpperCase();
            const referredList = (allUsersForRef || []).filter(u => 
                u.referred_by && u.referred_by.trim().toUpperCase() === cleanRefCode
            );
            const referredEmails = referredList.map(ru => ru.email);
            
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
                    console.error("Parse overrides error in worker dashboard:", err);
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
            
            return new Response(JSON.stringify({
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
                chart_data: chartData,
                debug: {
                    query_error: queryError ? queryError.message : null,
                    total_users_fetched: (allUsersForRef || []).length,
                    referral_code_searched: cleanRefCode,
                    all_referred_by_values: (allUsersForRef || []).map(u => ({ email: u.email, referred_by: u.referred_by })).filter(u => u.referred_by),
                    matched_count: referredList.length
                }
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
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
            const { email, is_affiliate_active, is_community_tier, affiliate_rank_override, account_prices, account_modes, account_max_targets, account_monthly_prices, account_bypasses, initialize_profit_targets } = reqData;
            
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

            // 3. Update account modes, monthly prices, max target, and bypass in JSONB config if provided
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
