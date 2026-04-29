import fs from 'node:fs';
import path from 'node:path';

const VAULT_JOURNAL = path.resolve(__dirname, '../../vault/Journal');

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function timeStr(d: Date): string {
  return d.toISOString().slice(11, 16);     // HH:MM
}

export interface JournalAppendArgs {
  cycleId?: string;                // 'C0142'
  eventTitle: string;              // 'BTCUSDT regime → range', 'ETH SHORT entry trigger', ...
  body?: string;                   // optional multi-line markdown body
  ts?: Date;
}

export function appendJournal(a: JournalAppendArgs): string {
  const ts = a.ts ?? new Date();
  const dayFile = path.join(VAULT_JOURNAL, `${dateStr(ts)}.md`);
  fs.mkdirSync(VAULT_JOURNAL, { recursive: true });

  const isNewFile = !fs.existsSync(dayFile);
  const lines: string[] = [];
  if (isNewFile) {
    lines.push(`# Journal — ${dateStr(ts)}`, '');
  }
  const header = `### [${timeStr(ts)} UTC]${a.cycleId ? ` — ${a.cycleId}` : ''} — ${a.eventTitle}`;
  lines.push('', header);
  if (a.body) lines.push('', a.body.trim());
  lines.push('');

  fs.appendFileSync(dayFile, lines.join('\n'));
  return dayFile;
}

export function appendHeartbeat(args: {
  cycleId: string;
  regimeBtc: string;
  regimeEth: string;
  pnlDayUsd: number;
  triggersFired: number;
  triggersTotal: number;
  ts?: Date;
}): string {
  const ts = args.ts ?? new Date();
  const line = `### [${timeStr(ts)} UTC] — heartbeat (${args.cycleId}) — regime [BTC:${args.regimeBtc}, ETH:${args.regimeEth}], P&L $${args.pnlDayUsd.toFixed(0)}, ${args.triggersFired}/${args.triggersTotal} triggers in window`;
  const dayFile = path.join(VAULT_JOURNAL, `${dateStr(ts)}.md`);
  fs.mkdirSync(VAULT_JOURNAL, { recursive: true });
  if (!fs.existsSync(dayFile)) {
    fs.writeFileSync(dayFile, `# Journal — ${dateStr(ts)}\n\n`);
  }
  fs.appendFileSync(dayFile, '\n' + line + '\n');
  return dayFile;
}
