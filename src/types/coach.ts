// Coach Mode types — Phase 4.5A

export type CoachDoor = 'tactical' | 'debrief' | 'career';

export type SessionTopic =
  | 'tactical'
  | 'debrief'
  | 'career'
  | 'emotional'
  | 'compensation'
  | 'conflict';

export type SentimentTrend = 'positive' | 'neutral' | 'negative' | 'declining';

export type CoachingStyle =
  | 'encourager'
  | 'tactician'
  | 'relationship_builder'
  | 'process_coach';

export interface CoachMessage {
  role: 'assistant' | 'user';
  content: string;
  timestamp: string;
}

export interface CoachSession {
  id: string;
  user_id: string;
  dealership_id: string;
  messages: CoachMessage[];
  session_topic: SessionTopic | null;
  sentiment_trend: SentimentTrend;
  coaching_style: CoachingStyle | null;
  door_selected: CoachDoor | null;
  rep_context_snapshot: RepContextSnapshot;
  created_at: string;
  ended_at: string | null;
}

export interface RepContextSnapshot {
  first_name: string;
  dealership_name: string;
  tenure_days: number;
  hire_date: string | null;
  training_scores: Record<
    string,
    { avg_score: number; trend: 'improving' | 'stable' | 'declining'; session_count: number }
  >;
  overall_stats: {
    total_sessions: number;
    current_streak: number;
    best_streak: number;
    completion_rate_30d: number;
  };
  priority_vector: Record<string, number> | null;
  recent_gaps: string[];
  previous_coach_sessions: {
    session_topic: string;
    sentiment_trend: string;
    created_at: string;
  }[];
}

export interface CoachSessionRequest {
  session_id?: string;
  door?: CoachDoor;
  message?: string;
}

export interface CoachSessionResponse {
  data: {
    session_id: string;
    messages: CoachMessage[];
    session_topic: string | null;
    session_closed?: boolean;
  };
  error: string | null;
}

export interface CoachThemesResponse {
  data: {
    period: string;
    total_sessions: number;
    unique_users: number;
    themes: { topic: string; count: number; percentage: number }[];
    sentiment_distribution: {
      positive: number;
      neutral: number;
      negative: number;
      declining: number;
    };
    insufficient_data?: boolean;
    message?: string;
  };
  error: string | null;
}

export interface ExchangeClassification {
  sentiment: SentimentTrend;
  topic: SessionTopic;
}
