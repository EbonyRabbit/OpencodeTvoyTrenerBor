export type ClientStatus = "active" | "inactive" | "access_expired";
export type PaymentStatus = "pending" | "paid";
export type PhotoType = "front" | "side" | "back";
export type MessageDirection = "to_client" | "to_coach";
export type NotificationType =
  | "morning"
  | "evening"
  | "measurement"
  | "checkin"
  | "alert"
  | "payment";
export type PauseReason = "sick" | "vacation" | "injury" | "personal" | "other";
export type ResumeStrategy = "skip" | "shift" | "deload" | "rollback";
export type PauseStatus = "active" | "resuming" | "completed";
export type ProgramType = "template" | "personal";

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
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      bot_dedup: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      bot_logs: {
        Row: {
          action: string
          client_id: string | null
          created_at: string
          details: string | null
          id: string
          status: string | null
          telegram_id: number | null
        }
        Insert: {
          action: string
          client_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          status?: string | null
          telegram_id?: number | null
        }
        Update: {
          action?: string
          client_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          status?: string | null
          telegram_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_schedule: {
        Row: {
          client_id: string | null
          created_at: string
          data: Json | null
          id: string
          scheduled: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          scheduled: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          scheduled?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_schedule_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_state: {
        Row: {
          action: string | null
          client_id: string | null
          created_at: string
          data: Json | null
          step: string | null
          telegram_id: number
          updated_at: string
        }
        Insert: {
          action?: string | null
          client_id?: string | null
          created_at?: string
          data?: Json | null
          step?: string | null
          telegram_id: number
          updated_at?: string
        }
        Update: {
          action?: string | null
          client_id?: string | null
          created_at?: string
          data?: Json | null
          step?: string | null
          telegram_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      checkins: {
        Row: {
          client_id: string
          comment: string | null
          complaints: string | null
          created_at: string
          date: string
          id: string
          missed_workouts: number | null
          nutrition_adherence: number | null
          sleep: number | null
          stress: number | null
          updated_at: string
          week: number | null
          wellbeing: number | null
        }
        Insert: {
          client_id: string
          comment?: string | null
          complaints?: string | null
          created_at?: string
          date: string
          id?: string
          missed_workouts?: number | null
          nutrition_adherence?: number | null
          sleep?: number | null
          stress?: number | null
          updated_at?: string
          week?: number | null
          wellbeing?: number | null
        }
        Update: {
          client_id?: string
          comment?: string | null
          complaints?: string | null
          created_at?: string
          date?: string
          id?: string
          missed_workouts?: number | null
          nutrition_adherence?: number | null
          sleep?: number | null
          stress?: number | null
          updated_at?: string
          week?: number | null
          wellbeing?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "checkins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tokens: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          access_end_date: string | null
          access_start_date: string | null
          client_consent_given: boolean
          client_consent_given_at: string | null
          client_consent_ip: string | null
          client_consent_user_agent: string | null
          client_consent_version: string | null
          connect_code: string | null
          consent_given: boolean
          consent_given_at: string | null
          created_at: string
          id: string
          language: string
          legacy_id: string | null
          measurement_day: number | null
          measurement_time: string | null
          morning_time: string | null
          name: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          program_id: string | null
          purchase_date: string | null
          purchased_program_id: string | null
          spreadsheet_id: string | null
          status: Database["public"]["Enums"]["client_status"]
          telegram_id: number | null
          timezone: string | null
          training_days: number[] | null
          updated_at: string
        }
        Insert: {
          access_end_date?: string | null
          access_start_date?: string | null
          client_consent_given?: boolean
          client_consent_given_at?: string | null
          client_consent_ip?: string | null
          client_consent_user_agent?: string | null
          client_consent_version?: string | null
          connect_code?: string | null
          consent_given?: boolean
          consent_given_at?: string | null
          created_at?: string
          id?: string
          language?: string
          legacy_id?: string | null
          measurement_day?: number | null
          measurement_time?: string | null
          morning_time?: string | null
          name: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          program_id?: string | null
          purchase_date?: string | null
          purchased_program_id?: string | null
          spreadsheet_id?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          telegram_id?: number | null
          timezone?: string | null
          training_days?: number[] | null
          updated_at?: string
        }
        Update: {
          access_end_date?: string | null
          access_start_date?: string | null
          client_consent_given?: boolean
          client_consent_given_at?: string | null
          client_consent_ip?: string | null
          client_consent_user_agent?: string | null
          client_consent_version?: string | null
          connect_code?: string | null
          consent_given?: boolean
          consent_given_at?: string | null
          created_at?: string
          id?: string
          language?: string
          legacy_id?: string | null
          measurement_day?: number | null
          measurement_time?: string | null
          morning_time?: string | null
          name?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          program_id?: string | null
          purchase_date?: string | null
          purchased_program_id?: string | null
          spreadsheet_id?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          telegram_id?: number | null
          timezone?: string | null
          training_days?: number[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_purchased_program_id_fkey"
            columns: ["purchased_program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          contraindications: string | null
          created_at: string
          demo_video_url: string | null
          difficulty: string | null
          equipment: string | null
          id: string
          muscle_group: string | null
          name: string
          updated_at: string
        }
        Insert: {
          contraindications?: string | null
          created_at?: string
          demo_video_url?: string | null
          difficulty?: string | null
          equipment?: string | null
          id?: string
          muscle_group?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          contraindications?: string | null
          created_at?: string
          demo_video_url?: string | null
          difficulty?: string | null
          equipment?: string | null
          id?: string
          muscle_group?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      measurements: {
        Row: {
          abdomen: number | null
          body_fat: number | null
          chest: number | null
          client_id: string
          comment: string | null
          created_at: string
          date: string
          glutes: number | null
          hips: number | null
          id: string
          left_arm: number | null
          left_thigh: number | null
          muscle_mass: number | null
          right_arm: number | null
          right_thigh: number | null
          updated_at: string
          visceral_fat: number | null
          waist: number | null
          weight: number | null
        }
        Insert: {
          abdomen?: number | null
          body_fat?: number | null
          chest?: number | null
          client_id: string
          comment?: string | null
          created_at?: string
          date: string
          glutes?: number | null
          hips?: number | null
          id?: string
          left_arm?: number | null
          left_thigh?: number | null
          muscle_mass?: number | null
          right_arm?: number | null
          right_thigh?: number | null
          updated_at?: string
          visceral_fat?: number | null
          waist?: number | null
          weight?: number | null
        }
        Update: {
          abdomen?: number | null
          body_fat?: number | null
          chest?: number | null
          client_id?: string
          comment?: string | null
          created_at?: string
          date?: string
          glutes?: number | null
          hips?: number | null
          id?: string
          left_arm?: number | null
          left_thigh?: number | null
          muscle_mass?: number | null
          right_arm?: number | null
          right_thigh?: number | null
          updated_at?: string
          visceral_fat?: number | null
          waist?: number | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          client_id: string
          coach_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          read_at: string | null
          sent_at: string
          text: string
          updated_at: string
        }
        Insert: {
          client_id: string
          coach_id?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          read_at?: string | null
          sent_at?: string
          text: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          coach_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          read_at?: string | null
          sent_at?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          client_id: string
          created_at: string
          id: string
          metadata: Json | null
          sent_at: string
          status: string
          type: Database["public"]["Enums"]["notification_type"]
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          sent_at?: string
          status?: string
          type: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          sent_at?: string
          status?: string
          type?: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          client_id: string
          created_at: string
          date: string
          drive_url: string | null
          folder_url: string | null
          id: string
          storage_path: string | null
          type: Database["public"]["Enums"]["photo_type"]
          updated_at: string
          week: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          date: string
          drive_url?: string | null
          folder_url?: string | null
          id?: string
          storage_path?: string | null
          type: Database["public"]["Enums"]["photo_type"]
          updated_at?: string
          week?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          date?: string
          drive_url?: string | null
          folder_url?: string | null
          id?: string
          storage_path?: string | null
          type?: Database["public"]["Enums"]["photo_type"]
          updated_at?: string
          week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_pauses: {
        Row: {
          client_id: string
          created_at: string
          id: string
          pause_end: string | null
          pause_start: string
          planned_resume_date: string | null
          reason: PauseReason
          status: PauseStatus
          strategy: ResumeStrategy | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          pause_end?: string | null
          pause_start: string
          planned_resume_date?: string | null
          reason?: PauseReason
          status?: PauseStatus
          strategy?: ResumeStrategy | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          pause_end?: string | null
          pause_start?: string
          planned_resume_date?: string | null
          reason?: PauseReason
          status?: PauseStatus
          strategy?: ResumeStrategy | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_pauses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          role: "admin" | "coach"
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id: string
          name: string
          role?: "admin" | "coach"
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          role?: "admin" | "coach"
          updated_at?: string
        }
        Relationships: []
      }
      program_schedule: {
        Row: {
          client_id: string
          created_at: string
          end_date: string | null
          focus: string | null
          id: string
          is_deload: boolean
          original_end_date: string | null
          original_start_date: string | null
          sheet_name: string | null
          start_date: string | null
          status: string | null
          updated_at: string
          week_number: number
        }
        Insert: {
          client_id: string
          created_at?: string
          end_date?: string | null
          focus?: string | null
          id?: string
          is_deload?: boolean
          original_end_date?: string | null
          original_start_date?: string | null
          sheet_name?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string
          week_number: number
        }
        Update: {
          client_id?: string
          created_at?: string
          end_date?: string | null
          focus?: string | null
          id?: string
          is_deload?: boolean
          original_end_date?: string | null
          original_start_date?: string | null
          sheet_name?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "program_schedule_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          active: boolean
          client_id: string | null
          created_at: string
          description: string | null
          duration_weeks: number
          equipment: string | null
          id: string
          language: string
          parsed_content: Json | null
          price: number | null
          template_file_url: string | null
          template_id: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id?: string | null
          created_at?: string
          description?: string | null
          duration_weeks?: number
          equipment?: string | null
          id?: string
          language?: string
          parsed_content?: Json | null
          price?: number | null
          template_file_url?: string | null
          template_id?: string | null
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string | null
          created_at?: string
          description?: string | null
          duration_weeks?: number
          equipment?: string | null
          id?: string
          language?: string
          parsed_content?: Json | null
          price?: number | null
          template_file_url?: string | null
          template_id?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_logs: {
        Row: {
          client_id: string
          comment: string | null
          created_at: string
          date: string
          day_order: number | null
          exercise: string
          id: string
          reps: string | null
          rpe: number | null
          sets: number | null
          updated_at: string
          week: number | null
          weight: number | null
        }
        Insert: {
          client_id: string
          comment?: string | null
          created_at?: string
          date: string
          day_order?: number | null
          exercise: string
          id?: string
          reps?: string | null
          rpe?: number | null
          sets?: number | null
          updated_at?: string
          week?: number | null
          weight?: number | null
        }
        Update: {
          client_id?: string
          comment?: string | null
          created_at?: string
          date?: string
          day_order?: number | null
          exercise?: string
          id?: string
          reps?: string | null
          rpe?: number | null
          sets?: number | null
          updated_at?: string
          week?: number | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "workout_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      client_status: "active" | "inactive" | "access_expired"
      message_direction: "to_client" | "to_coach"
      notification_type:
        | "morning"
        | "evening"
        | "measurement"
        | "checkin"
        | "alert"
        | "payment"
      payment_status: "pending" | "paid"
      photo_type: "front" | "side" | "back"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      client_status: ["active", "inactive", "access_expired"],
      message_direction: ["to_client", "to_coach"],
      notification_type: [
        "morning",
        "evening",
        "measurement",
        "checkin",
        "alert",
        "payment",
      ],
      payment_status: ["pending", "paid"],
      photo_type: ["front", "side", "back"],
    },
  },
} as const
