-- Add updated_at column
ALTER TABLE public.credit_topups
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Update status constraint
ALTER TABLE public.credit_topups
  DROP CONSTRAINT IF EXISTS credit_topups_status_check;

ALTER TABLE public.credit_topups
  ADD CONSTRAINT credit_topups_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded'));

-- Refresh update trigger
DROP TRIGGER IF EXISTS update_credit_topups_updated_at ON public.credit_topups;

CREATE TRIGGER update_credit_topups_updated_at
  BEFORE UPDATE ON public.credit_topups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
