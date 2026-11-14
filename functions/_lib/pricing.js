// Your service fee, set in Cloudflare (all optional, default 0): FEE_FIXED = amount per traveler, FEE_PERCENT = percent of the fare.
export const feeConfig = (env) => ({ fixed: Math.max(0, parseFloat(env.FEE_FIXED) || 0), percent: Math.max(0, parseFloat(env.FEE_PERCENT) || 0) });
export const computeFee = (env, base, travelers) => { const c = feeConfig(env); return Math.round((c.fixed * travelers + base * c.percent / 100) * 100) / 100; };
