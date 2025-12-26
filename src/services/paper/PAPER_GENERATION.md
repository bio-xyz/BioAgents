# Paper Generation API

## Overview

The Paper Generation API generates a LaTeX research paper from a Deep Research conversation, compiles it to PDF, and uploads it to object storage. The paper follows a structured format with specific sections derived from the conversation's discoveries.

## Endpoint

```
POST /api/deep-research/conversations/:conversationId/paper
```

## Authentication

**Required**: Yes (Classic JWT or x402 payment proof)

The authenticated user must be the owner of the conversation. Otherwise, a 403 Forbidden error is returned.

## Request

### Route Parameters
- `conversationId` (string, required): UUID of the conversation to generate a paper from

### Request Body
The request body is optional and can be empty.

### Example Request

```bash
curl -X POST https://your-domain.com/api/deep-research/conversations/123e4567-e89b-12d3-a456-426614174000/paper \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

## Response

### Success Response (200 OK)

```json
{
  "success": true,
  "paperId": "987fbc97-4bed-5078-9f07-9141ba07c9f3",
  "conversationId": "123e4567-e89b-12d3-a456-426614174000",
  "conversationStateId": "456e7890-e89b-12d3-a456-426614174111",
  "pdfPath": "papers/987fbc97-4bed-5078-9f07-9141ba07c9f3/paper.pdf",
  "pdfUrl": "https://storage.example.com/signed-url-to-pdf?expires=...",
  "sourceZipUrl": "https://storage.example.com/signed-url-to-source?expires=..."
}
```

### Error Responses

#### 401 Unauthorized
```json
{
  "error": "Authentication required",
  "message": "Valid authentication is required to generate papers"
}
```

#### 403 Forbidden
```json
{
  "error": "Access denied",
  "message": "You do not have permission to generate a paper for this conversation"
}
```

#### 404 Not Found
```json
{
  "error": "Resource not found",
  "message": "Conversation not found: 123e4567-e89b-12d3-a456-426614174000"
}
```

#### 500 Internal Server Error (Compilation Failed)
```json
{
  "error": "LaTeX compilation failed",
  "message": "LaTeX compilation failed:\n... error logs ...",
  "hint": "The paper content could not be compiled to PDF. Check the LaTeX syntax and citations."
}
```

## Paper Structure

The generated paper has the following sections in this exact order:

1. **Title**: "Deep Research Discovery Report: [objective]"
2. **Research Objective**: From `state.objective`
3. **Key Insights**: Bullet list from `state.keyInsights`
4. **Research Snapshot**: Combines `currentObjective`, `currentHypothesis`, and optionally `methodology`
5. **Summary of Discoveries**: Brief summary of all discoveries
6. **Discovery 1..N**: Each discovery gets 1-2 pages with subsections:
   - Background
   - Results & Discussion
   - Novelty
   - Tasks Used
7. **References**: BibTeX-derived citations

## Citation Policy

- Citations use DOI placeholders: `\cite{doi:10.xxxx/xxxxx}`
- Only DOIs found in task outputs are allowed
- DOIs are resolved to BibTeX via doi.org or Crossref API
- Citekeys are generated from DOIs (e.g., `doi_10_1234_nature`)
- If a DOI cannot be resolved, it is removed in a repair pass

## Figures & Artifacts

- Analysis task artifacts are automatically downloaded
- Only image files (png, jpg, jpeg, svg, pdf) are included
- Figures are named: `d{discoveryIndex}_{sanitizedName}.{ext}`
- Captions come from `artifact.description` or fallback to task reference
- LLM may only reference figures provided to it for each discovery

## Database Schema

A new `paper` table stores metadata:

```sql
CREATE TABLE public.paper (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  pdf_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Storage

Generated files are uploaded to the configured object storage:

- PDF: `papers/{paperId}/paper.pdf`
- Source ZIP: `papers/{paperId}/source.zip`

Both are accessible via signed URLs (expires in 1 hour).

## Environment Variables

Required:
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous key
- `STORAGE_PROVIDER`: Set to "s3"
- `AWS_ACCESS_KEY_ID`: S3/R2 access key
- `AWS_SECRET_ACCESS_KEY`: S3/R2 secret key
- `S3_BUCKET`: S3/R2 bucket name
- `AWS_REGION`: S3 region
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`: For LLM (discovery section generation)
- `LLM_PROVIDER`: "openai" or "anthropic" (default: "openai")
- `LLM_MODEL`: Model name (default: "gpt-4")

Optional:
- `ARTIFACT_BASE_URL`: Fallback URL for artifact downloads if storage provider is unavailable
- `S3_ENDPOINT`: Custom endpoint for S3-compatible storage (R2, MinIO, etc.)

## LaTeX Requirements

The server must have LaTeX installed:

**Preferred**: `latexmk` (handles multiple compilation passes automatically)

**Fallback**: `pdflatex` and `bibtex`

Ubuntu/Debian:
```bash
apt-get install texlive-latex-base texlive-latex-extra texlive-fonts-recommended latexmk
```

macOS:
```bash
brew install --cask mactex
```

## Implementation Details

### Service Architecture

```
src/services/paper/
├── types.ts              # TypeScript type definitions
├── generatePaper.ts      # Main orchestration service
├── prompts.ts            # LLM prompts for discovery sections
├── utils/
│   ├── escapeLatex.ts    # LaTeX character escaping
│   ├── doi.ts            # DOI extraction and normalization
│   ├── bibtex.ts         # BibTeX resolution and manipulation
│   ├── compile.ts        # PDF compilation (latexmk / pdflatex)
│   └── artifacts.ts      # Figure downloading from storage
```

### Route Handler

```
src/routes/deep-research/paper.ts
```

Handles POST requests, enforces authentication, validates ownership, and calls the main service.

### Workflow

1. Authenticate user and verify conversation ownership
2. Create `paper` DB record to get `paperId`
3. Create temp workspace: `os.tmpdir()/paper/{paperId}/`
4. Index tasks by `jobId`
5. Map discoveries to their allowed tasks
6. Write deterministic sections (title, objective, insights, snapshot, summary)
7. Download figures for all discoveries
8. Generate discovery sections with LLM (parallel, max 3 concurrent)
9. Assemble `main.tex`
10. Extract DOIs and resolve to BibTeX
11. Write `references.bib`
12. Rewrite citations from `doi:` placeholders to citekeys
13. Run repair pass if needed (remove unresolved DOIs)
14. Compile PDF with `latexmk` or `pdflatex+bibtex`
15. Create `source.zip` of LaTeX source
16. Upload PDF and source.zip to storage
17. Return signed URLs
18. Cleanup temp directory

### Error Handling

- On any error, the `paper` DB record is deleted (rollback)
- Temp directory is cleaned up in all cases (success or failure)
- Compilation errors include last 200 lines of LaTeX logs

## Migration

To apply the database migration:

```bash
# For Supabase
supabase migration up

# Or apply manually
psql $DATABASE_URL -f supabase/migrations/20251225000000_create_paper_table.sql
```

## Testing

Example curl request:

```bash
# Assuming you have a conversation with discoveries
export CONVERSATION_ID="your-conversation-uuid"
export JWT_TOKEN="your-jwt-token"

curl -X POST "http://localhost:3000/api/deep-research/conversations/$CONVERSATION_ID/paper" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -v

# Response will include pdfUrl and sourceZipUrl for download
```

## Limitations

- Synchronous operation (no job queue support)
- Large papers may timeout (consider increasing server timeout)
- Requires LaTeX installation on server
- One repair pass maximum (LLM may not always fix citation issues)
- PDF compilation failures are not retryable (must fix LaTeX manually)

## Future Enhancements

- Async job queue support for long papers
- Custom LaTeX templates
- Multiple papers per conversation
- Paper versioning
- Custom citation styles
- Support for additional artifact types (tables, code snippets)
