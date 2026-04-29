---
symbol: NEARUSDT
direction: long
status: closed
opened: 2026-04-27T05:24:00Z
closed: 2026-04-27T05:46:00Z
entry: 1.3796
sl: 1.372
tp: 1.39
size_usd: 91720
leverage: 10
risk_r: 0.5
confluence_score: 10
confluence_type: counter-trend
regime: range
session: asian
btc_state_at_entry: bear
news_multiplier: 1.0
trade_category: fade
thesis_snapshot: "Playbook A LONG range fade. Universe-wide capitulation 8/8 BOS_15m bearish. NEAR broke prior day low 1.3772, RSI 34.68 deep oversold, BB lower tap, vol 2.04× SMA. SL slip 0.27%→0.55% from market fill."
expected_duration: intraday
closed_reason: sl
r_multiple: -2.37
fees_usd: -110
---

# NEARUSDT LONG — 2026-04-27

## Why This Trade (at entry)

Чистый Playbook A range fade trigger в условиях universe-wide capitulation. NEAR — самая oversold пара на 4h (RSI 42.14), broke prior day low 1.3772 в первый раз сегодня, BB lower tagged, RSI_1h 34.68 (порог < 35), vol spike 2.04× SMA (порог 1.3×). ADX 16.83 — clean RANGE regime, no transition. SL distance 0.265% just above 0.3×ATR floor 0.232%.

- **Setup type:** fade (counter-trend range fade)
- **Primary factor:** Playbook A entry rule cleanly fired — все gates passed без compromise
- **Confluence breakdown:**
  - SMC/Structure: 1 (broken prior day low — bearish, but range BB tag = mean revert)
  - Technical: 2 (BB lower tap + RSI 34.68 deep oversold)
  - Volume: 2 (2.04× SMA — strongest signal)
  - Multi-TF + BTC: 0 (BTC в bear capitulation — counter-trend risk)
  - Regime + BTC: 1 (regime=RANGE clean ADX 16.83, но BTC HMM bear 72%)
  - News/Macro: 1 (neutral mult 1.0)
  - Momentum: 1 (RSI accelerating down −8.67/h — capitulation)
  - Volatility: 2 (ATR 0.77% scalar 1.2× = high R/R)
- **Why this R:R:** Planned entry 1.3757 → 4.4R к BB middle 1.39. **Slip к 1.3796 cut R/R к 1.37R**. Acceptable но subnotable.

## Entry Context

- **Time:** 2026-04-27 05:24 UTC
- **Session:** Asian (mult 0.85)
- **BTC state:** Bear HMM 72% (just flipped) — 1h range with bearish slope1h −9.7
- **Regime on this pair:** RANGE (ADX 16.83)
- **Fear & Greed:** N/A
- **Relevant news:** None — bias neutral, no triggers

## Plan at Entry

- **Entry price (filled):** 1.3796 (intended limit 1.3757, market order slipped +0.28%)
- **SL price:** 1.372 — bb_lower − 0.5×ATR
- **TP price:** 1.39 — BB middle (TP1 per strategy.md A rule)
- **Risk:** 0.50% × 1.2 scalar — actual $245.94 per account ($491.88 combined)
- **Expected R at TP:** 1.37R (cut from planned 4.4R due to slip)
- **Max hold:** intraday — abort if ADX ≥ 28 OR price closes <bb_lower with continued momentum

## Life of Trade

### [2026-04-27 05:24 UTC] — OPEN

- Entry filled 1.3796 both accounts (50k qty 66470, 200k qty 66470 — same size due to per-account cap)
- Mark immediately drifted to 1.3785 (−$0.001 unrealized) within 1 min
- SL set 1.372, TP set 1.39 — server-side both
- Combined unrealized: −$139.59 at fill+30s
- Action: monitor. NEAR needs to bounce off support 1.3746 within 1-2 cycles for setup to remain valid

---

## Close Summary (filled on close)

- **Closed at:** 2026-04-27 05:46 UTC (~22 min hold)
- **Exit price:** ~1.370 (SL hit 1.372 with negative slip — actual fill below)
- **Reason:** sl
- **R multiple:** **−2.37R** (planned 1R, actual 2.37R due to entry+exit slippage)
- **PnL USD:** Combined **−$1,168.18** (50k −$589.68, 200k −$578.50)
- **Fees USD:** ~$110 estimated (taker × 2 fills)
- **Duration:** ~22 minutes

## Immediate Takeaway

**Process: D.** Strategy gates fired clean (passed all A LONG conditions cleanly), но **execution flawed на 2 levels**:
1. **Entry slip:** market order slipped 1.3757→1.3796 (+0.28%) — съел весь SL cushion. Should have used `place-limit` для tight-SL setups.
2. **Exit slip:** SL fill clearly worse than 1.372 — combined day loss $1168 vs expected 1R = $492 = 2.37R hit when SL was supposed to cap loss at 1R.

Outcome: −2.37R combined. Strategy thesis was reasonable (counter-trend в RSI 34.68 + vol 2.04×) но executive errors turned planned 1R risk into 2.37R realized loss.

→ Full Postmortem: [[Postmortem/2026-04-27_NEARUSDT_LONG]]
