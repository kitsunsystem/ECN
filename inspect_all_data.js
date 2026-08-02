const fs = require('fs');

const raw = fs.readFileSync('C:\\Users\\medya\\.gemini\\antigravity\\brain\\efe9573a-7c03-40d6-b210-57b94ad3a7a0\\.system_generated\\steps\\616\\content.md', 'utf8');

const jsonStart = raw.indexOf('[');
const jsonStr = raw.substring(jsonStart);

try {
    const list = JSON.parse(jsonStr);
    
    console.log("TOTAL USERS:", list.length);
    
    console.log("\n--- EXACT CODES INSPECTION ---");
    list.forEach(item => {
        if (item.user.referral_code || item.user.referred_by) {
            console.log(`User: ${item.user.email}`);
            console.log(`  referral_code: >>>${item.user.referral_code}<<< (length: ${item.user.referral_code ? item.user.referral_code.length : 0})`);
            console.log(`  referred_by:   >>>${item.user.referred_by}<<< (length: ${item.user.referred_by ? item.user.referred_by.length : 0})`);
        }
    });
} catch (e) {
    console.error("Parse Error:", e);
}
