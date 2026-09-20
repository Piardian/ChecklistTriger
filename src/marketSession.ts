export type MarketSession = 'asian' | 'london' | 'overlap' | 'new_york' | 'off_session';

export interface MarketSessionContext {
  readonly session: MarketSession;
  readonly dayOfWeek: number;
  readonly dayOfWeekName: string;
  readonly hourLocal: number;
  readonly timezone: string;
}

export const DEFAULT_MARKET_TIMEZONE = 'Europe/Istanbul' as const;

export function resolveMarketSession(timestamp: number, timezone: string = DEFAULT_MARKET_TIMEZONE): MarketSessionContext {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(timestamp));

  const weekday = parts.find(part => part.type === 'weekday')?.value ?? 'Sun';
  let hourLocal = Number(parts.find(part => part.type === 'hour')?.value ?? 0);
  if (hourLocal === 24) hourLocal = 0;

  return {
    session: resolveSession(hourLocal),
    dayOfWeek: weekdayToNumber(weekday),
    dayOfWeekName: weekday,
    hourLocal,
    timezone,
  };
}

export function resolveSession(hourLocal: number): MarketSession {
  if (hourLocal >= 10 && hourLocal < 13) return 'london';
  if (hourLocal >= 13 && hourLocal < 15) return 'overlap';
  if (hourLocal >= 15 && hourLocal < 19) return 'new_york';
  if (hourLocal >= 3 && hourLocal < 10) return 'asian';
  return 'off_session';
}

function weekdayToNumber(weekday: string): number {
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  return map[weekday] ?? 0;
}
