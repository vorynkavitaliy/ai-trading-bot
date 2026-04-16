/**
 * Trading session detection and quality scoring.
 *
 * Sessions (UTC):
 *   Asian:     00:00 – 07:00  (lower quality, accumulation phase)
 *   London:    07:00 – 13:00  (manipulation phase, stop hunts)
 *   NY+London: 13:00 – 17:00  (highest quality, institutional overlap)
 *   NY:        17:00 – 22:00  (distribution phase)
 *   Dead:      22:00 – 00:00  (low liquidity)
 *
 * Research refs:
 *   - stop-hunting-market-traps.md: AMD framework (Asian=Accumulation, London=Manipulation, NY=Distribution)
 *   - volume-analysis-deep.md: 13:00-17:00 UTC is the real institutional window
 *   - practical-algo-implementation.md: dead hours produce noisy signals
 */

export type SessionName = 'asian' | 'london' | 'ny_london_overlap' | 'ny' | 'dead';

export interface SessionInfo {
  name: SessionName;
  label: string;
  /** Confluence multiplier — applied to final score consideration */
  qualityMultiplier: number;
  /** Whether to allow new entries */
  allowEntry: boolean;
  /** Upcoming session transition info */
  nextSession: string;
  hoursUntilNext: number;
}

const SESSIONS: { name: SessionName; label: string; startHour: number; endHour: number; quality: number }[] = [
  { name: 'asian',              label: 'Азиатская',            startHour: 0,  endHour: 7,  quality: 0.85 },
  { name: 'london',             label: 'Лондон',               startHour: 7,  endHour: 13, quality: 1.0 },
  { name: 'ny_london_overlap',  label: 'NY+Лондон (overlap)',  startHour: 13, endHour: 17, quality: 1.1 },
  { name: 'ny',                 label: 'Нью-Йорк',            startHour: 17, endHour: 22, quality: 1.0 },
  { name: 'dead',               label: 'Мёртвая зона',        startHour: 22, endHour: 24, quality: 0.7 },
];

export function detectSession(now?: Date): SessionInfo {
  const d = now ?? new Date();
  const hour = d.getUTCHours();

  let current = SESSIONS.find((s) =>
    s.endHour === 24 ? hour >= s.startHour : (hour >= s.startHour && hour < s.endHour)
  );
  if (!current) current = SESSIONS[0]; // fallback to asian

  const idx = SESSIONS.indexOf(current);
  const next = SESSIONS[(idx + 1) % SESSIONS.length];
  const hoursUntilNext = next.startHour > hour
    ? next.startHour - hour
    : (24 - hour) + next.startHour;

  return {
    name: current.name,
    label: current.label,
    qualityMultiplier: current.quality,
    allowEntry: current.name !== 'dead',
    nextSession: next.label,
    hoursUntilNext,
  };
}

/**
 * Check if we're near a funding rate window (00:00, 08:00, 16:00 UTC).
 * Avoid entries ±10 minutes around these times (anomalous volume).
 */
export function isNearFundingWindow(now?: Date): boolean {
  const d = now ?? new Date();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const fundingHours = [0, 8, 16];
  return fundingHours.some((fh) => {
    if (h === fh && m <= 10) return true;
    if (h === ((fh - 1 + 24) % 24) && m >= 50) return true;
    return false;
  });
}
