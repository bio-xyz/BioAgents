-- Create token_usage table to track LLM token consumption
-- Supports both message-based (chat, deep-research) and paper-based (paper-generation) tracking

-- Create enum type for usage context (if not exists)
DO $$ BEGIN
    CREATE TYPE "public"."token_usage_type" AS ENUM ('chat', 'deep-research', 'paper-generation');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "public"."token_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid", -- Nullable: set for chat/deep-research, NULL for paper-generation
    "paper_id" "uuid", -- Nullable: set for paper-generation, NULL for chat/deep-research
    "type" "public"."token_usage_type" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_tokens" integer NOT NULL,
    "completion_tokens" integer NOT NULL,
    "total_tokens" integer NOT NULL,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "token_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "token_usage_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE,
    CONSTRAINT "token_usage_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "public"."paper"("id") ON DELETE CASCADE,
    -- Ensure at least one reference is set
    CONSTRAINT "token_usage_has_reference" CHECK (
        (message_id IS NOT NULL) OR (paper_id IS NOT NULL)
    )
);

ALTER TABLE "public"."token_usage" OWNER TO "postgres";

COMMENT ON TABLE "public"."token_usage" IS 'Tracks LLM token usage for cost analysis across chat, deep-research, and paper-generation';

COMMENT ON COLUMN "public"."token_usage"."message_id" IS 'Message reference for chat/deep-research (NULL for paper-generation)';
COMMENT ON COLUMN "public"."token_usage"."paper_id" IS 'Paper reference for paper-generation (NULL for chat/deep-research)';
COMMENT ON COLUMN "public"."token_usage"."type" IS 'Usage context: chat, deep-research, or paper-generation';
COMMENT ON COLUMN "public"."token_usage"."provider" IS 'LLM provider (anthropic, google, openai, openrouter)';
COMMENT ON COLUMN "public"."token_usage"."model" IS 'Model identifier (e.g., claude-opus-4-5-20251101, gemini-2.5-pro)';
COMMENT ON COLUMN "public"."token_usage"."prompt_tokens" IS 'Number of input/prompt tokens';
COMMENT ON COLUMN "public"."token_usage"."completion_tokens" IS 'Number of output/completion tokens';
COMMENT ON COLUMN "public"."token_usage"."total_tokens" IS 'Total tokens (prompt + completion)';
COMMENT ON COLUMN "public"."token_usage"."duration_ms" IS 'Request duration in milliseconds';

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS "idx_token_usage_message_id" ON "public"."token_usage" ("message_id") WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_token_usage_paper_id" ON "public"."token_usage" ("paper_id") WHERE paper_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_token_usage_type" ON "public"."token_usage" ("type");
CREATE INDEX IF NOT EXISTS "idx_token_usage_provider_model" ON "public"."token_usage" ("provider", "model");
CREATE INDEX IF NOT EXISTS "idx_token_usage_created_at" ON "public"."token_usage" ("created_at");

-- Enable RLS (Row Level Security) - matching pattern of other tables
ALTER TABLE "public"."token_usage" ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for now (can be restricted later)
DROP POLICY IF EXISTS "Allow all operations on token_usage" ON "public"."token_usage";
CREATE POLICY "Allow all operations on token_usage" ON "public"."token_usage"
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- COST CALCULATION FUNCTIONS
-- ============================================================================

-- Model pricing table (costs per 1M tokens in USD)
-- This function returns pricing for known models
-- p_prompt_tokens is used for models with context-length-based pricing (e.g., Gemini 2.5 Pro)
CREATE OR REPLACE FUNCTION get_model_pricing(p_provider TEXT, p_model TEXT, p_prompt_tokens INTEGER DEFAULT 0)
RETURNS TABLE (input_cost_per_million NUMERIC, output_cost_per_million NUMERIC) AS $$
BEGIN
    RETURN QUERY
    SELECT
        CASE
            -- Anthropic models
            WHEN p_model ILIKE '%opus%' THEN 5.00
            WHEN p_model ILIKE '%sonnet%' THEN 3.00
            -- Google models (Gemini 2.5 Pro has conditional pricing based on prompt size)
            WHEN p_model ILIKE '%gemini-2.5-pro%' THEN
                CASE WHEN p_prompt_tokens > 200000 THEN 2.50 ELSE 1.25 END
            -- OpenAI models
            WHEN p_model ILIKE '%gpt-5%' THEN 1.75
            ELSE 1.00 -- Default fallback
        END::NUMERIC AS input_cost,
        CASE
            -- Anthropic models
            WHEN p_model ILIKE '%opus%' THEN 25.00
            WHEN p_model ILIKE '%sonnet%' THEN 15.00
            -- Google models (Gemini 2.5 Pro has conditional pricing based on prompt size)
            WHEN p_model ILIKE '%gemini-2.5-pro%' THEN
                CASE WHEN p_prompt_tokens > 200000 THEN 15.00 ELSE 10.00 END
            -- OpenAI models
            WHEN p_model ILIKE '%gpt-5%' THEN 14.00
            ELSE 3.00 -- Default fallback
        END::NUMERIC AS output_cost;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Calculate cost for a single token_usage record
CREATE OR REPLACE FUNCTION calculate_token_cost(
    p_provider TEXT,
    p_model TEXT,
    p_prompt_tokens INTEGER,
    p_completion_tokens INTEGER
) RETURNS NUMERIC AS $$
DECLARE
    v_pricing RECORD;
BEGIN
    SELECT * INTO v_pricing FROM get_model_pricing(p_provider, p_model, p_prompt_tokens);

    RETURN (
        (p_prompt_tokens::NUMERIC / 1000000.0 * v_pricing.input_cost_per_million) +
        (p_completion_tokens::NUMERIC / 1000000.0 * v_pricing.output_cost_per_million)
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- ANALYTICS VIEWS AND FUNCTIONS
-- ============================================================================

-- View: Token usage with calculated costs and user info
CREATE OR REPLACE VIEW token_usage_with_costs AS
SELECT
    tu.id,
    tu.message_id,
    tu.paper_id,
    tu.type,
    tu.provider,
    tu.model,
    tu.prompt_tokens,
    tu.completion_tokens,
    tu.total_tokens,
    tu.duration_ms,
    tu.created_at,
    -- Get user_id from either messages or paper
    COALESCE(m.user_id, p.user_id) AS user_id,
    -- Calculate cost
    calculate_token_cost(tu.provider, tu.model, tu.prompt_tokens, tu.completion_tokens) AS cost_usd
FROM token_usage tu
LEFT JOIN messages m ON tu.message_id = m.id
LEFT JOIN paper p ON tu.paper_id = p.id;

-- Function: Get average cost per request by type
CREATE OR REPLACE FUNCTION get_avg_cost_per_request_by_type()
RETURNS TABLE (
    usage_type token_usage_type,
    avg_cost_usd NUMERIC,
    total_requests BIGINT,
    total_cost_usd NUMERIC,
    avg_prompt_tokens NUMERIC,
    avg_completion_tokens NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tu.type AS usage_type,
        ROUND(AVG(calculate_token_cost(tu.provider, tu.model, tu.prompt_tokens, tu.completion_tokens)), 6) AS avg_cost_usd,
        COUNT(DISTINCT COALESCE(tu.message_id, tu.paper_id)) AS total_requests,
        ROUND(SUM(calculate_token_cost(tu.provider, tu.model, tu.prompt_tokens, tu.completion_tokens)), 4) AS total_cost_usd,
        ROUND(AVG(tu.prompt_tokens), 0) AS avg_prompt_tokens,
        ROUND(AVG(tu.completion_tokens), 0) AS avg_completion_tokens
    FROM token_usage tu
    GROUP BY tu.type
    ORDER BY tu.type;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get average cost per user request by type
-- Groups by user and type, shows average cost per request for each user
CREATE OR REPLACE FUNCTION get_avg_cost_per_user_by_type()
RETURNS TABLE (
    user_id UUID,
    usage_type token_usage_type,
    avg_cost_per_request NUMERIC,
    total_requests BIGINT,
    total_cost_usd NUMERIC,
    total_prompt_tokens BIGINT,
    total_completion_tokens BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tuc.user_id,
        tuc.type AS usage_type,
        ROUND(tuc.total_cost / NULLIF(tuc.request_count, 0), 6) AS avg_cost_per_request,
        tuc.request_count AS total_requests,
        ROUND(tuc.total_cost, 4) AS total_cost_usd,
        tuc.sum_prompt_tokens AS total_prompt_tokens,
        tuc.sum_completion_tokens AS total_completion_tokens
    FROM (
        SELECT
            COALESCE(m.user_id, p.user_id) AS user_id,
            tu.type,
            COUNT(DISTINCT COALESCE(tu.message_id, tu.paper_id)) AS request_count,
            SUM(calculate_token_cost(tu.provider, tu.model, tu.prompt_tokens, tu.completion_tokens)) AS total_cost,
            SUM(tu.prompt_tokens) AS sum_prompt_tokens,
            SUM(tu.completion_tokens) AS sum_completion_tokens
        FROM token_usage tu
        LEFT JOIN messages m ON tu.message_id = m.id
        LEFT JOIN paper p ON tu.paper_id = p.id
        GROUP BY COALESCE(m.user_id, p.user_id), tu.type
    ) tuc
    WHERE tuc.user_id IS NOT NULL
    ORDER BY tuc.user_id, usage_type;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get overall average cost across all users per type
CREATE OR REPLACE FUNCTION get_overall_avg_cost_per_type()
RETURNS TABLE (
    usage_type token_usage_type,
    num_users BIGINT,
    avg_cost_per_user NUMERIC,
    avg_requests_per_user NUMERIC,
    avg_cost_per_request NUMERIC,
    total_cost_usd NUMERIC,
    total_requests BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        stats.type AS usage_type,
        COUNT(DISTINCT stats.user_id) AS num_users,
        ROUND(SUM(stats.user_total_cost) / NULLIF(COUNT(DISTINCT stats.user_id), 0), 4) AS avg_cost_per_user,
        ROUND(SUM(stats.user_request_count)::NUMERIC / NULLIF(COUNT(DISTINCT stats.user_id), 0), 2) AS avg_requests_per_user,
        ROUND(SUM(stats.user_total_cost) / NULLIF(SUM(stats.user_request_count), 0), 6) AS avg_cost_per_request,
        ROUND(SUM(stats.user_total_cost), 4) AS total_cost_usd,
        SUM(stats.user_request_count)::BIGINT AS total_requests
    FROM (
        SELECT
            COALESCE(m.user_id, p.user_id) AS user_id,
            tu.type,
            COUNT(DISTINCT COALESCE(tu.message_id, tu.paper_id)) AS user_request_count,
            SUM(calculate_token_cost(tu.provider, tu.model, tu.prompt_tokens, tu.completion_tokens)) AS user_total_cost
        FROM token_usage tu
        LEFT JOIN messages m ON tu.message_id = m.id
        LEFT JOIN paper p ON tu.paper_id = p.id
        WHERE COALESCE(m.user_id, p.user_id) IS NOT NULL
        GROUP BY COALESCE(m.user_id, p.user_id), tu.type
    ) stats
    GROUP BY stats.type
    ORDER BY stats.type;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get cost breakdown by model for a specific type
CREATE OR REPLACE FUNCTION get_cost_by_model(p_type token_usage_type DEFAULT NULL)
RETURNS TABLE (
    usage_type token_usage_type,
    provider TEXT,
    model TEXT,
    total_calls BIGINT,
    total_prompt_tokens BIGINT,
    total_completion_tokens BIGINT,
    total_cost_usd NUMERIC,
    avg_cost_per_call NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tu.type AS usage_type,
        tu.provider,
        tu.model,
        COUNT(*) AS total_calls,
        SUM(tu.prompt_tokens) AS total_prompt_tokens,
        SUM(tu.completion_tokens) AS total_completion_tokens,
        ROUND(SUM(calculate_token_cost(tu.provider, tu.model, tu.prompt_tokens, tu.completion_tokens)), 4) AS total_cost_usd,
        ROUND(AVG(calculate_token_cost(tu.provider, tu.model, tu.prompt_tokens, tu.completion_tokens)), 6) AS avg_cost_per_call
    FROM token_usage tu
    WHERE p_type IS NULL OR tu.type = p_type
    GROUP BY tu.type, tu.provider, tu.model
    ORDER BY total_cost_usd DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get daily cost summary
CREATE OR REPLACE FUNCTION get_daily_cost_summary(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    day DATE,
    usage_type token_usage_type,
    total_requests BIGINT,
    total_cost_usd NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        DATE(tu.created_at) AS day,
        tu.type AS usage_type,
        COUNT(DISTINCT COALESCE(tu.message_id, tu.paper_id)) AS total_requests,
        ROUND(SUM(calculate_token_cost(tu.provider, tu.model, tu.prompt_tokens, tu.completion_tokens)), 4) AS total_cost_usd
    FROM token_usage tu
    WHERE tu.created_at >= NOW() - (p_days || ' days')::INTERVAL
    GROUP BY DATE(tu.created_at), tu.type
    ORDER BY day DESC, tu.type;
END;
$$ LANGUAGE plpgsql STABLE;
