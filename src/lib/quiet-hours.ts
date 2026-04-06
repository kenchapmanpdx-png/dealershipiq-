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

/** C-004: Returns the local date string (YYYY-MM-DD) in the dealership's timezone. */
export function getLocalDateString(timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date());
}

/** C-004: Returns yesterday's local date string (YYYY-MM-DD) in the dealership's timezone.
 *  M6-FIX: Subtract 1 from local date instead of subtracting 24h from UTC
 *  (avoids DST off-by-one near midnight on spring-forward days). */
export function getLocalYesterdayString(timezone: string): string {
  // Get today's local date parts
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parseInt(parts.find((p) => p.type === 'year')?.value ?? '0');
  const month = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1');
  const day = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1');

  // Construct a date in UTC using local parts, then subtract 1 day
  const localToday = new Date(Date.UTC(year, month - 1, day));
  localToday.setUTCDate(localToday.getUTCDate() - 1);
  return localToday.toISOString().slice(0, 10);
}

/** C-004: Returns true if today is Monday in the dealership's timezone. */
export function isLocalMonday(timezone: string): boolean {
  const { weekday } = getLocalTime(timezone);
  return weekday === 'Mon';
}

/**
 * Get the dealership's configured training send hour.
 * Falls back to 10 if not set. Clamped to 9-12.
 */
export function getTrainingSendHour(settings: Record<string, unknown> | null): number {
  const raw = Number(settings?.training_send_hour ?? 10);
  return Math.max(9, Math.min(12, Math.round(raw)));
}

/**
 * H-008 fix: nextSendWindow uses hour deltas (UTC-safe) instead of setHours on UTC date.
 * Returns approximate next send window as a Date object.
 */
export function nextSendWindow(timezone: string): Date {
  const now = new Date();
  const { hour, weekday } = getLocalTime(timezone);

  const isSunday = weekday === 'Sun';
  const isSaturday = weekday === 'Sat';
  const openHour = isSunday ? 11 : 10;

  if (hour < openHour) {
    // Before send window opens — advance by the difference in hours
    return new Date(now.getTime() + (openHour - hour) * 60 * 60 * 1000);
  }

  if (hour >= 19) {
    // After send window closes — advance to next day's open hour
    const hoursUntilMidnight = 24 - hour;
    const nextDayOpenHour = isSaturday ? 11 : 10; // Sat→Sun=11, otherwise 10
    return new Date(now.getTime() + (hoursUntilMidnight + nextDayOpenHour) * 60 * 60 * 1000);
  }

  // Within send window
  return now;
}
