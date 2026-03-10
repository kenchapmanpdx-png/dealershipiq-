// Schedule Awareness System
// Parse SMS keywords for schedule management and check employee availability.

import {
  getEmployeeSchedule,
  upsertEmployeeSchedule,
} from '@/lib/service-db';

export type ScheduleStatus = 'working' | 'day_off' | 'vacation' | 'gone_dark';

export interface EmployeeSchedule {
  daysOff: string[]; // 'MON', 'TUE', etc. or ISO date 'YYYY-MM-DD'
  vacationStart: string | null; // ISO date
  vacationEnd: string | null; // ISO date
  lastUpdated: string; // ISO timestamp
}

export interface ParseResult {
  success: boolean;
  error?: string;
  data?: Partial<EmployeeSchedule>;
  message?: string; // User-facing response
}

// Parse SMS keywords for schedule updates
// Supported formats:
// - "OFF MON TUE" → adds Monday and Tuesday to days off
// - "OFF TODAY" → adds today to days off
// - "VACATION BACK 3/15" → sets vacation until March 15
export function parseScheduleKeyword(text: string): ParseResult {
  const upper = text.toUpperCase().trim();

  // OFF keywords
  if (upper.startsWith('OFF ')) {
    const rest = upper.substring(4).trim();

    // Handle "OFF TODAY"
    if (rest === 'TODAY') {
      const today = new Date().toISOString().split('T')[0];
      return {
        success: true,
        data: { daysOff: [today] },
        message: 'Marked today as day off.',
      };
    }

    // Handle "OFF MON TUE WED" etc.
    const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const parts = rest.split(/\s+/);
    const validDays = parts.filter((p) => dayNames.includes(p));

    if (validDays.length > 0) {
      return {
        success: true,
        data: { daysOff: validDays },
        message: `Added ${validDays.join(', ')} to days off.`,
      };
    }

    return {
      success: false,
      error: 'Unrecognized OFF format. Use "OFF MON TUE" or "OFF TODAY".',
    };
  }

  // VACATION keywords
  if (upper.startsWith('VACATION')) {
    const rest = upper.substring(8).trim();

    // Handle "VACATION BACK M/D" or "VACATION BACK M/D/YY"
    const backMatch = rest.match(/BACK\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (backMatch) {
      const month = parseInt(backMatch[1], 10);
      const day = parseInt(backMatch[2], 10);
      let year = parseInt(backMatch[3] ?? '', 10);

      // Default to current year if not specified
      if (!backMatch[3]) {
        year = new Date().getFullYear();
      } else if (year < 100) {
        // 2-digit year: 00-99 → 2000-2099
        year += 2000;
      }

      // Validate month/day
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        return {
          success: false,
          error: 'Invalid date. Use format "VACATION BACK M/D" (e.g., "VACATION BACK 3/15").',
        };
      }

      const vacationEnd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      return {
        success: true,
        data: {
          vacationStart: new Date().toISOString().split('T')[0],
          vacationEnd,
        },
        message: `Vacation set until ${vacationEnd}.`,
      };
    }

    return {
      success: false,
      error: 'Unrecognized VACATION format. Use "VACATION BACK M/D" (e.g., "VACATION BACK 3/15").',
    };
  }

  return {
    success: false,
    error: 'No recognized schedule keyword (OFF, VACATION).',
  };
}

// Check if employee is scheduled off on a given date
export async function isScheduledOff(
  userId: string,
  dealershipId: string,
  date: Date
): Promise<boolean> {
  const schedule = await getEmployeeSchedule(userId, dealershipId);
  if (!schedule) return false;

  const dateStr = date.toISOString().split('T')[0];
  const dayOfWeek = date.toLocaleString('en-US', { weekday: 'short' }).toUpperCase();

  // Check specific date off
  if (schedule.daysOff?.includes(dateStr)) {
    return true;
  }

  // Check day-of-week off
  if (schedule.daysOff?.includes(dayOfWeek)) {
    return true;
  }

  // Check vacation period
  if (schedule.vacationStart && schedule.vacationEnd) {
    const start = new Date(schedule.vacationStart);
    const end = new Date(schedule.vacationEnd);
    if (date >= start && date <= end) {
      return true;
    }
  }

  return false;
}

// Get schedule status for an employee
export async function getScheduleStatus(
  userId: string,
  dealershipId: string
): Promise<ScheduleStatus> {
  const now = new Date();
  const schedule = await getEmployeeSchedule(userId, dealershipId);

  if (!schedule) {
    return 'working';
  }

  // Check vacation
  if (schedule.vacationStart && schedule.vacationEnd) {
    const start = new Date(schedule.vacationStart);
    const end = new Date(schedule.vacationEnd);
    if (now >= start && now <= end) {
      return 'vacation';
    }
  }

  // Check day off
  const isOff = await isScheduledOff(userId, dealershipId, now);
  if (isOff) {
    return 'day_off';
  }

  return 'working';
}

// Update employee schedule from parsed data
export async function updateEmployeeSchedule(
  userId: string,
  dealershipId: string,
  updates: Partial<EmployeeSchedule>
): Promise<EmployeeSchedule> {
  const current = await getEmployeeSchedule(userId, dealershipId);
  const merged: EmployeeSchedule = {
    daysOff: updates.daysOff ?? current?.daysOff ?? [],
    vacationStart: updates.vacationStart ?? current?.vacationStart ?? null,
    vacationEnd: updates.vacationEnd ?? current?.vacationEnd ?? null,
    lastUpdated: new Date().toISOString(),
  };

  await upsertEmployeeSchedule(userId, dealershipId, merged);
  return merged;
}
