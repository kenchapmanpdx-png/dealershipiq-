// Phase 6: Challenge + Manager Quick-Create types

export interface ManagerScenario {
  id: string;
  dealershipId: string;
  createdBy: string;
  source: 'manager_sms' | 'manager_web' | 'imported';
  managerInputText: string;
  scenarioText: string;
  customerPersona: string | null;
  taxonomyDomain: string;
  difficulty: string;
  gradingRubric: GradingRubric;
  vehicleContext: Record<string, unknown> | null;
  awaitingNowConfirmation: boolean;
  nowConfirmationExpiresAt: string | null;
  pushImmediately: boolean;
  pushedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface GradingRubric {
  product_accuracy: string;
  tone_rapport: string;
  concern_addressed: string;
  close_attempt: string;
  urgency_creation?: string | null;
  competitive_positioning?: string | null;
}

export interface GeneratedScenario {
  scenario_text: string;
  customer_persona: string;
  taxonomy_domain: string;
  difficulty: 'easy' | 'medium' | 'hard';
  grading_rubric: GradingRubric;
}

export interface DailyChallenge {
  id: string;
  dealershipId: string;
  challengeDate: string;
  scenarioText: string;
  gradingRubric: GradingRubric;
  taxonomyDomain: string;
  personaMood: string | null;
  vehicleContext: Record<string, unknown> | null;
  results: ChallengeResult[] | null;
  winnerUserId: string | null;
  participationCount: number;
  status: 'active' | 'grading' | 'completed' | 'no_responses';
}

export interface ChallengeResult {
  user_id: string;
  first_name: string;
  score: number;
  rank: number;
}

export type ChallengeFrequency = 'daily' | 'mwf' | 'tue_thu';

export interface PeerChallenge {
  id: string;
  dealershipId: string;
  challengerId: string;
  challengedId: string | null;
  scenarioText: string | null;
  gradingRubric: GradingRubric | null;
  taxonomyDomain: string | null;
  challengerSessionId: string | null;
  challengedSessionId: string | null;
  challengerScore: number | null;
  challengedScore: number | null;
  winnerId: string | null;
  disambiguationOptions: DisambiguationOption[] | null;
  status: 'disambiguating' | 'pending' | 'active' | 'completed' | 'expired' | 'declined';
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
}

export interface DisambiguationOption {
  option: number;
  user_id: string;
  display: string;
}
