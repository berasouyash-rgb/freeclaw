-- Voice Box v3.0 Enterprise Migration
-- Adds: tool calling, approval workflows, audit logs, knowledge base, agent memory
-- Enhances: conversations, messages with AI metadata

-- ============================================================
-- 1. ENHANCE EXISTING TABLES
-- ============================================================

-- Enhance conversations table
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_confidence FLOAT DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sentiment TEXT DEFAULT 'neutral';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sentiment_score FLOAT DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Enhance messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_model TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_agent TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sentiment TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS confidence FLOAT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS rich_content JSONB;

-- ============================================================
-- 2. NEW TABLES
-- ============================================================

-- Tool calls — tracks every AI tool execution
CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  parameters JSONB DEFAULT '{}',
  result JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'approved', 'rejected')),
  approval_required BOOLEAN DEFAULT FALSE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  latency_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Approval workflows — tracks AI actions needing admin approval
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_call_id UUID REFERENCES tool_calls(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reason TEXT,
  timeout_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Audit logs — complete trail of every action
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'admin', 'ai', 'system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Knowledge base — FAQ, policies, resources with vector search
CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  embedding VECTOR(1536),
  confidence FLOAT DEFAULT 1.0,
  source TEXT,
  last_verified TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent memory — long-term memory for AI agents
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('user_preferences', 'conversation_context', 'learned_facts', 'experience')),
  content JSONB NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  source TEXT DEFAULT 'system',
  last_accessed TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- ============================================================
-- 3. INDEXES FOR PERFORMANCE
-- ============================================================

-- Tool calls indexes
CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_id ON tool_calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_status ON tool_calls(status);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_created_at ON tool_calls(created_at DESC);

-- Approvals indexes
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_conversation_id ON approvals(conversation_id);
CREATE INDEX IF NOT EXISTS idx_approvals_created_at ON approvals(created_at DESC);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Knowledge base indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tags ON knowledge_base USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_usage ON knowledge_base(usage_count DESC);

-- Agent memory indexes
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_expires ON agent_memory(expires_at);

-- Conversations enhancement indexes
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_sentiment ON conversations(sentiment);
CREATE INDEX IF NOT EXISTS idx_conversations_category ON conversations(category);

-- Messages enhancement indexes
CREATE INDEX IF NOT EXISTS idx_messages_ai_generated ON messages(ai_generated);
CREATE INDEX IF NOT EXISTS idx_messages_ai_agent ON messages(ai_agent);

-- ============================================================
-- 4. ROW LEVEL SECURITY POLICIES
-- ============================================================

-- Enable RLS on all new tables
ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- Service role full access (consistent with existing pattern)
CREATE POLICY "Service role full access" ON tool_calls FOR ALL USING (true);
CREATE POLICY "Service role full access" ON approvals FOR ALL USING (true);
CREATE POLICY "Service role full access" ON audit_logs FOR ALL USING (true);
CREATE POLICY "Service role full access" ON knowledge_base FOR ALL USING (true);
CREATE POLICY "Service role full access" ON agent_memory FOR ALL USING (true);

-- ============================================================
-- 5. SEED KNOWLEDGE BASE (Sample data)
-- ============================================================

-- Insert sample FAQ articles
INSERT INTO knowledge_base (title, content, category, tags) VALUES
('How to submit a report', 'Click the "Submit" button in the top navigation. Choose whether it is a Problem or Suggestion. Fill in the title and description. You can attach an image if needed. Your report is anonymous.', 'getting_started', ARRAY['submit', 'report', 'anonymous']),
('What happens after I submit', 'Your report goes to the moderation queue. An AI reviews it for safety. Once approved, it appears on the feed. School staff are notified and can respond.', 'getting_started', ARRAY['submit', 'process', 'moderation']),
('How anonymity works', 'Your identity is protected by a browser-generated anonymous ID. No personal information is collected. School staff cannot see who you are.', 'privacy', ARRAY['anonymous', 'identity', 'privacy']),
('Can I delete my report', 'Yes. Go to "My Activity" and you can delete any of your reports. They are permanently removed.', 'privacy', ARRAY['delete', 'report', 'privacy']),
('How to attach evidence', 'When submitting or commenting, click the image icon to attach a photo or screenshot. Maximum file size is 4MB.', 'features', ARRAY['attach', 'image', 'evidence']),
('What is the co-sign system', 'When a report gets 10 or more supports, it is automatically flagged as "ready for decision" for school staff to prioritize.', 'features', ARRAY['cosign', 'support', 'priority']),
('How to support a report', 'Click the "Support" button on any report. This helps school staff understand which issues affect the most students.', 'features', ARRAY['support', 'upvote', 'help']),
('Emotional support available', 'If you are feeling distressed, the AI emotional support agent is available 24/7. It can provide comfort and connect you with school counselors.', 'support', ARRAY['emotional', 'counseling', 'help'])
ON CONFLICT DO NOTHING;
