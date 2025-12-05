-- BioAgents Database Schema Setup
-- Run this SQL in your Supabase/PostgreSQL database to set up all required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables (cascade to handle foreign keys)
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS states CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users table
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  wallet_address TEXT UNIQUE, -- For x402 payment users identified by wallet
  used_invite_code TEXT,
  points INTEGER DEFAULT 0,
  has_completed_invite_flow BOOLEAN DEFAULT false,
  invite_codes_remaining INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast wallet lookups
CREATE INDEX idx_users_wallet_address ON users(wallet_address);

-- States table (stores message processing state)
CREATE TABLE states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  values JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conversation States table (stores persistent conversation state)
CREATE TABLE conversation_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  values JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conversations table
CREATE TABLE conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_state_id UUID REFERENCES conversation_states(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT,
  content TEXT NOT NULL,
  state_id UUID REFERENCES states(id) ON DELETE SET NULL,
  response_time INTEGER, -- in milliseconds
  source TEXT DEFAULT 'ui', -- 'ui', 'twitter', etc.
  files JSONB, -- stores file metadata for uploads
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX idx_conversations_conversation_state_id ON conversations(conversation_state_id);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_state_id ON messages(state_id);

-- GIN index for JSONB fields (efficient for JSON queries)
CREATE INDEX idx_states_values ON states USING GIN (values);
CREATE INDEX idx_conversation_states_values ON conversation_states USING GIN (values);
CREATE INDEX idx_messages_files ON messages USING GIN (files);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to update updated_at on record updates
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_states_updated_at
  BEFORE UPDATE ON states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversation_states_updated_at
  BEFORE UPDATE ON conversation_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Optional: Create a function to clean up old states (performance optimization)
-- States can grow large, so consider running this periodically
CREATE OR REPLACE FUNCTION cleanup_old_states(days_to_keep INTEGER DEFAULT 1)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete states older than specified days that are not referenced by messages
  DELETE FROM states
  WHERE id IN (
    SELECT s.id
    FROM states s
    LEFT JOIN messages m ON m.state_id = s.id
    WHERE m.id IS NULL
    AND s.created_at < NOW() - INTERVAL '1 day' * days_to_keep
  );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Optional: Schedule automatic cleanup (requires pg_cron extension)
-- Uncomment if you have pg_cron enabled:
-- SELECT cron.schedule('cleanup-old-states', '0 2 * * *', 'SELECT cleanup_old_states(1)');

-- x402 Payment records table
DROP TABLE IF EXISTS x402_payments CASCADE;

CREATE TABLE x402_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  amount_usd NUMERIC NOT NULL,
  amount_wei TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDC',
  network TEXT NOT NULL,
  tools_used TEXT[],
  tx_hash TEXT,
  network_id TEXT,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'verified', 'settled', 'failed')),
  payment_header JSONB,
  payment_requirements JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE,
  settled_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for x402_payments
CREATE INDEX idx_x402_payments_user_id ON x402_payments(user_id);
CREATE INDEX idx_x402_payments_conversation_id ON x402_payments(conversation_id);
CREATE INDEX idx_x402_payments_message_id ON x402_payments(message_id);
CREATE INDEX idx_x402_payments_tx_hash ON x402_payments(tx_hash);
CREATE INDEX idx_x402_payments_status ON x402_payments(payment_status);
CREATE INDEX idx_x402_payments_created_at ON x402_payments(created_at DESC);

-- GIN indexes for JSONB fields
CREATE INDEX idx_x402_payments_payment_header ON x402_payments USING GIN (payment_header);
CREATE INDEX idx_x402_payments_payment_requirements ON x402_payments USING GIN (payment_requirements);

-- View for user payment statistics
CREATE OR REPLACE VIEW user_payment_stats AS
SELECT
  user_id,
  COUNT(*) AS total_payments,
  SUM(amount_usd) AS total_spent_usd,
  AVG(amount_usd) AS avg_payment_usd,
  COUNT(*) FILTER (WHERE payment_status = 'verified') AS verified_payments,
  COUNT(*) FILTER (WHERE payment_status = 'settled') AS settled_payments,
  COUNT(*) FILTER (WHERE payment_status = 'failed') AS failed_payments,
  MAX(created_at) AS last_payment_at,
  MIN(created_at) AS first_payment_at
FROM x402_payments
WHERE user_id IS NOT NULL
GROUP BY user_id;

-- x402 External Requests table (for external API consumers)
DROP TABLE IF EXISTS x402_external CASCADE;

CREATE TABLE x402_external (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request_path TEXT NOT NULL,
  tx_hash TEXT,
  amount_usd NUMERIC,
  amount_wei TEXT,
  asset TEXT DEFAULT 'USDC',
  network TEXT,
  network_id TEXT,
  payment_status TEXT CHECK (payment_status IN ('pending', 'verified', 'settled', 'failed')),
  payment_header JSONB,
  payment_requirements JSONB,
  request_metadata JSONB,
  response_time INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


COMMENT ON TABLE users IS 'User accounts and profile information';
COMMENT ON TABLE conversations IS 'Conversation threads between users and the agent';
COMMENT ON TABLE conversation_states IS 'Persistent state for each conversation (summarized context, key takeaways, etc.)';
COMMENT ON TABLE messages IS 'Individual messages within conversations';
COMMENT ON TABLE states IS 'Processing state for each message (papers cited, knowledge used, etc.)';
COMMENT ON TABLE x402_payments IS 'Payment records for x402 protocol transactions';
COMMENT ON TABLE x402_external IS 'External API requests authenticated via x402 payment (no user/conversation records)';
COMMENT ON VIEW user_payment_stats IS 'Aggregated payment statistics per user';
COMMENT ON FUNCTION cleanup_old_states IS 'Removes orphaned states older than specified days to prevent database bloat';
