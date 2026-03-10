// Quiet hours enforcement
// Mon-Sat: 10 AM – 7 PM local time
// Sunday: 11 AM – 7 PM local time
// Proactive SMS (training, push, digest, alerts) blocked outside windows.
// Exempt: Ask IQ responses (reactive), grading feedback (employee-initiated).

interface TimeInfo {
  hour: number;
  weekday: string; // 'Mon','Tue','Wed','Thu','Fri','Sat','Sun'
}

function getLocalTime(timezone: string): TimeInfo {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  return {
    hour: parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0'),
    weekday: parts.find((p) => p.type === 'weekday')?.value ?? '',
  };
}

/** True if current local time is within proactive send window. */
export function isWithinSendWindow(timezone: string): boolean {
  const { hour, weekday } = getLocalTime(timezone);
  const isSunday = weekday === 'Sun';

  if (isSunday) {
    return hour >= 11 && hour < 19;
  }
  // Mon-Sat: 10 AM – 7 PM
  return hour >= 10 && hour < 19;
}

/** Backward-compat alias. Proactive sends only. */
export function isWithinQuietHours(timezone: string): boolean {
  return isWithinSendWindow(timezone);
}

/** True if today is Mon-Fri in the dealership's timezone. */
export function isWeekday(timezone: string): boolean {
  const { weekday } = getLocalTime(timezone);
  return !['Sat', 'Sun'].includes(weekday);
}

/** Returns the day-of-week index (0=Sun..6=Sat) in the dealership's timezone. */
export function getLocalDayOfWeek(timezone: string): number {
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const { weekday } = getLocalTime(timezone);
  return dayMap[weekday] ?? 0;
}

/** Returns the current local hour in the dealership's timezone. */
export function getLocalHour(timezone: string): number {
  return getLocalTime(timezone).hour;
}

/**
 * Get the dealership's configured training send hour.
 * Falls back to 10 if not set. Clamped to 9-12.
 */
export function getTrainingSendHour(settings: Record<string, unknown> | null): number {
  const raw = Number(settings?.training_send_hour ?? 10);
  return Math.max(9, Math.min(12, Math.round(raw)));
}

export function nextSendWindow(timezone: string): Date {
  const now = new Date();
  const { hour, weekday } = getLocalTime(timezone);

  const isSunday = weekday === 'Sun';
  const isSaturday = weekday === 'Sat';
  const openHour = isSunday ? 11 : 10;

  if (hour < openHour) {
    const next = new Date(now);
    next.setHours(next.getHours() + (openHour - hour));
    return next;
  }

  if (hour >= 19) {
    const next = new Date(now);
    // Saturday evening → Monday 10 AM (skip Sunday training, but Sunday has its own window)
    // Actually for proactive training (weekday-only), Saturday evening → Monday 10 AM
    const nextDayOpenHour = isSaturday ? 11 : 10; // Sat→Sun=11, otherwise 10
    next.setHours(next.getHours() + (24 - hour + nextDayOpenHour));
    return next;
  }

  return now;
}
