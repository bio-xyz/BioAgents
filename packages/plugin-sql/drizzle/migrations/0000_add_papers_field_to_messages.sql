-- Enable pgvector extension for vector operations
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns 
    WHERE table_name = 'central_messages'
      AND column_name = 'papers'
  ) THEN
    ALTER TABLE central_messages
    ADD COLUMN papers jsonb DEFAULT '[]'::jsonb;
  END IF;
END;
$$;