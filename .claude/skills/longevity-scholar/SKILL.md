---
name: longevity-scholar
description: This skill should be used when users explicitly request academic papers, recent research, most cited research, or scholarly articles about longevity, aging, lifespan extension, or related topics. Triggers on phrases like "find papers on", "latest research about", "most cited studies on", or "academic literature about" in the context of longevity.
---

# Longevity Scholar Skill

## Purpose

This skill enables targeted searches of longevity and aging research using the Semantic Scholar API. It provides a simple, focused interface for finding relevant academic papers and synthesizing research findings into natural language responses.

## When to Use This Skill

Use this skill when users **explicitly request** academic papers about longevity topics, including:

- Latest/recent research findings on longevity experiments
- Most cited research papers on longevity interventions
- Papers by specific longevity researchers
- Relevant research papers testing specific compounds or organisms
- Academic literature on aging, lifespan extension, healthspan, etc.

**Trigger phrases:**
- "What are the latest findings on..."
- "What are the most cited research papers on..."
- "What are the most recent research papers on..."
- "What are the most relevant research papers on..."
- "Find papers about..."
- "Show me research on..."

**Do NOT trigger** on general questions about longevity that don't explicitly request academic papers or research.

## How to Use This Skill

### Step 1: Understand the Query

Parse the user's request to identify:
1. **Main topic** (e.g., "longevity experiments on mice")
2. **Filters** (e.g., "most cited", "recent", "past 2 weeks", "by Aubrey De Grey")
3. **Specific focus** (e.g., "rapamycin", "flies", "caloric restriction")

**Important: Handle date-based queries**

When users request papers from specific time periods (e.g., "past 2 weeks", "last month", "recent papers"), calculate the appropriate date range:

1. **Check current date** from the `<env>` block at the start of the conversation
2. **Calculate the start date** based on the time period requested:
   - "Past 2 weeks" → subtract 14 days from current date
   - "Past month" → subtract 30 days from current date
   - "Past 3 months" → subtract 90 days from current date
   - "Recent" or "latest" (no specific period) → use past 2-3 years
3. **Format as YYYY-MM-DD:** for the --date-filter parameter

Example: If today is 2025-10-24 and user asks for "papers from the past 2 weeks":
- Calculate: 2025-10-24 minus 14 days = 2025-10-10
- Use: `--date-filter "2025-10-10:"`

### Step 2: Formulate Three Search Queries

Create THREE increasingly refined search queries for the topic. Each query should approach the topic from a slightly different angle to maximize the chance of finding relevant papers.

**Example for "latest findings on longevity experiments ran on mice":**
1. Query 1: `longevity mice experiments lifespan`
2. Query 2: `aging interventions mouse model longevity`
3. Query 3: `life extension mice experimental studies`

**Example for "most cited research on rapamycin longevity":**
1. Query 1: `rapamycin longevity lifespan extension`
2. Query 2: `mTOR inhibition aging rapamycin`
3. Query 3: `rapamycin anti-aging effects`

### Step 3: Execute Search with Retry Logic

Use the provided `query_longevity_papers.py` script to:
1. Try the first query
2. If it fails or returns no results, try the second query
3. If that fails, try the third query
4. If all fail, report to the user

**Command format:**
```bash
python3 scripts/query_longevity_papers.py \
  --queries "query1" "query2" "query3" \
  --limit 10 \
  --offset 0
```

**Optional filters:**
- `--year-filter YYYY` - Only papers from YYYY onwards (e.g., "2020-" for 2020+)
- `--date-filter YYYY-MM-DD:` - Papers from specific date onwards (more precise than year-filter)
  - Format: "YYYY-MM-DD:" for open-ended range (e.g., "2025-10-10:" for Oct 10 onwards)
  - Format: "YYYY-MM-DD:YYYY-MM-DD" for specific range (e.g., "2025-01-01:2025-12-31")
- `--sort citations` - Sort by citation count (for "most cited" requests)
- `--sort recent` - Sort by publication date (for "recent" requests, default behavior)

**When to use date-filter vs year-filter:**
- Use `--date-filter` for granular time periods: "past 2 weeks", "last month", "past 3 months"
- Use `--year-filter` for broader time periods: "since 2020", "from 2015 to 2020"

### Step 4: Analyze and Synthesize Results

Review the returned papers and:
1. Identify the most relevant papers for the user's question
2. Synthesize key findings from titles, abstracts, and metadata
3. Note patterns, trends, or important insights
4. Organize by relevance, citations, or recency as appropriate

### Step 5: Present Natural Language Answer

Provide a comprehensive natural language response that:

1. **Directly answers the user's question** with synthesized insights
2. **Highlights key findings** from the most relevant papers
3. **Provides context** such as:
   - Publication dates and trends
   - Citation counts and impact
   - Experimental models or methods
   - Key researchers in the area
4. **Ends with a citation list** in this exact format:

```
Science papers:
1. [Paper Title 1] - URL: [url or "N/A"], Citations: [count], Abstract: [abstract or "N/A"]
2. [Paper Title 2] - URL: [url or "N/A"], Citations: [count], Abstract: [abstract or "N/A"]
...
```

**IMPORTANT:** Always include the Abstract field for each paper. If the abstract is available in the search results, include it. If not available, use "N/A".

### Example Response Format

```
Based on recent research, longevity experiments in mice have shown promising results
with several interventions. The most notable findings include:

[2-3 paragraphs synthesizing the research findings]

Key experimental approaches include caloric restriction, mTOR inhibition, and
NAD+ precursor supplementation, with studies showing lifespan extensions ranging
from 10-30% in various mouse models.

Recent work by researchers at institutions like Harvard Medical School and
the Buck Institute has focused on combinatorial approaches, testing multiple
interventions simultaneously.

Science papers:
1. Rapamycin extends lifespan in genetically heterogeneous mice - URL: https://www.semanticscholar.org/paper/abc123, Citations: 1247, Abstract: Rapamycin is a specific inhibitor of the mechanistic target of rapamycin (mTOR), which plays a central role in cell growth and metabolism. This study demonstrates that rapamycin extends median and maximal lifespan in genetically heterogeneous mice when fed beginning at 600 days of age.
2. Caloric restriction delays disease onset in rhesus monkeys - URL: https://www.semanticscholar.org/paper/def456, Citations: 892, Abstract: Caloric restriction (CR) extends lifespan in many species. We report findings of a 20-year longitudinal adult-onset CR study in rhesus monkeys aimed at filling the knowledge gap of CR effects in a long-lived nonhuman primate.
3. NAD+ metabolism and age-related diseases - URL: https://www.semanticscholar.org/paper/ghi789, Citations: 634, Abstract: NAD+ levels decline during aging in multiple tissues. This decline has been linked to several age-related diseases and may represent a key factor in aging itself.
```

## Important Notes

- **Always use all three query attempts** before reporting failure
- **Be specific in synthesis** - don't just list papers, extract insights
- **Include URLs when available** for easy paper lookup
- **Note if papers are recent** (last 2-3 years) vs foundational (highly cited)
- **Acknowledge limitations** if search results are sparse
- **Default limit is 10 papers** but can adjust based on user needs

## Script Reference

The skill includes `scripts/query_longevity_papers.py` which:
- Queries the Semantic Scholar API search endpoint
- Implements retry logic with multiple query formulations
- Supports filtering by year and sorting by citations/date
- Returns structured JSON with paper metadata
- Handles API rate limits and errors gracefully

Refer to the script's `--help` output for full parameter documentation.
