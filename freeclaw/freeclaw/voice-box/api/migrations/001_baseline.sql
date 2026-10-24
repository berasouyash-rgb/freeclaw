-- 001 BASELINE — core tables as they exist in production.
-- Generated from the live Supabase schema (PostgREST definitions).
-- Safe to re-run (IF NOT EXISTS throughout). Apply BEFORE 002-015.
-- RLS policies, indexes, and hardening arrive via the 002-015 chain;
-- storage buckets (chat-media, voicebox-media) are created in the
-- dashboard (Storage) — see docs/DEPLOY-SCHOOL.md.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY,
  type text,
  title text,
  description text,
  category text,
  priority text,
  tags text[],
  image_url text,
  author_id text,
  status text,
  progress integer,
  deleted boolean,
  hidden boolean,
  pinned boolean,
  featured boolean,
  locked boolean,
  status_history jsonb,
  admin_reply text,
  admin_notes text,
  ai_summary text,
  eta text,
  assigned_to text,
  merged_into text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  visibility text
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  post_id text,
  parent_id text,
  author_id text,
  body text,
  is_admin boolean,
  edited boolean,
  deleted boolean,
  hidden boolean,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS polls (
  id text PRIMARY KEY,
  post_id text,
  title text,
  ptype text,
  options jsonb,
  author_id text,
  expires_at timestamp with time zone DEFAULT now(),
  archived boolean,
  deleted boolean,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_votes (
  id bigint PRIMARY KEY,
  poll_id text,
  author_id text,
  choices jsonb
);

CREATE TABLE IF NOT EXISTS reactions (
  id bigint PRIMARY KEY,
  target_id text,
  target_type text,
  author_id text,
  kind text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id bigint PRIMARY KEY,
  target_id text,
  target_type text,
  reason text,
  author_id text,
  status text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text,
  value jsonb,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users_meta (
  anon_id text PRIMARY KEY,
  banned boolean,
  suspended_until timestamp with time zone,
  strikes integer,
  warnings jsonb,
  notes text,
  spam_score real,
  last_seen timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  notif_type text,
  title text,
  body text,
  is_read boolean,
  user_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  title text,
  agent_id text,
  created_by text,
  status text,
  last_message_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  metadata jsonb,
  ai_confidence double precision,
  sentiment text,
  sentiment_score double precision,
  category text,
  sla_due_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  conversation_id text,
  role text,
  content text,
  agent_id text,
  tool_calls jsonb,
  tool_result jsonb,
  created_at timestamp with time zone DEFAULT now(),
  metadata jsonb,
  ai_generated boolean,
  ai_model text,
  ai_agent text,
  sentiment text,
  confidence double precision,
  rich_content jsonb
);

CREATE TABLE IF NOT EXISTS chat_threads (
  thread_id text,
  status text,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id bigint PRIMARY KEY,
  thread_id text,
  sender text,
  body text,
  attachment_url text,
  read boolean,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id bigint PRIMARY KEY,
  actor text,
  action text,
  detail text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id text,
  report_id uuid,
  insight_id uuid,
  rating integer,
  comment text,
  learning_weight numeric,
  admin_id text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_tabs (
  id text PRIMARY KEY,
  conversation_id text,
  position integer,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id text,
  config_type text,
  config_key text,
  config_value jsonb,
  version integer,
  previous_value jsonb,
  source text,
  applied boolean,
  applied_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id bigint PRIMARY KEY,
  session_id text,
  role text,
  content text,
  actions jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_goals (
  id text PRIMARY KEY,
  agent_id text,
  goal text,
  status text,
  priority integer,
  created_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone DEFAULT now(),
  result jsonb
);

CREATE TABLE IF NOT EXISTS agent_insights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id text,
  division text,
  insight_type text,
  trigger_source text,
  current_value jsonb,
  suggested_value jsonb,
  reasoning text,
  confidence numeric,
  applied boolean,
  applied_at timestamp with time zone DEFAULT now(),
  rejected boolean,
  admin_feedback_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_knowledge (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source_agent_id text,
  division text,
  pattern_type text,
  pattern_data jsonb,
  success_count integer,
  failure_count integer,
  total_uses integer,
  success_rate numeric,
  last_success_at timestamp with time zone DEFAULT now(),
  last_failure_at timestamp with time zone DEFAULT now(),
  decay_weight numeric,
  tags text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_learning (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id text,
  agent_name text,
  division text,
  task_type text,
  task_summary text,
  success boolean,
  confidence numeric,
  error_type text,
  error_count integer,
  duration_ms integer,
  patterns_used jsonb,
  context_hash text,
  input_sample jsonb,
  output_sample jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id text,
  agent_name text,
  division text,
  report_type text,
  findings jsonb,
  metrics jsonb,
  raw_data jsonb,
  severity text,
  status text,
  task_summary text,
  duration_ms integer,
  created_at timestamp with time zone DEFAULT now(),
  reviewed_at timestamp with time zone DEFAULT now(),
  reviewed_by text
);

CREATE TABLE IF NOT EXISTS agent_suggestions (
  id bigint PRIMARY KEY,
  kind text,
  target_id text,
  target_type text,
  title text,
  content jsonb,
  confidence real,
  reasoning text,
  critical boolean,
  status text,
  outcome text,
  resolved_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tool_evidence (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_call_id uuid,
  conversation_id text,
  tool_name text,
  before_state jsonb,
  after_state jsonb,
  action_type text,
  affected_resources jsonb,
  input_params jsonb,
  output_result jsonb,
  verification_status text,
  verification_details jsonb,
  actor_id text,
  actor_type text,
  ip_address text,
  risk_level text,
  requires_approval boolean,
  approved_by text,
  created_at timestamp with time zone DEFAULT now(),
  verified_at timestamp with time zone DEFAULT now()
);
