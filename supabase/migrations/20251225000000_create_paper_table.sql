-- Create paper table for storing generated research papers
-- Migration: 20251225000000_create_paper_table.sql

-- Create paper table
CREATE TABLE IF NOT EXISTS public.paper (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  pdf_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indices for faster lookups
CREATE INDEX IF NOT EXISTS idx_paper_user_id ON public.paper(user_id);
CREATE INDEX IF NOT EXISTS idx_paper_conversation_id ON public.paper(conversation_id);
CREATE INDEX IF NOT EXISTS idx_paper_created_at ON public.paper(created_at DESC);

-- Add unique constraint to ensure one paper per conversation (optional - remove if multiple papers per conversation allowed)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_conversation_id_unique ON public.paper(conversation_id);

-- Add comment
COMMENT ON TABLE public.paper IS 'Stores metadata for generated LaTeX research papers from Deep Research conversations';
COMMENT ON COLUMN public.paper.id IS 'Unique identifier for the paper (used as paperId in responses)';
COMMENT ON COLUMN public.paper.user_id IS 'User who owns this paper';
COMMENT ON COLUMN public.paper.conversation_id IS 'Conversation this paper was generated from';
COMMENT ON COLUMN public.paper.pdf_path IS 'Storage path/key for the PDF in S3/R2 (e.g., papers/{paperId}/paper.pdf)';
COMMENT ON COLUMN public.paper.created_at IS 'When the paper was generated';
COMMENT ON COLUMN public.paper.updated_at IS 'Last update timestamp';

-- Add trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_paper_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_paper_updated_at
  BEFORE UPDATE ON public.paper
  FOR EACH ROW
  EXECUTE FUNCTION update_paper_updated_at();
