// WellthCare Compensation & Hierarchy — Master Knowledge Base
// This file is loaded into the AI advisor's system prompt on every session.
// Last updated: May 2026 — Verified correct by Terry Kennedy

export const WELLTHCARE_KNOWLEDGE = `
=== WELLTHCARE COMPENSATION MASTER KNOWLEDGE BASE ===
This document contains the complete, verified rules for WellthCare compensation.
Always use this as the authoritative reference for any compensation questions.

--- FIELD RATE ---
The current WellthCare product pays $20.00 per life per month (PEPM) to "the field."
All percentages, overrides, and bonuses are calculated against whatever the field rate is.
If a future product pays $30.00 to the field, all the same percentages apply to $30.00.
The field rate can change; the percentage structure does not.

--- RANK & COMPENSATION TABLE ---
Rank                      | % of Field | $/Life PEPM | Pay Increase      | Promotion Requirement
Agent                     | 70%        | $14.00      | N/A               | Starting rank
Supervisor                | 80%        | $16.00      | +$2.00/life       | 100 Lives
Director                  | 90%        | $18.00      | +$2.00/life       | 3 Companies + 500 Lives
Managing Director (MD)    | 100%       | $20.00      | +$2.00 + $1 bonus | 500 Lives + 2 Supervisors
Executive Director (ED)   | 100%       | $20.00      | $1.00 ED bonus    | 4 Supervisors OR 2 Sup + 1 Dir
Managing Exec. Dir (MED)  | 100%       | $20.00      | $0.50 MED bonus   | 2 MDs + 1 ED

--- THE BASE SHOP ---
DEFINITION: The base shop is the group of agents sitting directly under an MD who have NOT yet broken away to form their own MD shop. It is the MD's personal inner circle of producers.

INCOME STREAM 1 — Personal production:
The MD earns 100% of the field rate ($20.00/life) on anything they personally sell. No spread is taken because the MD is at the top of their own shop.

INCOME STREAM 2 — The spread (cascading upward):
Every agent below the MD is at a lower rank and lower pay percentage. The spread flows UP through every level — each person above captures the difference between their percentage and the person directly below them. This cascade goes all the way up to the MD who captures whatever remains.

Example chain on a single life (MD → Director → Supervisor → Agent):
- Agent earns:      70% = $14.00
- Supervisor earns: 80% - 70% = $2.00 spread
- Director earns:   90% - 80% = $2.00 spread
- MD earns:        100% - 90% = $2.00 spread
- Total paid out:              = $20.00 (always sums to field rate)

KEY RULE: WellthCare always pays out the full $20.00. It is distributed up the chain by rank. No one is double-paid and nothing is left over. The spread CASCADES — a Supervisor above an Agent captures $2, not the MD directly. The MD only captures the spread from the person directly beneath them in rank. Each tier captures its own layer.

--- THE BREAKAWAY SYSTEM ---
WHAT HAPPENS: When an agent inside an MD's base shop reaches MD status, they BREAK AWAY and take their entire team with them. Their team becomes its own independent shop. The original upline MD loses those agents from their base shop count.

WHAT THE UPLINE MD GETS INSTEAD: A 1st Generation (1st gen) override of 12% on ALL production from the new MD's entire shop — the new MD's base shop AND any overrides within it. This is calculated on what is paid to the field ($20.00).

OVERRIDE TABLE (all calculated on field rate):
Generation | Override % | $/Life at $20 field rate
1st Gen    | 12%        | $2.40/life
2nd Gen    | 6%         | $1.20/life
3rd Gen    | 4%         | $0.80/life
4th Gen    | 3%         | $0.60/life
5th Gen    | 2%         | $0.40/life
6th Gen    | 1%         | $0.20/life

BREAKAWAY EXAMPLE A — Single breakaway:
Terry (MED) → Wade Brown (MD) breaks away with 500 lives.
Terry earns: 12% × $20 × 500 = $1,200/month in 1st gen override from Wade's entire shop.
Wade earns: 100% of $20 on his own shop production + his own spreads.

BREAKAWAY EXAMPLE B — Two breakaway MDs:
Terry has: Wade Brown (500 lives) + Matt Lovelady (800 lives) both broken away.
Terry earns: 12% × $20 × 500 = $1,200 from Wade
             12% × $20 × 800 = $1,920 from Matt
Total 1st gen override = $3,120/month

BREAKAWAY EXAMPLE C — Chained breakaways:
Matt Lovelady (Terry's 1st gen MD) develops Allen Mullins into an MD. Allen breaks away with 400 lives.
Allen = Terry's 2nd generation.
Terry earns: 6% × $20 × 400 = $480/month from Allen (2nd gen)
Matt earns:  12% × $20 × 400 = $960/month from Allen (Matt's 1st gen)

BREAKAWAY EXAMPLE D — New product at $30 field rate:
Same structure as Example B. Wade's shop has 500 lives on the $30 product.
Terry earns: 12% × $30 × 500 = $1,800/month (vs $1,200 at $20 field rate)
The % never changes — the dollar amount scales with the field rate automatically.

--- TITLE-BASED BONUS SYSTEM ---
CRITICAL RULE: Bonuses are based on TITLE, not generation position. A higher-titled person earns the bonus on every life in their entire downline — regardless of how many generations deep — until it hits someone with the same or higher title. The bonus then splits by title at that point.

BONUS AMOUNTS:
- MD bonus:  $1.00/life on lives in their downline down to the next MD
- ED bonus:  $0.50/life (ED captures $0.50, MED above captures $2.00 of the $2.50 pool)
- MED bonus: $2.50/life total on entire downline — splits when hitting ED or another MED

HOW THE MED $2.50 BONUS SPLITS:
Scenario 1 — No ED or MED below:       MED earns full $2.50/life on all lives below
Scenario 2 — ED is below MED:          ED earns $0.50, MED earns $2.00 on those same lives
Scenario 3 — Another MED is below:     Lower MED earns full $2.50, upper MED earns $0.00 on those lives

BONUS EXAMPLE 1 — MED with no ED or MED below:
Terry (MED), 1,000 lives in total downline, no EDs or MEDs below.
Terry earns: $2.50 × 1,000 = $2,500/month bonus

BONUS EXAMPLE 2 — MED with one ED in downline:
Terry (MED), 1,000 total lives. Wade Brown is ED with 400 of those lives under him.
Wade (ED) earns:  $0.50 × 400 = $200/month
Terry (MED) earns: $2.00 × 400 = $800/month on Wade's lives
Terry (MED) earns: $2.50 × 600 = $1,500/month on lives not under any ED
Terry total bonus: $2,300/month | Wade bonus: $200/month | Combined: $2,500 ✓

BONUS EXAMPLE 3 — MED with another MED in downline:
Terry (MED), 1,000 total lives. Appreciation Financial (also MED) has 500 lives.
Appreciation Financial earns: $2.50 × 500 = $1,250/month — Terry gets $0 on those lives.
Terry earns: $2.50 × 500 = $1,250/month on the remaining lives.

--- BONUS POOLS ---
PARTNER POOL: $2.50 PEPM from every life
Qualification: Personally have 100 lives AND enroll 1 new client every 90 days
Payout: Monthly, pro-rata share based on personal volume
Note: An agent can qualify for BOTH Partner Pool and Founders Pool simultaneously.

FOUNDERS POOL: $2.50 PEPM from every life
Qualification: Achieve Executive Director (ED) rank within 1 year of starting
Payout: Monthly

--- FIVE INCOME STREAMS FOR AN MED ---
A Managing Executive Director earns from five simultaneous income streams:
1. PERSONAL PRODUCTION: $20/life on anything they personally sell (100% field rate)
2. BASE SHOP SPREAD: Difference between 100% and lower-ranked agents, cascading up through every level in the base shop
3. GENERATION OVERRIDES: 12% → 6% → 4% → 3% → 2% → 1% on each broken-away MD's entire shop by generation depth
4. TITLE BONUS: $2.50/life on all lives in downline (splits at ED: $2.00 MED / $0.50 ED; stops at next MED)
5. BONUS POOLS: Partner Pool and/or Founders Pool if qualified

--- CONTEXT: WHO THIS BELONGS TO ---
This dashboard and knowledge base was built for Terry Kennedy (WC00001 / Linqqs Organization root).
Terry is an MED-level leader. The 6,473 agents in this system were transported from Linqqs ERC to WellthCare.
All agents came over from Linqqs — their LQ numbers switched to WC numbers upon joining WellthCare.
The hierarchy reflects who is under whom in the WellthCare multi-level pay structure.

Key people in the organization (by total team size):
- Pivotal Wealth (WC70693): ~3,327 agents under them
- Appreciation Financial (WC89923): ~2,824 agents under them (MED)
- Matt Lovelady (WC87960): ~2,257 agents under them
- Wade Brown (WC24948): ~1,460 agents under them (MED)
- Allen Mullins (WC68152): ~596 agents under them
- Rick Watson (WC19652): ~418 agents under them
- David Montgomery (WC76681): ~400 agents under them
- Terry Kennedy 2023 (WC47108): ~383 agents under them
- Rich Ortiz (WC23694): ~341 agents under them

=== END WELLTHCARE KNOWLEDGE BASE ===
`

export default WELLTHCARE_KNOWLEDGE
