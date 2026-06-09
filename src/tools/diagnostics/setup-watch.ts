import { close as closePg } from '../../core/db';
import { loadCoinglassAt } from '../../data/coinglass-features';
import { percentile, trendUp } from '../../core/indicators';
import { query } from '../../core/db';
import { TIER1_PORTFOLIO } from '../../runtime/pair-strategies';

interface PairView {
  pair: string;
  enabled: boolean;
  archetype: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'unknown';
  pctHi: number;
  pctLo: number;
  usePairTrend: boolean;
  useBtcTrend: boolean;
  signal: string;
  curStr: string;
  pctMain: number | null;
  pctAux: number | null;
  pairTrend: 'up' | 'dn' | null;
  btcTrend: 'up' | 'dn' | null;
  hint: string;
}

function classify(name: string): { arch: PairView['archetype']; signal: string } {
  if (name.startsWith('ls-top-position-fade')) return { arch: 'S1', signal: 'LS Top Position' };
  if (name.startsWith('funding-fade')) return { arch: 'S3', signal: 'Funding (OI-weighted)' };
  if (name.startsWith('funding-ta-confluence')) return { arch: 'S4', signal: 'Funding + LS Top Account' };
  if (name.startsWith('ls-top-pos-funding-confluence')) return { arch: 'S5', signal: 'LS Top Position + Funding' };
  return { arch: 'unknown', signal: '?' };
}

async function loadPair4hBars(pair: string, limit = 80): Promise<{ close: number }[]> {
  const r = await query<{ close: string }>(
    `SELECT close::text FROM candles WHERE symbol = $1 AND tf = '240m' ORDER BY ts DESC LIMIT $2`,
    [pair, limit],
  );
  return r.rows.map(x => ({ close: parseFloat(x.close) })).reverse();
}

async function main() {
  const now = Date.now();
  const btcBars = await loadPair4hBars('BTCUSDT');
  const btcTrend: 'up' | 'dn' | null = btcBars.length >= 55
    ? (trendUp(btcBars.map(b => b.close), 20, 50) === true ? 'up' : trendUp(btcBars.map(b => b.close), 20, 50) === false ? 'dn' : null)
    : null;

  const views: PairView[] = [];

  for (const cfg of TIER1_PORTFOLIO) {
    const coin = cfg.pair.replace(/USDT$/, '');
    const cg = await loadCoinglassAt(coin, cfg.pair, now);
    const p: any = (cfg.strategy as any).p ?? {};
    const { arch, signal } = classify(cfg.strategy.name);
    const pctHi: number = p.pctHi ?? 0.85;
    const pctLo: number = p.pctLo ?? 0.15;
    const window: number = p.windowBars ?? 180;

    let pctMain: number | null = null;
    let pctAux: number | null = null;
    let curStr = '';

    if (arch === 'S1' || arch === 'S2') {
      if (cg.ls_top_position != null && cg.ls_top_position_history.length >= window) {
        pctMain = percentile(cg.ls_top_position_history.slice(-window), cg.ls_top_position);
        curStr = `lsTopPos=${cg.ls_top_position.toFixed(3)}`;
      }
    } else if (arch === 'S3') {
      if (cg.funding_oi_weighted != null && cg.funding_oi_weighted_history.length >= window) {
        pctMain = percentile(cg.funding_oi_weighted_history.slice(-window), cg.funding_oi_weighted);
        curStr = `fr=${(cg.funding_oi_weighted * 100).toFixed(4)}%`;
      }
    } else if (arch === 'S4') {
      if (cg.funding_oi_weighted != null && cg.ls_top_account != null
        && cg.funding_oi_weighted_history.length >= window && cg.ls_top_account_history.length >= window) {
        pctMain = percentile(cg.funding_oi_weighted_history.slice(-window), cg.funding_oi_weighted);
        pctAux = percentile(cg.ls_top_account_history.slice(-window), cg.ls_top_account);
        curStr = `fr=${(cg.funding_oi_weighted * 100).toFixed(4)}% lsTA=${cg.ls_top_account.toFixed(3)}`;
      }
    }

    let pairTrend: 'up' | 'dn' | null = null;
    if (p.usePairTrend) {
      const bars = await loadPair4hBars(cfg.pair);
      if (bars.length >= 55) {
        const t = trendUp(bars.map(b => b.close), 20, 50);
        pairTrend = t === true ? 'up' : t === false ? 'dn' : null;
      }
    }

    let hint = '';
    if (pctMain == null) {
      hint = 'no data';
    } else {
      const distHi = pctHi - pctMain;
      const distLo = pctMain - pctLo;
      const closerToShort = distHi < distLo;
      const dist = closerToShort ? distHi : distLo;
      const side = closerToShort ? 'SHORT' : 'LONG';
      if (arch === 'S4') {
        const aux = pctAux ?? -1;
        const auxOk = side === 'SHORT' ? aux >= pctHi : aux <= pctLo;
        hint = `→${side} Δ=${(dist * 100).toFixed(1)}pp (aux=${(aux * 100).toFixed(0)}% ${auxOk ? '✓' : '✗'})`;
      } else {
        hint = `→${side} Δ=${(dist * 100).toFixed(1)}pp`;
      }
    }

    views.push({
      pair: cfg.pair,
      enabled: cfg.enabled,
      archetype: arch,
      pctHi, pctLo,
      usePairTrend: !!p.usePairTrend,
      useBtcTrend: !!p.useBtcTrend,
      signal,
      curStr,
      pctMain, pctAux,
      pairTrend,
      btcTrend: p.useBtcTrend ? btcTrend : null,
      hint,
    });
  }

  console.log(`\n==== setup-watch @ ${new Date(now).toISOString()} ====`);
  console.log(`BTC 4H trend (EMA20/50): ${btcTrend ?? '?'}\n`);
  const header = `${'PAIR'.padEnd(9)} ${'ARC'.padEnd(4)} ${'EN'.padEnd(3)} ${'pct(main)'.padEnd(11)} ${'aux'.padEnd(6)} ${'thr'.padEnd(11)} ${'pairT'.padEnd(6)} ${'btcT'.padEnd(5)} signal/cur            hint`;
  console.log(header);
  console.log('-'.repeat(header.length + 30));
  for (const v of views) {
    const pct = v.pctMain == null ? '-' : `${(v.pctMain * 100).toFixed(1)}%`;
    const aux = v.pctAux == null ? '-' : `${(v.pctAux * 100).toFixed(0)}%`;
    const thr = `${(v.pctLo * 100).toFixed(0)}/${(v.pctHi * 100).toFixed(0)}`;
    const pt = v.usePairTrend ? (v.pairTrend ?? '?') : '·';
    const bt = v.useBtcTrend ? (v.btcTrend ?? '?') : '·';
    const enFlag = v.enabled ? 'on' : 'off';
    const sigCur = `${v.archetype}:${v.curStr}`;
    console.log(`${v.pair.padEnd(9)} ${v.archetype.padEnd(4)} ${enFlag.padEnd(3)} ${pct.padEnd(11)} ${aux.padEnd(6)} ${thr.padEnd(11)} ${pt.padEnd(6)} ${bt.padEnd(5)} ${sigCur.padEnd(22)} ${v.hint}`);
  }
  console.log('');
  await closePg();
}

main().catch(e => { console.error(e); process.exit(1); });
