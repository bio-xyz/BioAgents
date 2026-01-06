-- Add job tracking columns to paper table for async paper generation
-- Migration: 20260106000000_add_paper_job_tracking.sql

-- Add status column for tracking async job state
-- Default to 'completed' for backwards compatibility with existing papers
ALTER TABLE public.paper
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

-- Add job_id column for BullMQ job tracking
ALTER TABLE public.paper
ADD COLUMN IF NOT EXISTS job_id TEXT;

-- Add error column for storing failure reasons
ALTER TABLE public.paper
ADD COLUMN IF NOT EXISTS error TEXT;

-- Add progress tracking column (JSON: { stage: string, percent: number })
ALTER TABLE public.paper
ADD COLUMN IF NOT EXISTS progress JSONB;

-- Add index for user + status queries (for concurrency check: 1 job per user)
CREATE INDEX IF NOT EXISTS idx_paper_user_status ON public.paper(user_id, status);

-- Add index for job_id lookups
CREATE INDEX IF NOT EXISTS idx_paper_job_id ON public.paper(job_id);

-- Add comments
COMMENT ON COLUMN public.paper.status IS 'Job status: pending (queued), processing (in worker), completed, failed';
COMMENT ON COLUMN public.paper.job_id IS 'BullMQ job ID for tracking (same as paperId)';
COMMENT ON COLUMN public.paper.error IS 'Error message if job failed';
COMMENT ON COLUMN public.paper.progress IS 'Progress tracking: { stage: string, percent: number }';
