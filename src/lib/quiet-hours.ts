// Quiet hours enforcement
// Build Master: Phase 2E
// Window: 9 AM–8 PM Mon-Sat, 12 PM–8 PM Sun (dealership timezone)

export function isWithinQuietHours(timezone: string): boolean {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';

  const isSunday = weekday === 'Sun';

  if (isSunday) {
    // Sunday: 12 PM – 8 PM
    return hour >= 12 && hour < 20;
  }

  // Mon-Sat: 9 AM – 8 PM
  return hour >= 9 && hour < 20;
}

export function nextSendWindow(timezone: string): Date {
  // Returns the next valid send time if currently outside quiet hours
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';

  const isSunday = weekday === 'Sun';
  const isSaturday = weekday === 'Sat';
  const openHour = isSunday ? 12 : 9;

  if (hour < openHour) {
    // Before window opens today — return today at open hour
    const next = new Date(now);
    next.setHours(next.getHours() + (openHour - hour));
    return next;
  }

  if (hour >= 20) {
    // After window closes — return next day at open hour
    const next = new Date(now);
    const nextDayOpenHour = isSaturday ? 12 : 9; // Saturday evening → Sunday 12PM
    next.setHours(next.getHours() + (24 - hour + nextDayOpenHour));
    return next;
  }

  // Currently within window
  return now;
}
