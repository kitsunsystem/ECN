const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.log("Error: SUPABASE_URL or SUPABASE_KEY is missing in environment variables!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Supabase connected to:", supabaseUrl);
    
    // Fetch users
    const { data: users, error: err } = await supabase.from('users').select('email, full_name, referral_code, referred_by, is_affiliate_active');
    if (err) {
        console.error("Fetch Users Error:", err);
        return;
    }
    
    console.log("\n--- USERS LIST ---");
    console.log(JSON.stringify(users, null, 2));
    
    // Fetch accounts
    const { data: accounts, error: accErr } = await supabase.from('accounts').select('email, account_id, initial_price_paid');
    if (accErr) {
        console.error("Fetch Accounts Error:", accErr);
        return;
    }
    
    console.log("\n--- ACCOUNTS LIST ---");
    console.log(JSON.stringify(accounts, null, 2));
}

run();
