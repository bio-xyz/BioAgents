-- Add status tracking to messages for crash recovery and orphan cleanup.
-- Three states: PENDING (in flight), COMPLETE (durable reply saved), FAILED
-- (terminal error or backend crashed before reply landed).

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_status_check'
  ) THEN
    ALTER TABLE public.messages
    ADD CONSTRAINT messages_status_check
    CHECK (status IN ('PENDING', 'COMPLETE', 'FAILED'));

    -- Backfill runs exactly once, gated by the constraint-added branch above
    -- so re-running this migration won't flip in-flight production rows.
    UPDATE public.messages
    SET status = CASE
      WHEN content IS NOT NULL AND content <> '' THEN 'COMPLETE'
      ELSE 'FAILED'
    END
    WHERE status = 'PENDING';
  END IF;
END $$;

-- Partial index lets the periodic sweeper scan stuck-pending rows fast
-- without bloating the index for the common COMPLETE case.
CREATE INDEX IF NOT EXISTS idx_messages_status_pending
ON public.messages (created_at)
WHERE status = 'PENDING';
