# Paper Generation Pipeline

## Overview

Generates a PDF research paper from a Deep Research conversation using a **Markdown → Pandoc → LaTeX → PDF** pipeline. The LLM writes Markdown with Pandoc citation syntax (`[@key]`), Pandoc converts to LaTeX with natbib citations, and XeLaTeX compiles the final PDF.

## Pipeline Stages

```
1. Validate conversation ownership
2. Index tasks by jobId, map discoveries → evidence tasks
3. Extract references (DOIs, PMC, PMID, ArXiv, URLs) from task outputs
4. Fetch BibTeX for DOIs via doi.org / Crossref → write refs.bib
5. Extract available citation keys for LLM prompts
6. LLM: Generate front matter (title, abstract, research snapshot)
7. LLM: Generate background section (with citations)
8. Download figure artifacts from ANALYSIS tasks
9. LLM: Generate discovery sections (parallel, max 3 concurrent)
10. Assemble Markdown document with YAML frontmatter
11. Validate Markdown (strip unknown citations, check math balance)
12. Pandoc convert Markdown → LaTeX (.tex)
13. XeLaTeX + BibTeX compile → PDF
14. Upload PDF + .tex to storage
15. Cleanup temp directory
```

## Endpoints

### Sync (blocking)
```
POST /api/deep-research/conversations/:conversationId/paper
```
Returns `{ paperId, pdfUrl, rawLatexUrl }` when complete.

### Async (queue-based, requires `USE_JOB_QUEUE=true`)
```
POST /api/deep-research/conversations/:conversationId/paper/async
```
Returns `202 Accepted` with `{ paperId, statusUrl }`. Poll status at:
```
GET /api/deep-research/paper/:paperId/status
```

### Other
```
GET /api/deep-research/paper/:paperId          — Get paper with fresh presigned URLs
GET /api/deep-research/conversations/:id/papers — List all papers for a conversation
```

All endpoints require authentication.

## Paper Structure

1. **Title** — LLM-generated, max 15 words
2. **Abstract** — LLM-generated, 150-200 words
3. **Research Snapshot** — Current objective, hypothesis, approach
4. **Background** — LLM-generated introduction with literature citations
5. **Key Insights** — Bullet list from conversation state
6. **Summary of Discoveries** — One-line summary per discovery
7. **Discovery 1..N** — Each gets 1-2 pages with subsections:
   - Background
   - Results & Discussion (with figures)
   - Novelty
   - Tasks Used
8. **References** — BibTeX-derived bibliography (natbib, numerical)

## Citation Pipeline

1. **Reference extraction** (`bib/extractRefs.ts`): Scans task outputs for DOIs, PMC/PMID links, ArXiv, ClinicalTrials.gov, and generic URLs
2. **BibTeX resolution** (`utils/bibtex.ts`): DOIs resolved via doi.org (with Crossref fallback). Non-DOI refs become `@misc` entries
3. **Citation keys** (`bib/extractKeys.ts`): Extracts key + metadata from BibTeX entries, injected into LLM prompts so the model knows which `[@key]` citations are valid
4. **Validation** (`markdown/validateMarkdown.ts`): Strips unknown `[@key]` references, replaces raw URL citations with proper `[@key]` syntax
5. **Pandoc** converts `[@key]` → `\citep{key}` (natbib)

Citation key format:
- DOI refs: `doi_10_1234_nature_12345`
- PMC: `pmc_12345`
- PMID: `pmid_99999`
- ArXiv: `arxiv_2401_12345`
- URL refs: `url_<hash>`

## Figures

- Only ANALYSIS task artifacts with image extensions (png, jpg, jpeg, gif, webp)
- Downloaded to `figures/d{discoveryIndex}_{sanitizedName}.{ext}`
- For Anthropic Claude: images are base64-encoded and sent as vision content
- For other providers: text-only prompts, figures referenced by filename
- LLM writes `![caption](figures/filename.png)` → Pandoc converts to `\includegraphics`

## File Structure

```
src/services/paper/
├── generatePaper.ts           # Main orchestration (single entry point)
├── types.ts                   # Type definitions
├── prompts.ts                 # LLM prompt builders
├── bib/
│   ├── fetchBibtex.ts         # Fetch BibTeX + write refs.bib
│   ├── extractRefs.ts         # Extract DOIs/URLs from task text
│   └── extractKeys.ts         # Extract citation key metadata for prompts
├── convert/
│   └── pandocConvert.ts       # Markdown → LaTeX via Pandoc (60s timeout)
├── markdown/
│   ├── assembleMarkdown.ts    # YAML frontmatter + body assembly
│   └── validateMarkdown.ts    # Citation validation, math balance check
└── utils/
    ├── bibtex.ts              # DOI resolution, dedup, citekey sanitization
    ├── compile.ts             # XeLaTeX compilation (latexmk or manual 3-pass)
    ├── artifacts.ts           # Figure downloading from storage
    ├── doi.ts                 # DOI normalization and validation
    └── textUtils.ts           # Filename sanitization, text truncation
```

## Environment Variables

### Required
```bash
PAPER_GEN_LLM_PROVIDER=openai|anthropic|google   # Default: openai
PAPER_GEN_LLM_MODEL=gpt-4o|claude-3-5-sonnet|... # Default: gpt-4o
OPENAI_API_KEY=           # Or ANTHROPIC_API_KEY / GOOGLE_API_KEY
STORAGE_PROVIDER=s3       # For PDF + .tex upload
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=
AWS_REGION=
```

### Optional
```bash
AGENT_NAME=BioAgent           # Appears as co-author
AGENT_EMAIL=research@bio.xyz  # Appears in author line
MAX_CONCURRENT_PAPER_JOBS=3   # Global limit for async queue
ARTIFACT_BASE_URL=            # Fallback URL for figure downloads
```

## System Requirements

**XeLaTeX** (not pdflatex) is required for native Unicode support (Greek letters, accented chars).

**Pandoc** converts Markdown → LaTeX with `--standalone --natbib --bibliography`.

```bash
# Ubuntu/Debian (also in Dockerfile)
apt-get install texlive-xetex texlive-latex-extra texlive-fonts-recommended latexmk pandoc

# macOS
brew install --cask mactex && brew install pandoc
```

## Timeouts

| Process | Timeout | Notes |
|---------|---------|-------|
| Pandoc | 60s | Kills process on hang |
| latexmk | 120s | Full multi-pass compilation |
| xelatex (per pass) | 60s | Manual fallback: 3 passes |
| bibtex | 60s | Single pass |
| DOI fetch (per request) | 10s | 3 retries with exponential backoff |

## Error Handling

- On any error, the paper DB record is deleted (rollback) and temp directory is cleaned
- DOI resolution failures are skipped (paper still generates with fewer citations)
- LLM calls retry once on JSON parse failure (front matter, background, and discovery sections)
- LaTeX compilation falls back from latexmk to manual 3-pass (xelatex + bibtex)
- Compilation errors include last 200 lines of LaTeX logs

## Database

```sql
CREATE TABLE public.paper (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  pdf_path TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending | processing | completed | failed
  progress TEXT,                   -- Current stage (for async tracking)
  error TEXT,                      -- Error message (for failed status)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Async Queue Flow

When `USE_JOB_QUEUE=true`:
1. Route handler pre-creates paper record with `pending` status
2. Job enqueued to BullMQ `paper-generation` queue
3. Worker picks up job, calls `generatePaperFromConversation()` with progress callback
4. Progress callback updates paper record status at each stage
5. On completion: status → `completed`, presigned URLs available via status endpoint
6. On failure: status → `failed`, error message stored

Limits: 1 concurrent job per user, 3 globally (configurable via `MAX_CONCURRENT_PAPER_JOBS`).
