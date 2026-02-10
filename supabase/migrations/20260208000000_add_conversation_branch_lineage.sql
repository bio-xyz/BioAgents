-- Add optional lineage tracking for branched deep-research conversations
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS parent_conversation_id uuid;

CREATE INDEX IF NOT EXISTS idx_conversations_parent_conversation_id
ON public.conversations(parent_conversation_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_parent_conversation_id_fkey'
  ) THEN
    ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_parent_conversation_id_fkey
    FOREIGN KEY (parent_conversation_id)
    REFERENCES public.conversations(id)
    ON DELETE SET NULL;
  END IF;
END $$;
