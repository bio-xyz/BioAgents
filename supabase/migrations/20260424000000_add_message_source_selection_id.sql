ALTER TABLE "public"."messages"
ADD COLUMN "source_selection_id" "text";

ALTER TABLE "public"."messages"
ADD CONSTRAINT "messages_source_selection_id_check"
CHECK (
  "source_selection_id" IS NULL
  OR "source_selection_id" = ANY (
    ARRAY['alphafold_db'::text, 'uniprot'::text, 'alphafold_model'::text]
  )
);

CREATE INDEX "idx_messages_source_selection_id"
ON "public"."messages" ("source_selection_id");

COMMENT ON COLUMN "public"."messages"."source_selection_id"
IS 'Optional per-message source routing selection from the slash selector.';
