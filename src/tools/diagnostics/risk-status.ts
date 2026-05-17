import { getRiskState, formatRiskState } from '../../runtime/risk-guard';
import { close as closePg } from '../../core/db';

async function main() {
  const s = await getRiskState();
  console.log(formatRiskState(s));
  await closePg();
}

main().catch(e => {
  console.error('risk-status failed:', e?.message ?? e);
  process.exit(1);
});
