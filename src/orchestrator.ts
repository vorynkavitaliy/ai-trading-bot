import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';
import { TelegramNotifier } from './notifications/telegram';
import { db } from './db';
import { cache, SharedPosition } from './cache';
import { config } from './config';
import { RiskEngine } from './risk/engine';
import { NewsFetcher, MacroAssessment } from './news/fetcher';
import { generateSignal, Signal } from './signal/generator';
import { planTrade, InstrumentSpec, fmtPrice } from './trade/planner';
import { executeAcrossAccounts } from './trade/executor';
import { PositionManager, announceClosedAggregated, announceTrailedAggregated, ClosedTrade, TrailEvent } from './trade/manager';
import { TradeRepo, AuditRepo, EquityRepo, SignalRepo } from './db/repositories';
import { Candle } from './analysis/indicators';
import { detectSession, isNearFundingWindow } from './analysis/sessions';

/**
 * Bot — central orchestrator. One instance per process.
 *
 *   .start()              — initialise DB, telegram greet
 *   .scanPair(symbol)     — full cycle for one pair (called by /trade-scan loop)
 *   .fullReport()         — Telegram report for all accounts (called by 30-min cron)
 *   .stop()               — cleanup
 *
 * Risk protection: server-side SL on every position + max 2 positions (4 for A+).
 * No continuous DD monitor — stops on Bybit + position limits are sufficient.
 */
export class Bot {
  readonly accounts: AccountManager;
  readonly bybit: BybitClient;
  readonly risk: RiskEngine;
  readonly telegram?: TelegramNotifier;
  readonly news = new NewsFetcher();
  private positionManager: PositionManager;

  // simple in-memory caches
  private instrumentCache = new Map<string, InstrumentSpec>();
  private lastNews: MacroAssessment | null = null;
  private lastNewsAt = 0;

  constructor() {
    this.accounts = new AccountManager();
    this.bybit = new BybitClient(this.accounts);
    this.risk = new RiskEngine(this.bybit);

    if (config.telegram.enabled) {
      this.telegram = new TelegramNotifier(config.telegram.token, config.telegram.chatId);
    } else {
      console.log('[Bot] Telegram disabled (no token/chat_id)');
    }

    this.positionManager = new PositionManager(this.bybit);
  }

  /**
   * @param opts.announce — send Telegram start/stop greeting. Default false (suitable for /loop
   *   single-shot mode where each iteration would otherwise spam start/stop messages).
   *   Set true for long-running daemon (`npm run dev`).
   */
  async start(opts: { announce?: boolean } = {}): Promise<void> {
    await db.init();
    await AuditRepo.log({ level: 'info', source: 'bot', event: 'started', message: 'Bot starting' });
    if (opts.announce && this.telegram) {
      await this.telegram.botStarted('all', this.accounts.totalAccounts);
    }
  }

  async stop(reason = 'manual', opts: { announce?: boolean } = {}): Promise<void> {
    if (opts.announce && this.telegram) await this.telegram.botStopped('all', reason);
    await AuditRepo.log({ level: 'info', source: 'bot', event: 'stopped', message: reason });
    await db.close();
    await cache.close();
  }

  // ─── Per-pair cycle (called by /trade-scan SYMBOL) ───────────────────

  async scanPair(symbol: string, opts: { reportTelegram?: boolean } = {}): Promise<{
    signal: Signal | null;
    executed: boolean;
    plan?: any;
    skipReason?: string;
  }> {
    try {
      // 1. Refresh DD snapshot for all accounts (cheap REST)
      await Promise.all(this.accounts.getAllSubAccounts().map((s) => this.risk.snapshot(s)));

      // 2. Pull klines (parallel) — 4H bias, 1H structure, 15M setup, 3M entry trigger
      const [c4h, c1h, c15m, c3m] = await Promise.all([
        this.bybit.getKlines(symbol, '240', 250),
        this.bybit.getKlines(symbol, '60', 200),
        this.bybit.getKlines(symbol, '15', 200),
        this.bybit.getKlines(symbol, '3', 200),
      ]);

      if (c4h.length < 50 || c1h.length < 50 || c15m.length < 30 || c3m.length < 30) {
        return { signal: null, executed: false, skipReason: 'insufficient klines' };
      }

      // 3. News context (refresh every 15 min)
      const news = await this.refreshNews();

      // 4. Generate signal
      const signal = generateSignal({
        symbol,
        c4h: c4h as Candle[],
        c1h: c1h as Candle[],
        c15m: c15m as Candle[],
        c3m: c3m as Candle[],
        newsBias: news.bias,
      });

      // 5. Manage existing positions on this pair (trail SL, reconcile closed).
      // Aggregate per-account events into single Telegram messages.
      const instrument = await this.getInstrument(symbol);
      const managed = await Promise.all(this.accounts.getAllSubAccounts().map((sub) =>
        this.positionManager.manage(sub, symbol, c1h as Candle[], instrument.tickSize)
      ));
      const allClosed: ClosedTrade[] = managed.flatMap((m) => m.closed);
      const allTrailed: TrailEvent[] = managed.flatMap((m) => m.trailed);
      // Unregister closed positions from shared registry
      if (allClosed.length > 0) {
        await cache.unregisterPosition(symbol);
      }
      if (this.telegram) {
        await announceClosedAggregated(this.telegram, allClosed);
        await announceTrailedAggregated(this.telegram, allTrailed);
      }

      // 6. Skip if no signal or rejected
      if (signal.direction === 'None' || signal.confluence < config.trade.minConfluence) {
        await SignalRepo.insert({
          symbol, direction: signal.direction, confluence: signal.confluence,
          regime: signal.regime,
          scores: { long: signal.long, short: signal.short },
          executed: false,
          rejectReason: signal.rejectReason ?? `confluence ${signal.confluence}/4 < ${config.trade.minConfluence}`,
        });
        // Only report on risk warnings. Position open/close/trail already emit
        // their own Telegram events — don't spam a full scan report each cycle.
        if (this.telegram && opts.reportTelegram) {
          const anyWarn = (await Promise.all(this.accounts.getAllSubAccounts().map(async (s) => {
            const w = await this.bybit.getWallet(s);
            return (await this.risk.assess(s, Number(w.equity))).status;
          }))).some((st) => st !== 'ok');
          if (anyWarn) {
            await this.sendScanReport(symbol, signal, c1h as Candle[], news);
          }
        }
        return { signal, executed: false, skipReason: signal.rejectReason ?? 'low confluence' };
      }

      // 7. Plan trade — 3M close gives the most precise entry reference
      const last = (c3m as Candle[])[c3m.length - 1].close;
      const plan = planTrade({
        symbol,
        direction: signal.direction,
        entryRef: last,
        c1h: c1h as Candle[],
        c15m: c15m as Candle[],
        c3m: c3m as Candle[],
        instrument,
        targetRR: config.trade.minRR,
      });

      if (plan.rr < config.trade.minRR) {
        return { signal, executed: false, skipReason: `R:R ${plan.rr} < ${config.trade.minRR}` };
      }

      // 8. Session + funding window checks
      const session = detectSession();
      if (!session.allowEntry) {
        return { signal, executed: false, skipReason: `Dead zone (${session.label}) — no entries` };
      }
      if (isNearFundingWindow()) {
        return { signal, executed: false, skipReason: 'Near funding rate window (±10 min)' };
      }

      // 9. Block re-entry if already have a position on this symbol
      const allPositions = await this.bybit.getAllPositions(symbol);
      const hasExisting = allPositions.some((a) => a.positions.length > 0);
      if (hasExisting) {
        return { signal, executed: false, skipReason: 'position already open' };
      }

      // 10. Slot management — check if we need to replace a weaker position
      const openCount = await cache.getPositionCount();
      const maxBase = 3;
      const isAplus = signal.confluence >= 4;
      const maxAllowed = isAplus ? config.trade.maxPositions : maxBase;

      if (openCount >= maxAllowed) {
        // All slots full — try to replace weakest if new signal is stronger
        const weakest = await cache.getWeakestPosition();
        if (!weakest || signal.confluence <= weakest.confluence) {
          return { signal, executed: false, skipReason: `All ${openCount} slots full, new signal (${signal.confluence}/4) not stronger than weakest (${weakest?.confluence ?? '?'}/4)` };
        }

        // New signal is stronger — close the weakest position to free a slot
        console.log(`[Orchestrator] Replacing ${weakest.symbol} (${weakest.confluence}/4) with ${symbol} (${signal.confluence}/4)`);
        await this.closePositionForReplacement(weakest.symbol);
        await AuditRepo.log({
          level: 'info', source: 'orchestrator', event: 'position_replaced',
          symbol, message: `Closed ${weakest.symbol} (${weakest.confluence}/4) → opening ${symbol} (${signal.confluence}/4)`,
        });
      }

      // 11. Cross-pair lock — prevent two terminals racing on the same symbol
      const lockOk = await cache.tryLock(`scan:${symbol}`, 30);
      if (!lockOk) return { signal, executed: false, skipReason: 'lock busy' };

      try {
        const reports = await executeAcrossAccounts({
          bybit: this.bybit,
          risk: this.risk,
          telegram: this.telegram,
          instrument,
          signal,
          plan,
          regimeLabel: signal.regime,
          newsRiskMultiplier: news.riskMultiplier,
        });
        const ok = reports.some((r) => r.success);

        // Register position in shared registry so other terminals can see it
        if (ok) {
          await cache.registerPosition(symbol, {
            symbol,
            direction: signal.direction as 'Long' | 'Short',
            confluence: signal.confluence,
            regime: signal.regime,
            entry: plan.entry,
            openedAt: Date.now(),
            terminal: symbol,
          });
        }

        if (ok && this.telegram && opts.reportTelegram) {
          await this.sendScanReport(symbol, signal, c1h as Candle[], news);
        }

        return { signal, executed: ok, plan };
      } finally {
        await cache.unlock(`scan:${symbol}`);
      }
    } catch (err: any) {
      console.error(`[scanPair ${symbol}]`, err);
      await AuditRepo.log({
        level: 'error', source: 'orchestrator', event: 'scan_exception',
        symbol, message: err.message ?? String(err),
      });
      if (this.telegram) await this.telegram.error(`scanPair ${symbol}`, err.message ?? String(err));
      return { signal: null, executed: false, skipReason: err.message ?? String(err) };
    }
  }

  // ─── Multi-pair scan: analyze all → rank → execute best ──────────

  /**
   * Phase 1: Analyze a pair — returns signal + plan without executing.
   * Manages existing positions (trail/close) as a side effect.
   */
  private async analyzePair(symbol: string, opts: { reportTelegram?: boolean } = {}): Promise<{
    symbol: string;
    signal: Signal | null;
    plan?: any;
    instrument?: InstrumentSpec;
    news?: MacroAssessment;
    c1h?: Candle[];
    skipReason?: string;
  }> {
    try {
      // 1. Refresh DD snapshot
      await Promise.all(this.accounts.getAllSubAccounts().map((s) => this.risk.snapshot(s)));

      // 2. Pull klines (parallel)
      const [c4h, c1h, c15m, c3m] = await Promise.all([
        this.bybit.getKlines(symbol, '240', 250),
        this.bybit.getKlines(symbol, '60', 200),
        this.bybit.getKlines(symbol, '15', 200),
        this.bybit.getKlines(symbol, '3', 200),
      ]);

      if (c4h.length < 50 || c1h.length < 50 || c15m.length < 30 || c3m.length < 30) {
        return { symbol, signal: null, skipReason: 'insufficient klines' };
      }

      // 3. News context
      const news = await this.refreshNews();

      // 4. Generate signal
      const signal = generateSignal({
        symbol, c4h: c4h as Candle[], c1h: c1h as Candle[],
        c15m: c15m as Candle[], c3m: c3m as Candle[], newsBias: news.bias,
      });

      // 5. Manage existing positions (trail SL, reconcile closed)
      const instrument = await this.getInstrument(symbol);
      const managed = await Promise.all(this.accounts.getAllSubAccounts().map((sub) =>
        this.positionManager.manage(sub, symbol, c1h as Candle[], instrument.tickSize)
      ));
      const allClosed: ClosedTrade[] = managed.flatMap((m) => m.closed);
      const allTrailed: TrailEvent[] = managed.flatMap((m) => m.trailed);
      if (allClosed.length > 0) await cache.unregisterPosition(symbol);
      if (this.telegram) {
        await announceClosedAggregated(this.telegram, allClosed);
        await announceTrailedAggregated(this.telegram, allTrailed);
      }

      // 7. No signal or low confluence
      if (signal.direction === 'None' || signal.confluence < config.trade.minConfluence) {
        await SignalRepo.insert({
          symbol, direction: signal.direction, confluence: signal.confluence,
          regime: signal.regime, scores: { long: signal.long, short: signal.short },
          executed: false,
          rejectReason: signal.rejectReason ?? `confluence ${signal.confluence}/4 < ${config.trade.minConfluence}`,
        });
        return { symbol, signal, skipReason: signal.rejectReason ?? 'low confluence' };
      }

      // 8. Session + funding checks
      const session = detectSession();
      if (!session.allowEntry) {
        return { symbol, signal, skipReason: `Dead zone (${session.label})` };
      }
      if (isNearFundingWindow()) {
        return { symbol, signal, skipReason: 'Near funding rate window' };
      }

      // 9. Already have position on this symbol
      const allPositions = await this.bybit.getAllPositions(symbol);
      const hasExisting = allPositions.some((a) => a.positions.length > 0);
      if (hasExisting) {
        return { symbol, signal, skipReason: 'position already open' };
      }

      // 10. Plan trade
      const last = (c3m as Candle[])[c3m.length - 1].close;
      const plan = planTrade({
        symbol, direction: signal.direction, entryRef: last,
        c1h: c1h as Candle[], c15m: c15m as Candle[], c3m: c3m as Candle[],
        instrument, targetRR: config.trade.minRR,
      });

      if (plan.rr < config.trade.minRR) {
        return { symbol, signal, skipReason: `R:R ${plan.rr} < ${config.trade.minRR}` };
      }

      return { symbol, signal, plan, instrument, news, c1h: c1h as Candle[] };
    } catch (err: any) {
      console.error(`[analyzePair ${symbol}]`, err);
      return { symbol, signal: null, skipReason: err.message };
    }
  }

  /**
   * Scan all pairs: analyze in parallel → rank by confluence → execute best signals.
   * This is the recommended mode for single-terminal operation.
   */
  async scanAll(symbols: string[], opts: { reportTelegram?: boolean } = {}): Promise<{
    symbol: string; signal: Signal | null; executed: boolean; skipReason?: string; plan?: any;
  }[]> {
    // Phase 1: Analyze ALL pairs in parallel
    const analyses = await Promise.all(symbols.map((s) => this.analyzePair(s, opts)));

    // Phase 2: Separate ready-to-execute from skipped
    const ready = analyses.filter((a) => a.signal && a.plan && a.instrument && !a.skipReason);
    const skipped = analyses.filter((a) => !a.plan || a.skipReason);

    // Phase 3: Rank by confluence (highest first), then execute in priority order
    ready.sort((a, b) => (b.signal!.confluence) - (a.signal!.confluence));

    const results: { symbol: string; signal: Signal | null; executed: boolean; skipReason?: string; plan?: any }[] = [];

    // Add skipped results
    for (const s of skipped) {
      results.push({ symbol: s.symbol, signal: s.signal, executed: false, skipReason: s.skipReason });
    }

    // Execute ready signals in order of quality
    for (const a of ready) {
      // Re-check slot availability (may have been filled by higher-priority signal above)
      const openCount = await cache.getPositionCount();
      const isAplus = a.signal!.confluence >= 4;
      const maxAllowed = isAplus ? config.trade.maxPositions : 3;

      if (openCount >= maxAllowed) {
        // Try replacement
        const weakest = await cache.getWeakestPosition();
        if (!weakest || a.signal!.confluence <= weakest.confluence) {
          results.push({
            symbol: a.symbol, signal: a.signal, executed: false,
            skipReason: `Slots full (${openCount}/${maxAllowed}), not stronger than weakest (${weakest?.confluence ?? '?'}/4)`,
          });
          continue;
        }
        // Replace weakest
        console.log(`[scanAll] Replacing ${weakest.symbol} (${weakest.confluence}/4) with ${a.symbol} (${a.signal!.confluence}/4)`);
        await this.closePositionForReplacement(weakest.symbol);
        await AuditRepo.log({
          level: 'info', source: 'orchestrator', event: 'position_replaced',
          symbol: a.symbol, message: `Closed ${weakest.symbol} (${weakest.confluence}/4) → ${a.symbol} (${a.signal!.confluence}/4)`,
        });
      }

      // Execute
      const lockOk = await cache.tryLock(`scan:${a.symbol}`, 30);
      if (!lockOk) {
        results.push({ symbol: a.symbol, signal: a.signal, executed: false, skipReason: 'lock busy' });
        continue;
      }

      try {
        const reports = await executeAcrossAccounts({
          bybit: this.bybit, risk: this.risk, telegram: this.telegram,
          instrument: a.instrument!, signal: a.signal!, plan: a.plan!,
          regimeLabel: a.signal!.regime,
          newsRiskMultiplier: a.news?.riskMultiplier,
        });
        const ok = reports.some((r) => r.success);

        if (ok) {
          await cache.registerPosition(a.symbol, {
            symbol: a.symbol, direction: a.signal!.direction as 'Long' | 'Short',
            confluence: a.signal!.confluence, regime: a.signal!.regime,
            entry: a.plan!.entry, openedAt: Date.now(), terminal: a.symbol,
          });
        }

        results.push({ symbol: a.symbol, signal: a.signal, executed: ok, plan: a.plan });
      } finally {
        await cache.unlock(`scan:${a.symbol}`);
      }
    }

    return results;
  }

  // ─── Position replacement ────────────────────────────────────────

  private async closePositionForReplacement(symbol: string): Promise<void> {
    const subs = this.accounts.getAllSubAccounts();
    await Promise.all(subs.map(async (sub) => {
      const positions = await this.bybit.getPositions(sub, symbol);
      for (const p of positions) {
        const side = p.side === 'Buy' ? 'Sell' : 'Buy';
        try {
          await sub.client.submitOrder({
            category: 'linear', symbol, side, orderType: 'Market',
            qty: p.size, reduceOnly: true, timeInForce: 'GTC',
          });
        } catch (err: any) {
          console.error(`[Orchestrator] replacement close failed ${sub.label} ${symbol}:`, err.message);
        }
      }
    }));
    await cache.unregisterPosition(symbol);
    await Promise.all(subs.map((sub) => cache.clearHeat(sub.label, symbol)));
    if (this.telegram) {
      await this.telegram.error('Замена позиции', `${symbol} закрыта — освобождаю слот для более сильного сигнала`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private async refreshNews(): Promise<MacroAssessment> {
    if (this.lastNews && Date.now() - this.lastNewsAt < 15 * 60_000) return this.lastNews;
    try {
      const a = await this.news.assess(60);
      this.lastNews = a;
      this.lastNewsAt = Date.now();
      return a;
    } catch (err: any) {
      console.error('[Bot] news fetch failed:', err.message);
      return this.lastNews ?? { bias: 'neutral', impact: 'low', riskMultiplier: 1.0, reason: 'news unavailable', triggers: [], items: [] };
    }
  }

  private async getInstrument(symbol: string): Promise<InstrumentSpec> {
    if (this.instrumentCache.has(symbol)) return this.instrumentCache.get(symbol)!;
    const info = await this.bybit.getInstrumentInfo(symbol);
    const spec: InstrumentSpec = {
      symbol,
      tickSize: Number(info.priceFilter.tickSize),
      qtyStep: Number(info.lotSizeFilter.qtyStep),
      minQty: Number(info.lotSizeFilter.minOrderQty),
      maxLeverage: Number(info.leverageFilter.maxLeverage),
    };
    this.instrumentCache.set(symbol, spec);
    return spec;
  }

  private async sendScanReport(symbol: string, signal: Signal, c1h: Candle[], news: MacroAssessment): Promise<void> {
    if (!this.telegram) return;
    const wallets = await this.bybit.getAllWallets();
    const positions = await this.bybit.getAllPositions(symbol);

    const accountsRow = await Promise.all(wallets.map(async (w) => {
      const a = await this.risk.assess(w.sub, Number(w.wallet.equity));
      const pnlToday = await TradeRepo.dailyPnl(w.sub.label);
      return {
        label: w.sub.label,
        equity: Number(w.wallet.equity).toFixed(2),
        pnlToday: pnlToday.toFixed(2),
        dailyDd: a.dailyDdPct.toFixed(2),
        totalDd: a.totalDdPct.toFixed(2),
      };
    }));

    const flatPos = positions.flatMap((a) =>
      a.positions.map((p) => ({
        pair: p.symbol,
        direction: p.side === 'Buy' ? 'LONG' : 'SHORT',
        entry: p.entryPrice,
        current: p.markPrice,
        pnl: Number(p.unrealisedPnl).toFixed(2),
        pnlPct: ((Number(p.unrealisedPnl) / Math.max(1, Number(p.entryPrice) * Number(p.size))) * 100).toFixed(2),
      }))
    );

    const action = signal.direction === 'None' ? `Skip — ${signal.rejectReason ?? 'low confluence'}` : `${signal.direction.toUpperCase()} setup ready`;

    await this.telegram.scanReport({
      pair: symbol,
      regime: signal.regime,
      regimeScore: signal.regimeReason,
      longScore: String(signal.long.total),
      shortScore: String(signal.short.total),
      action,
      accounts: accountsRow,
      positions: flatPos,
      newsContext: `bias=${news.bias} impact=${news.impact}${news.triggers.length ? '\n• ' + news.triggers.slice(0, 3).join('\n• ') : ''}`,
    });
  }

  // ─── Periodic full report (every 30 min cron) ───────────────────────

  async fullReport(): Promise<void> {
    if (!this.telegram) return;
    try {
      const wallets = await this.bybit.getAllWallets();
      const allPos = await this.bybit.getAllPositions();
      const news = await this.refreshNews();

      const rows = await Promise.all(wallets.map(async (w) => {
        const a = await this.risk.assess(w.sub, Number(w.wallet.equity));
        const pnlToday = await TradeRepo.dailyPnl(w.sub.label);
        const posCount = allPos.find((p) => p.sub.label === w.sub.label)?.positions.length ?? 0;
        const status = a.status === 'ok' ? 'CLEAR' : a.status === 'warn' ? 'WARNING' : 'CRITICAL';
        const totalPnl = Number(w.wallet.equity) - w.sub.volume;
        return {
          label: w.sub.label,
          volume: w.sub.volume,
          equity: Number(w.wallet.equity).toFixed(2),
          pnlToday: pnlToday.toFixed(2),
          pnlTotal: totalPnl.toFixed(2),
          dailyDd: a.dailyDdPct.toFixed(2),
          totalDd: a.totalDdPct.toFixed(2),
          positions: posCount,
          status,
        };
      }));

      const totalPnlToday = rows.reduce((s, r) => s + Number(r.pnlToday), 0);
      const totalPositions = rows.reduce((s, r) => s + r.positions, 0);

      await this.telegram.fullReport({
        accounts: rows,
        totalPnlToday: totalPnlToday.toFixed(2),
        totalPositions,
        regime: 'mixed (per-pair)',
        newsHighlights: news.triggers.slice(0, 5).join('\n') || 'без значимых триггеров',
      });
    } catch (err: any) {
      console.error('[fullReport]', err);
    }
  }
}
