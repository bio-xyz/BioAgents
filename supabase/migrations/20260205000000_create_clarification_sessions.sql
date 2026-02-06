-- Create clarification_sessions table for pre-research clarification flow
-- This table stores clarification questions, answers, and approved plans before deep research starts

-- Create enum type for clarification session status
DO $$ BEGIN
    CREATE TYPE "public"."clarification_status" AS ENUM (
        'questions_generated',
        'answers_submitted',
        'plan_generated',
        'plan_approved',
        'abandoned'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "public"."clarification_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid", -- Nullable: linked when deep research starts
    "initial_query" "text" NOT NULL,
    "questions" "jsonb" NOT NULL DEFAULT '[]'::jsonb,
    "answers" "jsonb" DEFAULT '[]'::jsonb,
    "plan" "jsonb" DEFAULT NULL,
    "plan_feedback" "jsonb" DEFAULT '[]'::jsonb,
    "status" "public"."clarification_status" NOT NULL DEFAULT 'questions_generated',
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clarification_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clarification_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
    CONSTRAINT "clarification_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL
);

ALTER TABLE "public"."clarification_sessions" OWNER TO "postgres";

COMMENT ON TABLE "public"."clarification_sessions" IS 'Stores pre-research clarification flow: questions, answers, and approved plans';

COMMENT ON COLUMN "public"."clarification_sessions"."user_id" IS 'User who initiated the clarification session';
COMMENT ON COLUMN "public"."clarification_sessions"."conversation_id" IS 'Linked conversation (set when deep research starts with approved plan)';
COMMENT ON COLUMN "public"."clarification_sessions"."initial_query" IS 'Original research query from user';
COMMENT ON COLUMN "public"."clarification_sessions"."questions" IS 'Array of clarification questions: [{category, question, priority, context?}]';
COMMENT ON COLUMN "public"."clarification_sessions"."answers" IS 'Array of user answers: [{questionIndex, answer}]';
COMMENT ON COLUMN "public"."clarification_sessions"."plan" IS 'Generated research plan: {objective, approach, initialTasks[], estimatedIterations, constraints[]}';
COMMENT ON COLUMN "public"."clarification_sessions"."plan_feedback" IS 'Array of plan feedback entries: [{feedback, previousPlan, regeneratedPlan?, timestamp, approved}]';
COMMENT ON COLUMN "public"."clarification_sessions"."status" IS 'Current status of the clarification session';

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS "idx_clarification_sessions_user_id" ON "public"."clarification_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_clarification_sessions_conversation_id" ON "public"."clarification_sessions" ("conversation_id") WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_clarification_sessions_status" ON "public"."clarification_sessions" ("status");
CREATE INDEX IF NOT EXISTS "idx_clarification_sessions_created_at" ON "public"."clarification_sessions" ("created_at");

-- Enable RLS (Row Level Security) - matching pattern of other tables
ALTER TABLE "public"."clarification_sessions" ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for now (service role bypasses RLS anyway)
DROP POLICY IF EXISTS "Allow all operations on clarification_sessions" ON "public"."clarification_sessions";
CREATE POLICY "Allow all operations on clarification_sessions" ON "public"."clarification_sessions"
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_clarification_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_clarification_sessions_updated_at ON "public"."clarification_sessions";
CREATE TRIGGER trigger_update_clarification_sessions_updated_at
    BEFORE UPDATE ON "public"."clarification_sessions"
    FOR EACH ROW
    EXECUTE FUNCTION update_clarification_sessions_updated_at();
