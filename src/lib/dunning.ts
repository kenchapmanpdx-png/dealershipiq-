export interface DunningStage {
  stage: number;
  name: string;
  daysOverdue: number;
  description: string;
  action: string;
}

const DUNNING_STAGES: Record<number, Omit<DunningStage, 'daysOverdue'>> = {
  1: {
    stage: 1,
    name: 'Initial Past Due',
    description: 'Payment failed on first attempt',
    action: 'None (Stripe Smart Retry in progress)',
  },
  2: {
    stage: 2,
    name: 'Day 3 Reminder',
    description: '3 days past due; second payment attempt',
    action: 'Send reminder notification',
  },
  3: {
    stage: 3,
    name: 'Day 7 In-App Banner',
    description: '7 days past due',
    action: 'Show in-app dunning banner',
  },
  4: {
    stage: 4,
    name: 'Day 14 Feature Restriction',
    description: '14 days past due',
    action: 'Restrict non-critical features',
  },
  5: {
    stage: 5,
    name: 'Day 21 Suspension',
    description: '21 days past due',
    action: 'Full platform suspension',
  },
  6: {
    stage: 6,
    name: 'Day 30 Cancellation',
    description: '30 days past due; cancel subscription',
    action: 'Cancel subscription, retain data for 90 days',
  },
};

export function getDunningStage(pastDueSince: Date): DunningStage {
  const now = new Date();
  const daysOverdue = Math.floor((now.getTime() - pastDueSince.getTime()) / (1000 * 60 * 60 * 24));

  let stage = 1;
  if (daysOverdue >= 3) stage = 2;
  if (daysOverdue >= 7) stage = 3;
  if (daysOverdue >= 14) stage = 4;
  if (daysOverdue >= 21) stage = 5;
  if (daysOverdue >= 30) stage = 6;

  const stageInfo = DUNNING_STAGES[stage];
  return {
    ...stageInfo,
    daysOverdue,
  };
}

export function shouldRestrictFeatures(stage: number): boolean {
  return stage >= 4; // Day 14+
}

export function shouldSuspend(stage: number): boolean {
  return stage >= 5; // Day 21+
}

export function shouldCancel(stage: number): boolean {
  return stage >= 6; // Day 30+
}

export function getDunningStageInfo(stage: number): (typeof DUNNING_STAGES)[1] | null {
  return DUNNING_STAGES[stage] ?? null;
}
