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
      deliveries: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivery_proof_url: string | null
          driver_name: string
          driver_user_id: string | null
          id: string
          match_id: string
          picked_up_at: string | null
          pickup_proof_url: string | null
          recipient_confirmation: string | null
          safety_acknowledged: boolean
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivery_proof_url?: string | null
          driver_name?: string
          driver_user_id?: string | null
          id?: string
          match_id: string
          picked_up_at?: string | null
          pickup_proof_url?: string | null
          recipient_confirmation?: string | null
          safety_acknowledged?: boolean
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivery_proof_url?: string | null
          driver_name?: string
          driver_user_id?: string | null
          id?: string
          match_id?: string
          picked_up_at?: string | null
          pickup_proof_url?: string | null
          recipient_confirmation?: string | null
          safety_acknowledged?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      donations: {
        Row: {
          allergens: string
          category: string
          created_at: string
          donor_org_id: string | null
          donor_user_id: string | null
          id: string
          latitude: number
          longitude: number
          notes: string
          photo_url: string | null
          pickup_address: string
          pickup_deadline: string
          pounds: number
          servings: number | null
          status: Database["public"]["Enums"]["donation_status"]
          storage_required: string
          title: string
        }
        Insert: {
          allergens?: string
          category: string
          created_at?: string
          donor_org_id?: string | null
          donor_user_id?: string | null
          id?: string
          latitude: number
          longitude: number
          notes?: string
          photo_url?: string | null
          pickup_address: string
          pickup_deadline: string
          pounds: number
          servings?: number | null
          status?: Database["public"]["Enums"]["donation_status"]
          storage_required: string
          title: string
        }
        Update: {
          allergens?: string
          category?: string
          created_at?: string
          donor_org_id?: string | null
          donor_user_id?: string | null
          id?: string
          latitude?: number
          longitude?: number
          notes?: string
          photo_url?: string | null
          pickup_address?: string
          pickup_deadline?: string
          pounds?: number
          servings?: number | null
          status?: Database["public"]["Enums"]["donation_status"]
          storage_required?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "donations_donor_org_id_fkey"
            columns: ["donor_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          donation_id: string
          explanation: string
          id: string
          recipient_org_id: string
          responded_at: string | null
          responded_by: string | null
          score: number
          status: Database["public"]["Enums"]["match_status"]
        }
        Insert: {
          created_at?: string
          donation_id: string
          explanation: string
          id?: string
          recipient_org_id: string
          responded_at?: string | null
          responded_by?: string | null
          score: number
          status?: Database["public"]["Enums"]["match_status"]
        }
        Update: {
          created_at?: string
          donation_id?: string
          explanation?: string
          id?: string
          recipient_org_id?: string
          responded_at?: string | null
          responded_by?: string | null
          score?: number
          status?: Database["public"]["Enums"]["match_status"]
        }
        Relationships: [
          {
            foreignKeyName: "matches_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_recipient_org_id_fkey"
            columns: ["recipient_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          accepted_categories: string[]
          address: string
          capacity_lbs: number
          cold_storage: boolean
          created_at: string
          households_served: number
          id: string
          latitude: number
          longitude: number
          name: string
          type: Database["public"]["Enums"]["organization_type"]
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          accepted_categories?: string[]
          address: string
          capacity_lbs?: number
          cold_storage?: boolean
          created_at?: string
          households_served?: number
          id?: string
          latitude: number
          longitude: number
          name: string
          type: Database["public"]["Enums"]["organization_type"]
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          accepted_categories?: string[]
          address?: string
          capacity_lbs?: number
          cold_storage?: boolean
          created_at?: string
          households_served?: number
          id?: string
          latitude?: number
          longitude?: number
          name?: string
          type?: Database["public"]["Enums"]["organization_type"]
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          availability: boolean
          created_at: string
          food_safety_training: boolean
          full_name: string
          id: string
          onboarding_complete: boolean
          organization_id: string | null
          phone: string
          updated_at: string
          vehicle_capacity_lbs: number
        }
        Insert: {
          availability?: boolean
          created_at?: string
          food_safety_training?: boolean
          full_name?: string
          id: string
          onboarding_complete?: boolean
          organization_id?: string | null
          phone?: string
          updated_at?: string
          vehicle_capacity_lbs?: number
        }
        Update: {
          availability?: boolean
          created_at?: string
          food_safety_training?: boolean
          full_name?: string
          id?: string
          onboarding_complete?: boolean
          organization_id?: string | null
          phone?: string
          updated_at?: string
          vehicle_capacity_lbs?: number
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rescue_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          detail: string
          donation_id: string
          event_type: string
          id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          detail?: string
          donation_id: string
          event_type: string
          id?: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          detail?: string
          donation_id?: string
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rescue_events_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_delivery: {
        Args: { _action: string; _delivery_id: string }
        Returns: undefined
      }
      can_view_rescue: { Args: { _donation_id: string }; Returns: boolean }
      claim_delivery: { Args: { _match_id: string }; Returns: string }
      claim_initial_role: {
        Args: {
          _full_name: string
          _organization_id?: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      respond_to_match: {
        Args: {
          _match_id: string
          _response: Database["public"]["Enums"]["match_status"]
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "donor" | "recipient" | "driver" | "coordinator"
      donation_status:
        | "open"
        | "matched"
        | "accepted"
        | "driver_assigned"
        | "picked_up"
        | "delivered"
        | "expired"
        | "cancelled"
      match_status: "proposed" | "accepted" | "declined" | "unsafe"
      organization_type: "donor" | "recipient" | "coordinator"
      verification_status: "pending" | "verified" | "suspended"
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
    Enums: {
      app_role: ["donor", "recipient", "driver", "coordinator"],
      donation_status: [
        "open",
        "matched",
        "accepted",
        "driver_assigned",
        "picked_up",
        "delivered",
        "expired",
        "cancelled",
      ],
      match_status: ["proposed", "accepted", "declined", "unsafe"],
      organization_type: ["donor", "recipient", "coordinator"],
      verification_status: ["pending", "verified", "suspended"],
    },
  },
} as const
