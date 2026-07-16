export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

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

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string;
          telegram_id: number | null;
          name: string;
          status: ClientStatus;
          payment_status: PaymentStatus;
          program_id: string | null;
          connect_code: string | null;
          spreadsheet_id: string | null;
          language: string;
          timezone: string | null;
          morning_time: string | null;
          measurement_time: string | null;
          measurement_day: number | null;
          access_start_date: string | null;
          access_end_date: string | null;
          legacy_id: string | null;
          purchase_date: string | null;
          purchased_program_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["clients"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Row"]>;
        Relationships: [];
      };
      programs: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          equipment: string | null;
          price: number | null;
          template_id: string | null;
          active: boolean;
          type: string | null;
          language: string;
          duration_weeks: number;
          template_file_url: string | null;
          parsed_content: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["programs"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["programs"]["Row"]>;
        Relationships: [];
      };
      workout_logs: {
        Row: {
          id: string;
          client_id: string;
          date: string;
          week: number | null;
          exercise: string;
          sets: number | null;
          reps: string | null;
          weight: number | null;
          rpe: number | null;
          comment: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["workout_logs"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["workout_logs"]["Row"]>;
        Relationships: [];
      };
      measurements: {
        Row: {
          id: string;
          client_id: string;
          date: string;
          weight: number | null;
          waist: number | null;
          abdomen: number | null;
          chest: number | null;
          hips: number | null;
          glutes: number | null;
          left_thigh: number | null;
          right_thigh: number | null;
          left_arm: number | null;
          right_arm: number | null;
          body_fat: number | null;
          muscle_mass: number | null;
          visceral_fat: number | null;
          comment: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["measurements"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["measurements"]["Row"]>;
        Relationships: [];
      };
      checkins: {
        Row: {
          id: string;
          client_id: string;
          date: string;
          week: number | null;
          wellbeing: number | null;
          sleep: number | null;
          stress: number | null;
          nutrition_adherence: number | null;
          missed_workouts: number | null;
          complaints: string | null;
          comment: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["checkins"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["checkins"]["Row"]>;
        Relationships: [];
      };
      photos: {
        Row: {
          id: string;
          client_id: string;
          date: string;
          week: number | null;
          type: PhotoType;
          drive_url: string | null;
          folder_url: string | null;
          storage_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["photos"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["photos"]["Row"]>;
        Relationships: [];
      };
      program_schedule: {
        Row: {
          id: string;
          client_id: string;
          week_number: number;
          sheet_name: string | null;
          start_date: string | null;
          end_date: string | null;
          original_start_date: string | null;
          original_end_date: string | null;
          is_deload: boolean;
          focus: string | null;
          status: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["program_schedule"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["program_schedule"]["Row"]>;
        Relationships: [];
      };
      exercises: {
        Row: {
          id: string;
          name: string;
          muscle_group: string | null;
          equipment: string | null;
          difficulty: string | null;
          demo_video_url: string | null;
          contraindications: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["exercises"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exercises"]["Row"]>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          client_id: string;
          coach_id: string | null;
          direction: MessageDirection;
          text: string;
          sent_at: string;
          read_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["messages"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Row"]>;
        Relationships: [];
      };
      notification_log: {
        Row: {
          id: string;
          client_id: string;
          type: NotificationType;
          status: string;
          sent_at: string;
          metadata: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["notification_log"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notification_log"]["Row"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          name: string;
          role: "admin" | "coach";
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      plan_pauses: {
        Row: {
          id: string;
          client_id: string;
          pause_start: string;
          pause_end: string | null;
          planned_resume_date: string | null;
          reason: PauseReason;
          strategy: ResumeStrategy;
          status: PauseStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["plan_pauses"]["Row"], "id" | "created_at" | "updated_at" | "pause_end" | "strategy" | "planned_resume_date"> & {
          id?: string;
          pause_end?: string | null;
          planned_resume_date?: string | null;
          strategy?: ResumeStrategy;
        };
        Update: Partial<Database["public"]["Tables"]["plan_pauses"]["Row"]>;
        Relationships: [];
      };
      bot_state: {
        Row: {
          telegram_id: number;
          client_id: string | null;
          action: string | null;
          step: string | null;
          data: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          telegram_id: number;
          client_id?: string | null;
          action?: string | null;
          step?: string | null;
          data?: Json;
        };
        Update: Partial<Database["public"]["Tables"]["bot_state"]["Row"]>;
        Relationships: [];
      };
      client_tokens: {
        Row: {
          id: string;
          client_id: string;
          token: string;
          expires_at: string;
          last_used_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["client_tokens"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_tokens"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      client_status: ClientStatus;
      payment_status: PaymentStatus;
      photo_type: PhotoType;
      message_direction: MessageDirection;
      notification_type: NotificationType;
    };
  };
}
