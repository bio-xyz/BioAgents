UPDATE "public"."messages"
SET "source_selection_id" = NULL
WHERE "source_selection_id" = 'alphafold_model';

ALTER TABLE "public"."messages"
DROP CONSTRAINT IF EXISTS "messages_source_selection_id_check";

ALTER TABLE "public"."messages"
ADD CONSTRAINT "messages_source_selection_id_check"
CHECK (
  "source_selection_id" IS NULL
  OR "source_selection_id" = ANY (
    ARRAY[
      'alphafold_db'::text,
      'uniprot'::text,
      'pdb'::text,
      'pubmed'::text,
      'chembl'::text,
      'ensembl'::text,
      'enrichr'::text,
      'clinical-trials'::text,
      'open_targets'::text
    ]
  )
);
