// Phase 4.5B: Morning Meeting Script types

export interface MeetingScriptShoutout {
  name: string;
  domain: string;
  score: number;
}

export interface MeetingScriptGap {
  topic: string;
  count: number;
  answer: string | null;
}

export interface MeetingScriptCoachingFocus {
  domain: string;
  prompt: string;
}

export interface MeetingScriptAtRisk {
  name: string;
  signal: string;
}

export interface MeetingScriptNumbers {
  completion_rate: number;
  prior_week_rate: number;
  delta: number;
}

export interface MeetingScriptBenchmark {
  rank: number;
  total: number;
  brand: string;
}

export interface MeetingScriptFullScript {
  shoutout: MeetingScriptShoutout | null;
  gap: MeetingScriptGap | null;
  coaching_focus: MeetingScriptCoachingFocus | null;
  at_risk: MeetingScriptAtRisk[];
  numbers: MeetingScriptNumbers;
  benchmark: MeetingScriptBenchmark | null;
}

export interface MeetingScriptData {
  dealershipName: string;
  shoutout: MeetingScriptShoutout | null;
  gap: MeetingScriptGap | null;
  coachingFocus: MeetingScriptCoachingFocus | null;
  atRisk: MeetingScriptAtRisk[];
  numbers: MeetingScriptNumbers;
  benchmark: MeetingScriptBenchmark | null;
}

export interface MeetingScriptResponse {
  data: MeetingScriptFullScript | null;
  is_yesterday: boolean;
  script_date: string;
}
