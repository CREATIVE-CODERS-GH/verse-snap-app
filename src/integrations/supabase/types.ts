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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_search_usage: {
        Row: {
          subject: string
          used: number
          window_kind: string
          window_start: string
        }
        Insert: {
          subject: string
          used?: number
          window_kind: string
          window_start: string
        }
        Update: {
          subject?: string
          used?: number
          window_kind?: string
          window_start?: string
        }
        Relationships: []
      }
      highlights: {
        Row: {
          book_id: string
          chapter: number
          color: string
          created_at: string
          id: string
          translation: string
          updated_at: string
          user_id: string
          verse: number
        }
        Insert: {
          book_id: string
          chapter: number
          color: string
          created_at?: string
          id?: string
          translation: string
          updated_at?: string
          user_id: string
          verse: number
        }
        Update: {
          book_id?: string
          chapter?: number
          color?: string
          created_at?: string
          id?: string
          translation?: string
          updated_at?: string
          user_id?: string
          verse?: number
        }
        Relationships: []
      }
      history: {
        Row: {
          book_id: string
          book_name: string
          chapter: number
          id: string
          kind: string
          translation: string
          user_id: string
          verse: number | null
          verse_text: string
          viewed_at: string
        }
        Insert: {
          book_id: string
          book_name: string
          chapter: number
          id?: string
          kind?: string
          translation?: string
          user_id: string
          verse?: number | null
          verse_text?: string
          viewed_at?: string
        }
        Update: {
          book_id?: string
          book_name?: string
          chapter?: number
          id?: string
          kind?: string
          translation?: string
          user_id?: string
          verse?: number | null
          verse_text?: string
          viewed_at?: string
        }
        Relationships: []
      }
      notebooks: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          text_size: string
          theme: string
          translation: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          text_size?: string
          theme?: string
          translation?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          text_size?: string
          theme?: string
          translation?: string
          updated_at?: string
        }
        Relationships: []
      }
      reflections: {
        Row: {
          body: string
          book_id: string
          chapter: number
          created_at: string
          id: string
          is_private: boolean
          notebook_id: string
          posture: string | null
          tags: string[]
          title: string
          translation: string
          updated_at: string
          user_id: string
          verse: number
        }
        Insert: {
          body?: string
          book_id: string
          chapter: number
          created_at?: string
          id?: string
          is_private?: boolean
          notebook_id: string
          posture?: string | null
          tags?: string[]
          title?: string
          translation: string
          updated_at?: string
          user_id: string
          verse: number
        }
        Update: {
          body?: string
          book_id?: string
          chapter?: number
          created_at?: string
          id?: string
          is_private?: boolean
          notebook_id?: string
          posture?: string | null
          tags?: string[]
          title?: string
          translation?: string
          updated_at?: string
          user_id?: string
          verse?: number
        }
        Relationships: [
          {
            foreignKeyName: "reflections_notebook_fkey"
            columns: ["notebook_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notebooks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      saved_verses: {
        Row: {
          book_id: string
          book_name: string
          chapter: number
          created_at: string
          id: string
          translation: string
          user_id: string
          verse: number
          verse_text: string
        }
        Insert: {
          book_id: string
          book_name: string
          chapter: number
          created_at?: string
          id?: string
          translation?: string
          user_id: string
          verse: number
          verse_text?: string
        }
        Update: {
          book_id?: string
          book_name?: string
          chapter?: number
          created_at?: string
          id?: string
          translation?: string
          user_id?: string
          verse?: number
          verse_text?: string
        }
        Relationships: []
      }
      translations: {
        Row: {
          code: string
          language: string
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          language?: string
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          language?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_ai_search_quota: {
        Args: {
          p_day_limit: number
          p_global_day_limit: number
          p_global_month_limit: number
          p_minute_limit: number
          p_subject: string
        }
        Returns: {
          allowed: boolean
          reason: string
          retry_after_seconds: number
        }[]
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
