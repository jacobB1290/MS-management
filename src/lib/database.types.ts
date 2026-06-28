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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string
          display_name: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          diff: Json | null
          id: string
          ip: unknown
          target_id: string | null
          target_table: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          diff?: Json | null
          id?: string
          ip?: unknown
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          diff?: Json | null
          id?: string
          ip?: unknown
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          claimed_at: string | null
          contact_id: string
          error: string | null
          provider_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          claimed_at?: string | null
          contact_id: string
          error?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          claimed_at?: string | null
          contact_id?: string
          error?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience_filter: Json
          body: string | null
          brevo_campaign_id: number | null
          brevo_list_id: number | null
          brevo_sync: Json | null
          brevo_template_id: number | null
          channel: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          email_subject: string | null
          event_id: string | null
          id: string
          media_url: string | null
          name: string
          scheduled_at: string | null
          sendgrid_template_id: string | null
          started_at: string | null
          stats: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          audience_filter?: Json
          body?: string | null
          brevo_campaign_id?: number | null
          brevo_list_id?: number | null
          brevo_sync?: Json | null
          brevo_template_id?: number | null
          channel: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          email_subject?: string | null
          event_id?: string | null
          id?: string
          media_url?: string | null
          name: string
          scheduled_at?: string | null
          sendgrid_template_id?: string | null
          started_at?: string | null
          stats?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          audience_filter?: Json
          body?: string | null
          brevo_campaign_id?: number | null
          brevo_list_id?: number | null
          brevo_sync?: Json | null
          brevo_template_id?: number | null
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          email_subject?: string | null
          event_id?: string | null
          id?: string
          media_url?: string | null
          name?: string
          scheduled_at?: string | null
          sendgrid_template_id?: string | null
          started_at?: string | null
          stats?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      church_knowledge: {
        Row: {
          body: string
          content_hash: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          search_tsv: unknown
          source: string
          source_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          search_tsv?: unknown
          source?: string
          source_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          search_tsv?: unknown
          source?: string
          source_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          ai_tags: string[]
          brevo_contact_id: string | null
          consent_at: string | null
          consent_method: string | null
          created_at: string
          email: string | null
          email_unsubscribed_at: string | null
          id: string
          inbox_category: string
          inbox_category_at: string | null
          inbox_status: string | null
          inbox_status_at: string | null
          is_member: boolean
          language: string
          last_message_at: string | null
          last_message_body: string | null
          last_message_channel: string | null
          last_message_direction: string | null
          last_message_subject: string | null
          marketing_consent_at: string | null
          marketing_consent_method: string | null
          marketing_opt_in_requested_at: string | null
          marketing_opted_out_at: string | null
          message_count: number
          name: string | null
          notes: string | null
          phone: string | null
          sms_opted_out_at: string | null
          source: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          ai_tags?: string[]
          brevo_contact_id?: string | null
          consent_at?: string | null
          consent_method?: string | null
          created_at?: string
          email?: string | null
          email_unsubscribed_at?: string | null
          id?: string
          inbox_category?: string
          inbox_category_at?: string | null
          inbox_status?: string | null
          inbox_status_at?: string | null
          is_member?: boolean
          language?: string
          last_message_at?: string | null
          last_message_body?: string | null
          last_message_channel?: string | null
          last_message_direction?: string | null
          last_message_subject?: string | null
          marketing_consent_at?: string | null
          marketing_consent_method?: string | null
          marketing_opt_in_requested_at?: string | null
          marketing_opted_out_at?: string | null
          message_count?: number
          name?: string | null
          notes?: string | null
          phone?: string | null
          sms_opted_out_at?: string | null
          source?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          ai_tags?: string[]
          brevo_contact_id?: string | null
          consent_at?: string | null
          consent_method?: string | null
          created_at?: string
          email?: string | null
          email_unsubscribed_at?: string | null
          id?: string
          inbox_category?: string
          inbox_category_at?: string | null
          inbox_status?: string | null
          inbox_status_at?: string | null
          is_member?: boolean
          language?: string
          last_message_at?: string | null
          last_message_body?: string | null
          last_message_channel?: string | null
          last_message_direction?: string | null
          last_message_subject?: string | null
          marketing_consent_at?: string | null
          marketing_consent_method?: string | null
          marketing_opt_in_requested_at?: string | null
          marketing_opted_out_at?: string | null
          message_count?: number
          name?: string | null
          notes?: string | null
          phone?: string | null
          sms_opted_out_at?: string | null
          source?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      email_events: {
        Row: {
          contact_id: string | null
          email: string | null
          event_type: string
          id: string
          occurred_at: string
          payload: Json | null
          provider_event_id: string | null
          sendgrid_event_id: string | null
        }
        Insert: {
          contact_id?: string | null
          email?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          provider_event_id?: string | null
          sendgrid_event_id?: string | null
        }
        Update: {
          contact_id?: string | null
          email?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          provider_event_id?: string | null
          sendgrid_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          ages: string | null
          all_day: boolean
          cost: string | null
          created_at: string
          created_by: string | null
          cta_text: string | null
          cta_url: string | null
          description: string | null
          ends_at: string | null
          gcal_calendar_id: string | null
          gcal_event_id: string | null
          id: string
          image_drive_file_id: string | null
          image_public_url: string | null
          image_storage_path: string | null
          location: string | null
          rsvp_by: string | null
          secondary_cta_text: string | null
          secondary_cta_url: string | null
          source: string
          starts_at: string
          status: string
          synced_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          ages?: string | null
          all_day?: boolean
          cost?: string | null
          created_at?: string
          created_by?: string | null
          cta_text?: string | null
          cta_url?: string | null
          description?: string | null
          ends_at?: string | null
          gcal_calendar_id?: string | null
          gcal_event_id?: string | null
          id?: string
          image_drive_file_id?: string | null
          image_public_url?: string | null
          image_storage_path?: string | null
          location?: string | null
          rsvp_by?: string | null
          secondary_cta_text?: string | null
          secondary_cta_url?: string | null
          source?: string
          starts_at: string
          status?: string
          synced_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          ages?: string | null
          all_day?: boolean
          cost?: string | null
          created_at?: string
          created_by?: string | null
          cta_text?: string | null
          cta_url?: string | null
          description?: string | null
          ends_at?: string | null
          gcal_calendar_id?: string | null
          gcal_event_id?: string | null
          id?: string
          image_drive_file_id?: string | null
          image_public_url?: string | null
          image_storage_path?: string | null
          location?: string | null
          rsvp_by?: string | null
          secondary_cta_text?: string | null
          secondary_cta_url?: string | null
          source?: string
          starts_at?: string
          status?: string
          synced_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      form_submissions: {
        Row: {
          consent_at: string
          consent_method: string
          contact_id: string | null
          created_at: string
          email: string | null
          form_id: string | null
          id: string
          ip: unknown
          name: string | null
          payload: Json
          phone: string | null
          user_agent: string | null
        }
        Insert: {
          consent_at?: string
          consent_method: string
          contact_id?: string | null
          created_at?: string
          email?: string | null
          form_id?: string | null
          id?: string
          ip?: unknown
          name?: string | null
          payload: Json
          phone?: string | null
          user_agent?: string | null
        }
        Update: {
          consent_at?: string
          consent_method?: string
          contact_id?: string | null
          created_at?: string
          email?: string | null
          form_id?: string | null
          id?: string
          ip?: unknown
          name?: string | null
          payload?: Json
          phone?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      heartbeat: {
        Row: {
          id: number
          last_run_at: string
        }
        Insert: {
          id?: number
          last_run_at?: string
        }
        Update: {
          id?: number
          last_run_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string | null
          body_html: string | null
          campaign_id: string | null
          channel: string
          contact_id: string
          context: string | null
          created_at: string
          direction: string
          email_meta: Json | null
          error: string | null
          id: string
          media_url: string | null
          num_segments: number | null
          price: number | null
          price_unit: string | null
          provider_message_id: string | null
          sent_by: string | null
          status: string | null
          subject: string | null
          twilio_sid: string | null
        }
        Insert: {
          body?: string | null
          body_html?: string | null
          campaign_id?: string | null
          channel: string
          contact_id: string
          context?: string | null
          created_at?: string
          direction: string
          email_meta?: Json | null
          error?: string | null
          id?: string
          media_url?: string | null
          num_segments?: number | null
          price?: number | null
          price_unit?: string | null
          provider_message_id?: string | null
          sent_by?: string | null
          status?: string | null
          subject?: string | null
          twilio_sid?: string | null
        }
        Update: {
          body?: string | null
          body_html?: string | null
          campaign_id?: string | null
          channel?: string
          contact_id?: string
          context?: string | null
          created_at?: string
          direction?: string
          email_meta?: Json | null
          error?: string | null
          id?: string
          media_url?: string | null
          num_segments?: number | null
          price?: number | null
          price_unit?: string | null
          provider_message_id?: string | null
          sent_by?: string | null
          status?: string | null
          subject?: string | null
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      segmentation_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string | null
          duration_sec: number
          error: string | null
          finalized_at: string | null
          id: string
          json_schema: Json
          known_topics: string[]
          origin: string
          result: Json | null
          returned_at: string | null
          run_id: string | null
          sermon_id: string
          status: string
          system_prompt: string
          user_content: string
          youtube_video_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          duration_sec: number
          error?: string | null
          finalized_at?: string | null
          id?: string
          json_schema: Json
          known_topics?: string[]
          origin?: string
          result?: Json | null
          returned_at?: string | null
          run_id?: string | null
          sermon_id: string
          status?: string
          system_prompt: string
          user_content: string
          youtube_video_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          duration_sec?: number
          error?: string | null
          finalized_at?: string | null
          id?: string
          json_schema?: Json
          known_topics?: string[]
          origin?: string
          result?: Json | null
          returned_at?: string | null
          run_id?: string | null
          sermon_id?: string
          status?: string
          system_prompt?: string
          user_content?: string
          youtube_video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segmentation_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sermon_pipeline_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segmentation_jobs_sermon_id_fkey"
            columns: ["sermon_id"]
            isOneToOne: false
            referencedRelation: "sermons"
            referencedColumns: ["id"]
          },
        ]
      }
      sermon_backfill_queue: {
        Row: {
          attempts: number
          error: string | null
          finished_at: string | null
          hold_for_claude: boolean
          published_at: string | null
          reprocess: boolean
          requested_at: string
          requested_by: string | null
          started_at: string | null
          status: string
          title: string | null
          youtube_video_id: string
        }
        Insert: {
          attempts?: number
          error?: string | null
          finished_at?: string | null
          hold_for_claude?: boolean
          published_at?: string | null
          reprocess?: boolean
          requested_at?: string
          requested_by?: string | null
          started_at?: string | null
          status?: string
          title?: string | null
          youtube_video_id: string
        }
        Update: {
          attempts?: number
          error?: string | null
          finished_at?: string | null
          hold_for_claude?: boolean
          published_at?: string | null
          reprocess?: boolean
          requested_at?: string
          requested_by?: string | null
          started_at?: string | null
          status?: string
          title?: string | null
          youtube_video_id?: string
        }
        Relationships: []
      }
      sermon_pipeline_runs: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string
          sermon_id: string | null
          started_at: string
          status: string
          steps: Json
          trigger: string
          updated_at: string
          youtube_video_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          sermon_id?: string | null
          started_at?: string
          status?: string
          steps?: Json
          trigger?: string
          updated_at?: string
          youtube_video_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          sermon_id?: string | null
          started_at?: string
          status?: string
          steps?: Json
          trigger?: string
          updated_at?: string
          youtube_video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sermon_pipeline_runs_sermon_id_fkey"
            columns: ["sermon_id"]
            isOneToOne: false
            referencedRelation: "sermons"
            referencedColumns: ["id"]
          },
        ]
      }
      sermons: {
        Row: {
          created_at: string
          created_by: string | null
          duration_sec: number | null
          error: string | null
          format: string
          generated_title: string | null
          id: string
          published_at: string | null
          segments: Json
          seo: Json | null
          slug: string | null
          songs: Json
          source: string
          speakers: string[]
          status: string
          summary: string | null
          thumbnail_url: string | null
          title: string
          topics: string[]
          transcript: string | null
          updated_at: string
          youtube_video_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duration_sec?: number | null
          error?: string | null
          format?: string
          generated_title?: string | null
          id?: string
          published_at?: string | null
          segments?: Json
          seo?: Json | null
          slug?: string | null
          songs?: Json
          source?: string
          speakers?: string[]
          status?: string
          summary?: string | null
          thumbnail_url?: string | null
          title: string
          topics?: string[]
          transcript?: string | null
          updated_at?: string
          youtube_video_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duration_sec?: number | null
          error?: string | null
          format?: string
          generated_title?: string | null
          id?: string
          published_at?: string | null
          segments?: Json
          seo?: Json | null
          slug?: string | null
          songs?: Json
          source?: string
          speakers?: string[]
          status?: string
          summary?: string | null
          thumbnail_url?: string | null
          title?: string
          topics?: string[]
          transcript?: string | null
          updated_at?: string
          youtube_video_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      contact_summary: {
        Row: {
          created_at: string | null
          email: string | null
          email_unsubscribed_at: string | null
          id: string | null
          inbox_category: string | null
          inbox_status: string | null
          is_member: boolean | null
          language: string | null
          last_message_at: string | null
          last_message_body: string | null
          last_message_channel: string | null
          last_message_direction: string | null
          last_message_subject: string | null
          message_count: number | null
          name: string | null
          phone: string | null
          sms_opted_out_at: string | null
          tags: string[] | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          email_unsubscribed_at?: string | null
          id?: string | null
          inbox_category?: string | null
          inbox_status?: string | null
          is_member?: boolean | null
          language?: string | null
          last_message_at?: string | null
          last_message_body?: string | null
          last_message_channel?: string | null
          last_message_direction?: string | null
          last_message_subject?: string | null
          message_count?: number | null
          name?: string | null
          phone?: string | null
          sms_opted_out_at?: string | null
          tags?: string[] | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          email_unsubscribed_at?: string | null
          id?: string | null
          inbox_category?: string | null
          inbox_status?: string | null
          is_member?: boolean | null
          language?: string | null
          last_message_at?: string | null
          last_message_body?: string | null
          last_message_channel?: string | null
          last_message_direction?: string | null
          last_message_subject?: string | null
          message_count?: number | null
          name?: string | null
          phone?: string | null
          sms_opted_out_at?: string | null
          tags?: string[] | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_campaign_batch: {
        Args: { p_batch_size: number; p_campaign_id: string }
        Returns: {
          contact_id: string
        }[]
      }
      database_size: { Args: never; Returns: number }
      search_church_knowledge: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          body: string
          content_hash: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          search_tsv: unknown
          source: string
          source_url: string | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "church_knowledge"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_contact_by_phone_or_email: {
        Args: {
          p_consent_at: string
          p_consent_method: string
          p_email: string
          p_language?: string
          p_name: string
          p_phone: string
          p_source: string
          p_tags?: string[]
        }
        Returns: Database["public"]["CompositeTypes"]["contact_upsert_result"]
        SetofOptions: {
          from: "*"
          to: "contact_upsert_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      contact_upsert_result: {
        contact_id: string | null
        created: boolean | null
        needs_review: boolean | null
        conflict_with: string | null
      }
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
