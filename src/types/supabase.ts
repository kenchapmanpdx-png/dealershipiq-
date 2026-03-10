export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      askiq_queries: {
        Row: {
          confidence: number | null
          created_at: string
          dealership_id: string
          id: string
          query_context: Json
          query_text: string
          response: string | null
          session_id: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          dealership_id: string
          id?: string
          query_context?: Json
          query_text: string
          response?: string | null
          session_id?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          dealership_id?: string
          id?: string
          query_context?: Json
          query_text?: string
          response?: string | null
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "askiq_queries_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "askiq_queries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conversation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "askiq_queries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          added_by: string | null
          consent_date: string
          consent_type: string
          consenting_party: string | null
          created_at: string
          dealership_id: string
          id: string
          ip_address: string | null
          method: string
          phone: string
          reply_text: string | null
          retention_expires_at: string
          text_shown: string | null
        }
        Insert: {
          added_by?: string | null
          consent_date?: string
          consent_type: string
          consenting_party?: string | null
          created_at?: string
          dealership_id: string
          id?: string
          ip_address?: string | null
          method: string
          phone: string
          reply_text?: string | null
          retention_expires_at?: string
          text_shown?: string | null
        }
        Update: {
          added_by?: string | null
          consent_date?: string
          consent_type?: string
          consenting_party?: string | null
          created_at?: string
          dealership_id?: string
          id?: string
          ip_address?: string | null
          method?: string
          phone?: string
          reply_text?: string | null
          retention_expires_at?: string
          text_shown?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          dealership_id: string
          id: string
          last_message_at: string | null
          mode: string
          started_at: string
          status: string
          step_index: number
          user_id: string
          version: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          dealership_id: string
          id?: string
          last_message_at?: string | null
          mode: string
          started_at?: string
          status?: string
          step_index?: number
          user_id: string
          version?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          dealership_id?: string
          id?: string
          last_message_at?: string | null
          mode?: string
          started_at?: string
          status?: string
          step_index?: number
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_sessions_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dealership_memberships: {
        Row: {
          created_at: string
          dealership_id: string
          id: string
          is_primary: boolean
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dealership_id: string
          id?: string
          is_primary?: boolean
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          dealership_id?: string
          id?: string
          is_primary?: boolean
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealership_memberships_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealership_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dealerships: {
        Row: {
          created_at: string
          feature_flags: Json
          id: string
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          feature_flags?: Json
          id?: string
          name: string
          settings?: Json
          slug: string
          timezone: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          feature_flags?: Json
          id?: string
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_priority_vectors: {
        Row: {
          dealership_id: string
          last_updated_at: string
          user_id: string
          weights: Json
        }
        Insert: {
          dealership_id: string
          last_updated_at?: string
          user_id: string
          weights?: Json
        }
        Update: {
          dealership_id?: string
          last_updated_at?: string
          user_id?: string
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "employee_priority_vectors_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_priority_vectors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_schedules: {
        Row: {
          dealership_id: string
          last_confirmed_at: string | null
          one_off_absences: string[] | null
          recurring_days_off: number[] | null
          updated_at: string
          user_id: string
          vacation_end: string | null
          vacation_start: string | null
        }
        Insert: {
          dealership_id: string
          last_confirmed_at?: string | null
          one_off_absences?: string[] | null
          recurring_days_off?: number[] | null
          updated_at?: string
          user_id: string
          vacation_end?: string | null
          vacation_start?: string | null
        }
        Update: {
          dealership_id?: string
          last_confirmed_at?: string | null
          one_off_absences?: string[] | null
          recurring_days_off?: number[] | null
          updated_at?: string
          user_id?: string
          vacation_end?: string | null
          vacation_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_schedules_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_schedules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          config: Json
          created_at: string
          dealership_id: string
          enabled: boolean
          flag_name: string
          id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          dealership_id: string
          enabled?: boolean
          flag_name: string
          id?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          dealership_id?: string
          enabled?: boolean
          flag_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_gaps: {
        Row: {
          created_at: string
          dealership_id: string
          id: string
          resolved: boolean
          severity: string
          source: string
          source_query_id: string | null
          topic: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dealership_id: string
          id?: string
          resolved?: boolean
          severity?: string
          source: string
          source_query_id?: string | null
          topic: string
          user_id: string
        }
        Update: {
          created_at?: string
          dealership_id?: string
          id?: string
          resolved?: boolean
          severity?: string
          source?: string
          source_query_id?: string | null
          topic?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_gaps_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_gaps_source_query_id_fkey"
            columns: ["source_query_id"]
            isOneToOne: false
            referencedRelation: "askiq_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_gaps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_entries: {
        Row: {
          average_score: number
          created_at: string
          dealership_id: string
          id: string
          period_end: string
          period_start: string
          rank: number | null
          sessions_completed: number
          total_points: number
          updated_at: string
          user_id: string
        }
        Insert: {
          average_score?: number
          created_at?: string
          dealership_id: string
          id?: string
          period_end: string
          period_start: string
          rank?: number | null
          sessions_completed?: number
          total_points?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          average_score?: number
          created_at?: string
          dealership_id?: string
          id?: string
          period_end?: string
          period_start?: string
          rank?: number | null
          sessions_completed?: number
          total_points?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_entries_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean
          model: string
          name: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          model: string
          name: string
          version: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          model?: string
          name?: string
          version?: number
        }
        Relationships: []
      }
      sms_delivery_log: {
        Row: {
          batch_id: string | null
          cost: number | null
          created_at: string
          dealership_id: string
          error_code: string | null
          id: string
          recipient_phone: string
          sinch_message_id: string | null
          status: string
        }
        Insert: {
          batch_id?: string | null
          cost?: number | null
          created_at?: string
          dealership_id: string
          error_code?: string | null
          id?: string
          recipient_phone: string
          sinch_message_id?: string | null
          status?: string
        }
        Update: {
          batch_id?: string | null
          cost?: number | null
          created_at?: string
          dealership_id?: string
          error_code?: string | null
          id?: string
          recipient_phone?: string
          sinch_message_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_delivery_log_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_opt_outs: {
        Row: {
          created_at: string
          dealership_id: string
          id: string
          keyword_used: string | null
          last_synced_at: string | null
          opted_out_at: string
          phone: string
          synced_from_sinch: boolean
        }
        Insert: {
          created_at?: string
          dealership_id: string
          id?: string
          keyword_used?: string | null
          last_synced_at?: string | null
          opted_out_at?: string
          phone: string
          synced_from_sinch?: boolean
        }
        Update: {
          created_at?: string
          dealership_id?: string
          id?: string
          keyword_used?: string | null
          last_synced_at?: string | null
          opted_out_at?: string
          phone?: string
          synced_from_sinch?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sms_opt_outs_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_transcript_log: {
        Row: {
          created_at: string
          dealership_id: string
          direction: string
          id: string
          message_body: string
          phone: string
          session_id: string | null
          sinch_message_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          dealership_id: string
          direction: string
          id?: string
          message_body: string
          phone: string
          session_id?: string | null
          sinch_message_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          dealership_id?: string
          direction?: string
          id?: string
          message_body?: string
          phone?: string
          session_id?: string | null
          sinch_message_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_transcript_log_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_transcript_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conversation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_transcript_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      system_messages: {
        Row: {
          category: string
          created_at: string
          en_text: string
          es_text: string
          id: string
          key: string
          max_segments: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          en_text: string
          es_text: string
          id?: string
          key: string
          max_segments?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          en_text?: string
          es_text?: string
          id?: string
          key?: string
          max_segments?: number
          updated_at?: string
        }
        Relationships: []
      }
      training_results: {
        Row: {
          addressed_concern: number
          close_attempt: number
          created_at: string
          dealership_id: string
          feedback: string
          id: string
          mode: string
          product_accuracy: number
          prompt_version_id: string | null
          reasoning: string | null
          session_id: string | null
          tone_rapport: number
          user_id: string
        }
        Insert: {
          addressed_concern: number
          close_attempt: number
          created_at?: string
          dealership_id: string
          feedback: string
          id?: string
          mode: string
          product_accuracy: number
          prompt_version_id?: string | null
          reasoning?: string | null
          session_id?: string | null
          tone_rapport: number
          user_id: string
        }
        Update: {
          addressed_concern?: number
          close_attempt?: number
          created_at?: string
          dealership_id?: string
          feedback?: string
          id?: string
          mode?: string
          product_accuracy?: number
          prompt_version_id?: string | null
          reasoning?: string | null
          session_id?: string | null
          tone_rapport?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_results_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_results_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_results_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conversation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_tracking: {
        Row: {
          ai_tokens_in: number
          ai_tokens_out: number
          created_at: string
          dealership_id: string
          estimated_cost: number
          id: string
          month: string
          sms_count: number
          updated_at: string
        }
        Insert: {
          ai_tokens_in?: number
          ai_tokens_out?: number
          created_at?: string
          dealership_id: string
          estimated_cost?: number
          id?: string
          month: string
          sms_count?: number
          updated_at?: string
        }
        Update: {
          ai_tokens_in?: number
          ai_tokens_out?: number
          created_at?: string
          dealership_id?: string
          estimated_cost?: number
          id?: string
          month?: string
          sms_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_tracking_dealership_id_fkey"
            columns: ["dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_id: string | null
          created_at: string
          full_name: string
          id: string
          language: string
          last_active_dealership_id: string | null
          phone: string
          status: string
          updated_at: string
        }
        Insert: {
          auth_id?: string | null
          created_at?: string
          full_name: string
          id?: string
          language?: string
          last_active_dealership_id?: string | null
          phone: string
          status?: string
          updated_at?: string
        }
        Update: {
          auth_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          language?: string
          last_active_dealership_id?: string | null
          phone?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_last_active_dealership_id_fkey"
            columns: ["last_active_dealership_id"]
            isOneToOne: false
            referencedRelation: "dealerships"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      get_dealership_id: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      is_manager: { Args: never; Returns: boolean }
      switch_active_dealership: {
        Args: { target_dealership_id: string }
        Returns: undefined
      }
      try_lock_user: { Args: { user_phone: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
