# The Crypto Trader — Glen Goodman + Altcoin Trader's Handbook — Nik Patel

**Date:** 2026-04-06
**Sources:**
- Glen Goodman, *The Crypto Trader* (Harriman House, 2019; 2nd ed. 2022)
- Nik Patel, *An Altcoin Trader's Handbook* (self-published, 2018)
- Supporting research from Blinkist, Binance Square, Medium/The Capital, CoinMarketCap, Glassnode, Coinbase Institutional

---

## 1. Crypto Market Characteristics — What Makes Crypto Different

### 1.1 The 24/7 Problem

Crypto never closes. While forex runs 24/5 and equities 5 days × ~7 hours, crypto perpetuals trade every second of every day, including holidays, weekends, and during macro shocks. This is simultaneously crypto's edge and its greatest psychological trap.

**Practical consequences for algorithmic bots:**
- Liquidity thins dramatically between 02:00–06:00 UTC (overlap of Asia close and Europe pre-open). Spreads widen, slippage increases, and stop hunts are more common during these windows.
- There are no "pre-market gaps" that protect swing traders — gaps can appear at any hour.
- A 24/7 schedule means exhausted humans make the worst decisions at 3 AM. Algorithmic systems have an edge here — they are emotionally consistent at any hour.

### 1.2 Volatility Scale Is Different

Bitcoin routinely moves 3–5% in a single day. Altcoins can move 10–50% in a session. By comparison, the S&P 500 averages 0.7% daily moves in normal conditions. This means:

- Stop-loss distances that feel "wide" in stocks (2%) can be eaten within an hour in crypto.
- ATR-based stops must be calibrated to crypto's actual volatility range (0.3–3% for BTC on 15M), not to stock market intuitions.
- Goodman's key insight: *"The technology is revolutionary, but the markets behave just like they always have. Fear and greed drive prices to extremes, creating opportunities for disciplined traders who can control their emotions and follow a proven system."*

### 1.3 Manipulation and Thin Books

Crypto markets, especially altcoins, are demonstrably more susceptible to manipulation than regulated equity markets:

- **Whale stop-hunts**: Large actors deliberately push price through known stop-loss clusters (just below support, just above resistance) to trigger cascading liquidations, then reverse.
- **Wash trading**: Artificial volume is common on smaller exchanges; reported volume can be 5–10× actual traded volume.
- **Liquidation cascades on perpetuals**: Open interest buildup + funding rate extremes → a coordinated nudge triggers auto-liquidations that amplify the move far beyond the initial trigger.

Goodman notes that these patterns, while extreme in crypto, are direct extensions of the same institutional behavior seen in equities — "spoofing" has existed for decades in traditional markets.

**Implication for our bot:** Avoid entries during high-funding-rate environments (|funding| > 0.1%). Extreme positive funding means longs are overloaded — the market is primed for a stop-hunt flush. Extreme negative funding = short squeeze risk. The current strategy already filters this.

### 1.4 Crypto-Specific Event Risk

Unlike equities (earnings, Fed) or forex (NFP, FOMC), crypto has unique catalysts:

| Event | Character | Impact Duration |
|---|---|---|
| **Bitcoin halving** | Supply shock, 4-year cycle | Months–years |
| **Exchange collapse** (FTX, etc.) | Contagion + confidence destruction | Weeks–months |
| **Regulatory action** (SEC, MiCA) | Uncertainty premium | Days–weeks |
| **Stablecoin depeg** (UST, USDC) | Systemic confidence | Hours–days |
| **Protocol hack** | Sector contagion | Hours–days |
| **ETF approval/rejection** | Demand shock | Days |

**The FTX lesson (November 2022):** CoinDesk's Alameda Research balance sheet exposure was published on November 2. Within 72 hours BTC dropped from $21,000 to $16,000. Traders with no stop-loss on perpetuals were liquidated or margin-called before they could respond. The cascade was not fundamentally driven — it was confidence destruction that became self-fulfilling. Bitcoin eventually bottomed at $16,000 in January 2023.

**Rule derived from Goodman:** Do not trade into a known crisis. When exchange solvency is in question, reduce position size or step aside. The asymmetry is unfavorable — the downside is gaps through stops; the upside is already being priced in.

---

## 2. Trend Following in Crypto — Goodman's Core Approach

### 2.1 Why Trend Following Works Even Better in Crypto

Goodman's foundational insight: *"I discovered that I could apply century-old stock market wisdom with even greater success to trading crypto."* The reason is structural — crypto markets are less efficient than equities for several reasons:
- Dominated by retail traders with strong behavioral biases (FOMO, panic)
- No circuit breakers, no trading halts
- Sentiment-driven cycles that overshoot both directions
- Institutional participation was low in early cycles (increasing in 2024+)

These inefficiencies mean trends persist longer and extend further than in equities. A 20/50 EMA crossover system applied to Bitcoin — which Goodman documents — generated +423% from $10,500 to $55,000 during the 2020–2021 bull run, versus buy-and-hold which returned similar amounts but with catastrophically different drawdown profiles.

### 2.2 Goodman's Moving Average System

Goodman's primary trend-identification tool uses:

- **20-period MA** — short-term momentum
- **50-period MA** — intermediate trend
- **200-period MA** — major trend (bull/bear line)

**Rules:**
- Price above 200MA on daily = bull market bias → only take long setups
- Price below 200MA on daily = bear market bias → short or flat
- 20MA crosses above 50MA = trend entry signal
- 20MA crosses below 50MA = trend exit / potential short signal
- Do not fight the 200MA

He notes that the 200MA on the daily chart "publicly called the top of the market in December 2017" — price had been trading below the 200MA for weeks while retail was still in maximum euphoria. His exit preserved profits before the 80% crash.

### 2.3 "Let Profits Run, Cut Losses Fast"

This is Goodman's cardinal rule, directly inherited from Livermore and O'Neil but applied with crypto-specific calibration:

- His average winning trade is more than **3× larger** than his average losing trade
- This means he can be **right less than 25%** of the time and still be profitable
- In crypto, where big moves are the norm, cutting losses at 1R and letting winners run to 3R+ is mathematically compelling

**Critical insight on stop placement:** Goodman emphasizes that stop-loss placement is the most critical technical skill. Stops placed too tight get hit by normal crypto noise. He advocates stops based on:
1. Chart structure — below a significant swing low or order block, not a fixed percentage
2. Volatility-adjusted — wider in high-ATR environments
3. Pre-defined before entry — never moved against your position

### 2.4 Market Cycle Recognition

Goodman teaches the four-phase cycle model applied specifically to crypto:

| Phase | Characteristics | Action |
|---|---|---|
| **Accumulation** | Low volatility, sideways, low volume, despair | Start building long positions |
| **Run-up (Markup)** | Rising price, rising volume, increasing news coverage | Hold longs aggressively, add on pullbacks |
| **Distribution** | High volatility, euphoria, high volume, contradictory news | Take profits, tighten stops |
| **Decline (Markdown)** | Falling price, despair, sharp drops | Short or flat, never "buy the dip" |

Crypto cycles are compressed vs equities — a full cycle can complete in 12–18 months. The halving cycle adds a structural 4-year meta-rhythm on top of these smaller cycles.

### 2.5 Going Long vs Short — Goodman's Asymmetry Rule

Goodman is explicit that **long trades in bull markets have asymmetric upside** in crypto. His book's case studies show:
- Long trades in accumulation/run-up phase → potential for 3R–20R+
- Short trades in distribution/decline phase → typically 1R–3R (market falls slower than it rises in sustained bear)
- Short trades in a bull market → extremely dangerous; short squeezes can destroy accounts

**His rule for going short:**
1. Price must be below the 200MA (daily or weekly)
2. A clear distribution pattern or failed breakout must be present
3. Volume must be declining on bounces
4. Never short into a strong uptrend — wait for the trend to break

---

## 3. BTC vs Altcoin Trading Dynamics — Patel's Framework

### 3.1 The Core Difference: Liquidity and Information

Nik Patel's foundational observation — altcoins are a fundamentally different game from BTC:

| Dimension | Bitcoin | Altcoins |
|---|---|---|
| **Liquidity** | Deep ($10B+ daily spot) | Thin (microcaps: $1M–$50M daily) |
| **Information** | Widely analyzed, transparent | Opaque, asymmetric info advantage possible |
| **Volatility** | 3–5% daily normal | 10–100% daily moves on news |
| **Manipulation risk** | Moderate (large market) | High (small teams can move price) |
| **Fundamental driver** | Macro + adoption narrative | Token-specific catalysts + BTC trend |
| **Cycle timing** | Leads all crypto | Lags BTC by weeks–months |

### 3.2 Patel's Three-Stage Process

Every successful altcoin trade follows three stages:

**Stage 1 — Research and Identification**
Find projects where:
- Development activity is ongoing and verifiable
- Community engagement is authentic, not fabricated
- Tokenomics don't incentivize dump (no cliff unlocks, reasonable supply)
- The project has a working product or clear roadmap milestone
- Market cap is low relative to the potential use case

**Stage 2 — Accumulation**
- Buy in the accumulation zone, not after price has already moved
- Accumulate in tranches — don't go all-in at one price
- Use BTC/ETH dominance charts to time entry (see Section 4)
- Ideal: price forming higher lows while BTC dominance is at or near resistance (58–64%)

**Stage 3 — Distribution**
- Sell into strength, not into weakness
- Take partial profits at each leg up — never try to catch the absolute top
- "Distribution" means selling to buyers who are arriving late, driven by FOMO
- Have a pre-defined exit plan before entering — never decide at the top under emotional pressure

### 3.3 Micro/Low Cap Rationale

Patel's position sizing logic is built around expected value across a portfolio:

> *"All you need is one 1% fixed-risk position growing 20x to return 20% of the portfolio value."*

His portfolio model: 50 positions of 1% risk each, spread across microcap, lowcap, and midcap.

**Why microcaps are not inherently more risky at portfolio level:**
- A 50-position portfolio has low correlation between individual positions
- The probability of all going to zero is near-zero
- The probability of finding 5–10 positions that go 20x+ is significant in a bull market
- During bear markets, microcaps actually suffer *less intense dumping* proportionally because there's little institutional selling — the "smart money" never loaded them in size

**Contrast with our bot's approach:** We trade BTCUSDT perpetuals with concentrated 22.5% positions. Patel's framework is for spot accumulation, not leveraged futures. The relevant takeaway is the *principles* of cycle timing and BTC correlation reading, not the position sizing model.

---

## 4. BTC-Altcoin Correlation Dynamics

### 4.1 The Dominance Framework

BTC Dominance (BTC.D) = Bitcoin market cap / Total crypto market cap × 100

This ratio is arguably the most important meta-indicator for altcoin traders:

| BTC.D Level | Market Interpretation | Altcoin Strategy |
|---|---|---|
| **>60%** | Capital concentrated in BTC; alts weak or falling | Avoid alts; hold BTC or flat |
| **58–64%** | Resistance zone — historically where BTC dominance peaks | Best accumulation zone for alts |
| **46–57%** | Dominance falling; capital rotating into ETH and large caps | Long large-cap alts aggressively |
| **<45%** | Mega altseason; retail FOMO in small caps | Distribution phase; take profits on alts |

Patel documented this in his November 2024 analysis: the 58–64% zone is where dominance historically gets rejected and breaks down, triggering the most explosive altseasons (2017–18, 2020–21 cycles).

### 4.2 The Rotation Sequence

Capital does not rotate all at once. It follows a predictable sequence:

1. **Bitcoin leads** — institutional and large-capital actors move first into BTC
2. **ETH follows BTC** — 2–6 weeks after BTC makes new highs, ETH/BTC ratio starts rising
3. **Large-cap alts** (SOL, BNB, ADA, LINK) follow ETH — 2–4 weeks after ETH breaks out
4. **Mid-caps** (ranked 20–100) follow large caps — 1–3 weeks later
5. **Microcaps** move last — often the peak signal that the cycle is ending

**ETH/BTC as the canary:** When the ETH/BTC ratio breaks a long consolidation, forms higher highs/higher lows, or flips major resistance to support, this is the clearest leading indicator that capital is rotating from BTC into the broader market.

**Historical data:**
- 2021 cycle: ETH went from $730 to $4,300 (+488%), SOL from $1.50 to $50 (+3,233%), while BTC went from $29,000 to $69,000 (+138%). The leverage was in alts, but required BTC to lead.
- BTC dominance dropped from 70% to 38% during this cycle.

### 4.3 High-Beta Risk in Perpetuals

For our bot trading alt perpetuals (ETH, SOL, etc.), the BTC correlation has a crucial implication:

- **When BTC drops 3%, ETH typically drops 4–6%, SOL 6–12%** (beta 1.3–2.5×)
- This means stop-losses on alt perpetuals must be wider relative to expected moves
- A BTC flash crash will cascade to alts faster than any indicator can signal
- For levered perpetuals, the liquidation risk is compounded: a 10% BTC drop becomes a 15–25% alt drop, which can breach 5× leverage thresholds

**Patel's warning about correlation timing:** During risk-off events, the BTC-altcoin correlation approaches 1.0. Everything falls together. The "diversification" benefit of holding multiple alts vs BTC disappears exactly when you need it most.

---

## 5. Risk Management for Crypto Volatility

### 5.1 Goodman's Risk Framework

Goodman's core risk rules, derived from his personal trading and validated through the 2017–2019 and 2020–2021 cycles:

**Rule 1 — Never risk more than you can afford to lose on a single trade**
He does not give a single fixed percentage but emphasizes the *asymmetry*: a 50% loss requires a 100% gain to recover. In crypto, position sizing must account for the possibility of extreme moves (flash crashes, exchange failures).

**Rule 2 — Stop-loss is non-negotiable**
Every trade has a stop before entry. The stop is placed at a technically significant level (below swing low, below OB), not at a round number. Round numbers are obvious stop-hunt targets.

**Rule 3 — Adjust position size to volatility, not to desired profit**
In high-ATR environments, reduce size. The market is telling you the range of uncertainty is wider. Trying to maintain the same nominal position size in a 5× more volatile environment multiplies your risk 5×.

**Rule 4 — Protect capital in the Distribution phase**
When the 200MA is below price and the trend is mature (months-long bull run), reduce position sizes and tighten stops. The risk/reward profile of new long entries deteriorates as the cycle ages.

### 5.2 Crypto-Specific Risk Scenarios

**Flash crash / wick scenario:**
- Crypto exchanges do not have circuit breakers
- A single large market sell order on a thin book can wick 10%+ in seconds, hit all stops, then recover instantly
- Mitigation: set limit stop-losses, not stop-market (Bybit supports this); understand that a 2×ATR stop may still get hit by a 4×ATR wick

**Exchange failure scenario (FTX-class):**
- Never hold more than needed on any single exchange
- On Bybit specifically: monitor exchange health, have exit plan if withdrawal halts are announced
- Immediate action if exchange shows signs of insolvency: close all positions and withdraw

**Regulatory shock:**
- Cannot be predicted from charts
- Mitigation: always have open positions with stops set, never hold unprotected positions overnight during periods of known regulatory activity (SEC lawsuits, government statements)

**Funding rate trap:**
- Sustained high positive funding (>0.1%) means longs are paying shorts every 8 hours
- Even if the trade is directionally correct, cost of carry eats returns
- Goodman's implied rule: factor funding into trade economics; a 0.1%/8h funding rate = 3%/day = unsustainable

### 5.3 Position Sizing for Leverage in Crypto

Goodman notes that leverage is the primary reason most retail traders lose money in crypto. His framework:
- Low leverage (2–5×) lets you survive normal volatility
- High leverage (20–100×) means a 2% adverse move equals 40–200% of margin = liquidation
- For trend trades, low leverage with correct trend identification outperforms high leverage with uncertain entries

Patel's 1% fixed risk rule (for spot altcoins) translates to perps as: **never risk more than 1–2% of total account per trade**, with position size calculated backward from stop distance.

**Our bot's 22.5% × 5× = 112.5% notional vs start balance** is aggressive by these standards but is calibrated against HyroTrader's 3% SL limit, which caps actual loss per trade at $300 on a $10,000 account (3%). This is within responsible range given the confluence filter (≥70/100) constraining trade frequency.

---

## 6. Best Indicators for Crypto

### 6.1 What Works

Based on backtested research and Goodman's documented approach:

**Moving Averages (most effective in crypto):**
- 20/50 EMA crossover: high relevance in crypto's trend-heavy regime. RSI+MACD combined study showed 77% win rate in crypto backtests.
- 200 MA (daily) as bull/bear filter: confirmed effective — the 2020 recovery above 200MA preceded 700%+ gains; the 2022 fall below 200MA confirmed the bear.
- Crypto's trending behavior makes MAs more reliable here than in mean-reverting assets like currencies.

**RSI (14):**
- RSI-based strategies backtested 773.65% return 2018–2022 vs 275.22% buy-and-hold in peer-reviewed study
- Overbought (>70) / Oversold (<30) thresholds work but require trend context — RSI can stay overbought for months in a strong bull
- RSI divergence (price makes new high, RSI doesn't) is one of the most reliable distribution signals in crypto

**Volume:**
- Volume is the truth-teller in crypto — price moves without volume are suspect
- Volume on breakouts: if price breaks resistance on 2× average volume, the break is credible
- Low volume consolidation after a strong move = healthy continuation; high volume failed breakout = distribution

**ATR (14):**
- Essential for volatility-adjusted stop placement
- In crypto: stops at 1.5–2× ATR absorb normal noise; less than 1× ATR will be hit by routine wicks
- ATR is also the best filter for "tradeable" vs "untradeable" conditions: ATR/price < 0.1% = dead market; > 3% = excessive noise

**Funding Rate (perpetuals-specific):**
- Not an indicator in traditional sense, but essential for perp traders
- Positive funding → longs pay shorts → crowd is long → contrarian caution
- Negative funding → shorts pay longs → crowd is short → contrarian opportunity
- MACD and RSI together with funding rate form a complete picture

### 6.2 What Works Less Well

- **Fibonacci retracements**: Goodman notes they work because enough people believe in them (self-fulfilling), not because of mathematical certainty. Use as one input, not as the primary signal.
- **Classic chart patterns** (head-and-shoulders, etc.): Less reliable in 24/7 markets where patterns can be manipulated. More reliable on higher timeframes (daily, weekly).
- **Oscillators alone**: MACD golden crosses win only ~40% of the time in isolation. Combinations dramatically improve win rate.

### 6.3 Crypto-Specific Indicators

Indicators with no equivalent in traditional markets:

- **BTC Dominance (BTC.D)**: covered in Section 4 — essential for altcoin timing
- **Fear & Greed Index**: Useful as extreme-reading contrarian signal. Extreme Fear (<20) = accumulate. Extreme Greed (>80) = distribute. Don't trade in the middle readings.
- **Open Interest (OI)**: Rising OI + rising price = healthy trend. Rising OI + falling price = selling pressure accumulating. OI spikes often precede liquidation cascades.
- **Funding Rate**: Described above — essential for perp position holders.
- **Exchange Flows**: Large BTC outflows from exchanges = accumulation (supply leaving market). Large inflows = potential sell pressure.

---

## 7. Psychological Challenges Unique to Crypto

### 7.1 The FOMO-Panic Cycle Is Faster and More Extreme

In equities, market panics unfold over days or weeks, giving traders time to react. In crypto:
- A 20% crash can occur in 2 hours
- FOMO-driven rallies of 30% in a day are common
- The emotional trigger time is compressed to minutes

Goodman's observation: crypto's constant motion creates a specific psychological trap — the feeling that "you're always missing a move." This triggers overtrading, which is the most reliable way to turn a profitable strategy into a losing one.

**The discipline rule: follow the system, not the feeling.** A bot with consistent rules avoids this entirely — but the human maintaining the bot needs to resist overriding rules during emotional market moments.

### 7.2 Whale Psychology — They Know Where Your Stops Are

Professional crypto actors understand retail stop patterns:
- Round numbers (BTC at $100,000, $90,000)
- Just below support levels visible on standard charts
- Post-breakout pullback zones

The implication for position placement: use slightly non-obvious stop levels (e.g., 0.5% below the visible support, not exactly at it). Our bot's ATR-buffer approach (OB.low - max(ATR×0.5, 0.2%)) is exactly the right approach — it uses volatility-calibrated buffers instead of obvious price levels.

### 7.3 The 24/7 Exhaustion Problem

Humans cannot monitor markets continuously. The psychological cost of constant availability is:
- Sleep deprivation → impaired judgment → account-destroying decisions at 3 AM
- Emotional involvement in "paper gains" → holding too long into distribution
- Revenge trading after losses — trying to "recover" losses with oversized positions

**The algorithmic advantage is total here.** A bot with hard-coded rules executes without emotional input. This is the single biggest edge of an algorithmic approach over discretionary trading in crypto.

### 7.4 Goodman's Specific Psychological Rules

From his documented trading philosophy:
1. **Write down the trading plan before entering.** If you can't articulate why you're entering, you shouldn't enter.
2. **The exit point is decided at entry.** Never "decide later" when to exit — the psychology of P&L cloud judgment.
3. **Accept losses as cost of business.** A stop-out is not failure — it is risk management working correctly.
4. **Do not check the price every minute.** High-frequency monitoring increases anxiety and impulsive decisions.

---

## 8. Goodman's Specific System Rules

Synthesized from book content and documented trading history:

### Core Rules

1. **Trend filter first**: Determine whether you are in a bull (price > 200MA on daily) or bear (price < 200MA) market. Only take long trades in bull markets. Only take short trades in confirmed bear markets or at major distribution tops.

2. **Moving average crossover for entries**: 20MA crossing above 50MA = trend continuation long signal. 20MA crossing below 50MA = exit or short signal. Do not trade against this.

3. **Stop-loss before entry, always**: Place stop at the nearest technically significant level below entry (for longs). Size the position so the stop represents maximum 2–3% of account, not 2–3% of entry price.

4. **Let profits run**: Do not take partial profits early unless at a major resistance zone. Allow trailing stops to ride the trend. The big winners (5R+) compensate for all the small losses.

5. **The 3:1 rule**: Only take trades where potential profit is at least 3× the risk. In crypto's volatile environment, average winners being 3× losers produces profitability even with 40% win rate.

6. **Cycle awareness**: Recognize which phase the market is in. In accumulation → build long. In distribution → reduce exposure, tighten stops. In decline → flat or short. In euphoria → exit regardless of trend signals.

7. **Fundamentals for context, technicals for timing**: Goodman does read fundamentals (halving cycles, adoption curves, regulatory environment) but uses charts exclusively for trade timing. Never buy a "good fundamental story" without technical confirmation.

8. **Scale in, scale out**: Enter in tranches (33% at each confirmation level), not all at once. Exit the same way — sell into strength in pieces.

---

## 9. Actionable Insights for Our Bot

### 9.1 Immediate Applications

**1. BTC Dominance as regime filter (new signal)**
Before entering any alt perpetual trade (ETH, SOL), check BTC.D:
- BTC.D > 60%: suppress alt signals or reduce position size by 50%
- BTC.D 46–58%: normal alt trading conditions
- BTC.D < 45%: late altseason — increase distribution bias (tighten TP targets)

This is a macro overlay that can reduce alt losses during BTC-dominated consolidation phases.

**2. Funding rate filter (already in strategy, confirm)**
The current filter (|funding| > 0.1% → no trade) is validated by both Goodman's framework and perpetuals market research. Maintain this filter.

**3. Halving cycle phase awareness**
Our bot should have a "macro context" label (configurable, not automatic):
- Bull accumulation phase (0–6 months post-halving): full position sizes
- Bull run phase (6–18 months post-halving): maintain size, tighten trailing stops
- Late bull / distribution (18–24 months post-halving): reduce size, tighter TP targets
- Bear market (below 200MA daily): stop long bot, evaluate short-only mode

**4. Stop placement: avoid obvious round numbers**
Current ATR-buffer approach (OB.low - buffer) is correct. Ensure buffer calculation never places stop exactly at a round number — add a tiny offset if needed.

**5. Liquidation cascade awareness**
When open interest is at extreme highs AND funding rate is extreme positive → the market is a coiled spring. During these conditions, reduce position size by 25–50% even if confluence score is high. The liquidation cascade risk overrides the technical signal quality.

### 9.2 BTC-Led Alt Strategy Validation

Goodman's trend following framework directly validates the BTC-led alt approach (identified in project memory as a promising expansion). The rotation sequence (BTC → ETH → large caps → mid caps) means:

- ETH signals have higher quality when BTC has already confirmed a new trend leg
- SOL signals have higher quality when ETH/BTC ratio is rising
- BTC 4H structure should be checked as a prerequisite filter for any alt trade

**Practical implementation:** Before executing an alt entry signal, require that BTC 4H structure shows at least one of: (a) BTC above 4H 50 EMA, (b) BTC made a higher high in the last 48 hours, (c) BTC dominance is flat or falling. If none of these, suppress the alt signal.

### 9.3 Patel's Cycle Timing for Position Management

For the multi-pair expansion (ETHUSDT, SOLUSDT, etc.):

- In early altseason (dominance 55–58%, just starting to fall): weight allocation heavier to large caps (ETH, SOL)
- In mid altseason (dominance 46–55%): full allocation across all active pairs
- In late altseason (dominance <45%, microcaps moving): reduce size on all pairs, tighten TP targets, prepare distribution

### 9.4 Risk Calibration Points

From Goodman's and Patel's combined frameworks:

| Parameter | Goodman/Patel Recommendation | Our Current Config | Verdict |
|---|---|---|---|
| Max loss per trade | 1–3% of account | 3% (HyroTrader max) | At the top end — acceptable |
| Stop placement | Below technical level + volatility buffer | OB.low - ATR×0.5 | Correct method |
| Leverage | Low (2–5×) for trend trades | 5× | Acceptable, conservative |
| Trade direction | Bull: long only. Bear: short or flat | Long and short based on signal | Add 200MA daily filter |
| Trend filter | 200MA (daily) as bull/bear separator | No explicit macro filter currently | **Gap — add this filter** |
| Funding rate filter | Essential for perps | Present (0.1%) | Validated |
| Cycle phase awareness | Critical for position sizing | Not implemented | **Add macro phase parameter** |

### 9.5 The Single Most Valuable Insight

Both Goodman and Patel independently converge on the same core truth: **the majority of crypto trading profit comes from a minority of trades — the big trend moves**. Everything else is noise management.

For our bot, this means:
- The trailing stop component (after TP1) is not optional polish — it is the mechanism that captures the 5R+ trades that make the strategy profitable
- The confluence filter must be stringent enough (≥70/100) to ensure we're entering on high-quality setups where the trend is established, not gambling on marginal signals
- Missing a trade because it didn't meet the threshold is not a loss — it is the discipline that preserves capital for the genuine opportunities

Goodman explicitly documented that he publicly called the December 2017 top and exited before the 80% crash — not because he predicted the future, but because the technical structure no longer justified staying in. The 200MA had been violated, the trend was broken. The system said exit. He exited. That discipline, replicated algorithmically, is the edge.

---

## Sources

- [The Crypto Trader — Glen Goodman (Google Books)](https://books.google.com/books/about/The_Crypto_Trader.html?id=u6SXDwAAQBAJ)
- [The Crypto Trader — Amazon](https://www.amazon.com/Crypto-Trader-trading-Bitcoin-cryptocurrencies/dp/0857197177)
- [Glen Goodman — Official Site](https://www.glengoodman.com/)
- [An Altcoin Trader's Handbook — Nik Patel (Amazon)](https://www.amazon.com/Altcoin-Traders-Handbook-Nik-Patel/dp/198617011X)
- [An Altcoin Trader's Blog — Nik Patel](https://www.altcointradershandbook.com/)
- [Mastering the Altcoin Game — Medium/The Capital](https://medium.com/thecapital/mastering-the-altcoin-game-insights-from-an-altcoin-traders-handbook-by-nik-patel-96949d15370d)
- [Action Steps from Altcoin Trader's Handbook — Medium](https://medium.com/@Jacoby_T_Nelson/action-steps-quotes-from-an-altcoin-traders-handbook-by-nik-patel-e5edf6a90398)
- [Bitcoin Halving Cycle Trading — Bookmap](https://bookmap.com/blog/trading-the-crypto-halving-cycle-order-flow-insights-for-2025)
- [How Bitcoin Halving Affects Altcoins 2024–2025 — ChangeNow](https://changenow.io/blog/how-bitcoin-halving-will-affect-altcoins)
- [Bitcoin Dominance and Altcoin Season — Phemex](https://phemex.com/blogs/bitcoin-dominance-altcoin-season)
- [Altcoin Season Index — CoinMarketCap](https://coinmarketcap.com/charts/altcoin-season-index/)
- [A Primer on Perpetual Futures — Coinbase Institutional](https://www.coinbase.com/institutional/research-insights/research/market-intelligence/a-primer-on-perpetual-futures)
- [FTX Collapse — CoinLedger](https://coinledger.io/learn/the-ftx-collapse)
- [Crypto Trading Psychology — CCN](https://www.ccn.com/education/the-market-psychology-of-cryptocurrency-trading/)
- [Whale Manipulation Tactics — OKX](https://www.okx.com/en-us/learn/btc-whale-shorting-market-manipulation)
- [Best Technical Indicators for Crypto 2024 — tastycrypto](https://www.tastycrypto.com/blog/best-technical-indicators/)
- [Glen Goodman Mixed Review — CryptoRobotics](https://cryptorobotics.ai/news/mastering-crypto-trading-insights-from-the-crypto-trader/)
