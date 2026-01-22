-- Autonomous Demo Schema
-- Run this SQL in your new Supabase project's SQL Editor

-- Demo sessions table
CREATE TABLE demo_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  topic JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_iteration INTEGER DEFAULT 0,
  orchestrator_decisions JSONB DEFAULT '[]',
  final_state JSONB,
  paper_id UUID,
  paper_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- Demo messages table
CREATE TABLE demo_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_demo_sessions_status ON demo_sessions(status);
CREATE INDEX idx_demo_sessions_conversation ON demo_sessions(conversation_id);
CREATE INDEX idx_demo_messages_session ON demo_messages(session_id);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_demo_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_demo_sessions_updated_at
  BEFORE UPDATE ON demo_sessions
  FOR EACH ROW EXECUTE FUNCTION update_demo_updated_at();

-- RLS policies (permissive for demo)
ALTER TABLE demo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to demo_sessions" ON demo_sessions FOR ALL USING (true);
CREATE POLICY "Allow all access to demo_messages" ON demo_messages FOR ALL USING (true);
