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

  // C12: FAIL LOUD on Intl edge cases. Silent default of 0 was sending SMS at
  // midnight when the timezone string was unexpected.
  const hourStr = parts.find((p) => p.type === 'hour')?.value;
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hourRaw = hourStr === '24' ? '0' : hourStr; // Intl occasionally emits "24" at midnight
  const hour = parseInt(hourRaw ?? '', 10);

  if (Number.isNaN(hour) || !weekday) {
    throw new Error(
      `quiet-hours: Intl formatter produced invalid output for tz="${timezone}" ` +
      `(hour="${hourStr}", weekday="${weekday}"). ` +
      `Refusing to silently default — check the dealership timezone value.`
    );
  }

  return { hour, weekday };
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
  // H10: Use ISO formatter directly with tz, subtract one day in pure calendar
  // arithmetic. Works across DST transitions because we never touch UTC offsets.
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // "YYYY-MM-DD"

  const [yearStr, monthStr, dayStr] = todayStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    throw new Error(`getLocalYesterdayString: invalid date parts for tz="${timezone}" (got "${todayStr}")`);
  }

  // Use UTC date as a calendar calculator — setUTCDate handles month/year rollover.
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
