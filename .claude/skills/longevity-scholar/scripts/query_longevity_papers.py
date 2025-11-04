#!/usr/bin/env python3
"""
Semantic Scholar API Query Tool for Longevity Research
Implements retry logic with multiple query formulations
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import List, Dict, Optional, Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Load .env file from project root
try:
    from dotenv import load_dotenv
    # Find project root (4 levels up from this script)
    project_root = Path(__file__).parent.parent.parent.parent
    env_path = project_root / ".env"
    load_dotenv(dotenv_path=env_path)
except ImportError:
    # python-dotenv not installed, fall back to existing env vars
    pass


class SemanticScholarAPI:
    """Simple Semantic Scholar API client with retry logic"""

    BASE_URL = "https://api.semanticscholar.org/graph/v1"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
        self.headers = {}
        if self.api_key:
            self.headers["x-api-key"] = self.api_key

    def search_papers(
        self,
        query: str,
        limit: int = 10,
        offset: int = 0,
        year_filter: Optional[str] = None,
        date_filter: Optional[str] = None,
        sort: str = "recent"
    ) -> Dict[str, Any]:
        """
        Search for papers using the Semantic Scholar API

        Args:
            query: Search query string
            limit: Number of results to return (max 100)
            offset: Offset for pagination
            year_filter: Year range filter (e.g., "2020-" for 2020 onwards)
            date_filter: Date range filter (e.g., "2024-10-01:" for Oct 1 2024 onwards)
            sort: Sort order - "recent" or "citations"

        Returns:
            Dictionary with keys: total, offset, next, data
        """
        # Build query parameters
        params = {
            "query": query,
            "limit": min(limit, 100),
            "offset": offset,
            "fields": "paperId,title,abstract,authors,year,citationCount,publicationDate,url,venue"
        }

        # Use date_filter if provided (more precise), otherwise fall back to year_filter
        if date_filter:
            params["publicationDateOrYear"] = date_filter
        elif year_filter:
            params["year"] = year_filter

        # Note: The API endpoint is /paper/search, sorting is applied post-fetch
        url = f"{self.BASE_URL}/paper/search?{urlencode(params)}"

        try:
            request = Request(url, headers=self.headers)
            with urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode())

                # Apply sorting if needed
                if sort == "citations" and "data" in data:
                    data["data"] = sorted(
                        data["data"],
                        key=lambda x: x.get("citationCount", 0),
                        reverse=True
                    )

                return data

        except HTTPError as e:
            error_msg = e.read().decode() if e.fp else str(e)
            raise Exception(f"HTTP Error {e.code}: {error_msg}")
        except URLError as e:
            raise Exception(f"URL Error: {e.reason}")
        except Exception as e:
            raise Exception(f"Request failed: {str(e)}")


def query_with_retry(
    api: SemanticScholarAPI,
    queries: List[str],
    limit: int = 10,
    offset: int = 0,
    year_filter: Optional[str] = None,
    date_filter: Optional[str] = None,
    sort: str = "recent",
    verbose: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Try multiple queries in sequence until one succeeds

    Args:
        api: SemanticScholarAPI instance
        queries: List of query strings to try
        limit: Number of results per query
        offset: Offset for pagination
        year_filter: Year range filter
        date_filter: Date range filter (YYYY-MM-DD format)
        sort: Sort order
        verbose: Print status messages

    Returns:
        API response dict or None if all queries fail
    """
    for i, query in enumerate(queries, 1):
        if verbose:
            print(f"Attempting query {i}/{len(queries)}: '{query}'", file=sys.stderr)

        try:
            result = api.search_papers(
                query=query,
                limit=limit,
                offset=offset,
                year_filter=year_filter,
                date_filter=date_filter,
                sort=sort
            )

            # Check if we got results
            if result.get("data") and len(result["data"]) > 0:
                if verbose:
                    print(f"✓ Query succeeded with {len(result['data'])} results", file=sys.stderr)
                result["query_used"] = query
                result["query_attempt"] = i
                return result
            else:
                if verbose:
                    print(f"✗ Query returned no results", file=sys.stderr)

        except Exception as e:
            if verbose:
                print(f"✗ Query failed: {str(e)}", file=sys.stderr)

        # Rate limiting - wait between attempts
        if i < len(queries):
            time.sleep(1)

    return None


def format_paper(paper: Dict[str, Any], index: int) -> str:
    """Format a single paper for display"""
    title = paper.get("title", "Unknown Title")
    authors = paper.get("authors", [])
    author_str = ", ".join([a.get("name", "Unknown") for a in authors[:3]])
    if len(authors) > 3:
        author_str += " et al."

    year = paper.get("year", "N/A")
    citations = paper.get("citationCount", 0)
    url = paper.get("url", "N/A")
    venue = paper.get("venue", "N/A")

    output = f"\n{index}. {title}\n"
    output += f"   Authors: {author_str}\n"
    output += f"   Year: {year} | Citations: {citations} | Venue: {venue}\n"
    output += f"   URL: {url}\n"

    abstract = paper.get("abstract")
    if abstract:
        # Truncate long abstracts
        abstract_preview = abstract
        output += f"   Abstract: {abstract_preview}\n"

    return output


def main():
    parser = argparse.ArgumentParser(
        description="Query Semantic Scholar API for longevity research papers with retry logic",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Search with three alternative queries
  %(prog)s --queries "longevity mice experiments" "aging mouse model" "lifespan extension mice"

  # Find most cited papers from 2020 onwards
  %(prog)s --queries "rapamycin longevity" "mTOR inhibition aging" \\
           --year-filter "2020-" --sort citations --limit 20

  # Get papers from the past 2 weeks (requires calculating the date)
  %(prog)s --queries "NAD+ longevity" "nicotinamide aging" \\
           --date-filter "2025-10-10:" --sort recent

  # Get papers from a specific date range
  %(prog)s --queries "senolytics aging" \\
           --date-filter "2025-01-01:2025-12-31"

  # Get recent papers with JSON output
  %(prog)s --queries "NAD+ longevity" "nicotinamide aging" \\
           --sort recent --json
        """
    )

    parser.add_argument(
        "--queries",
        nargs="+",
        required=True,
        help="List of query strings to try in sequence"
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Number of papers to return (default: 10, max: 100)"
    )

    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Pagination offset (default: 0)"
    )

    parser.add_argument(
        "--year-filter",
        type=str,
        help="Year range filter (e.g., '2020-' for 2020 onwards, '2015-2020' for range)"
    )

    parser.add_argument(
        "--date-filter",
        type=str,
        help="Date range filter in YYYY-MM-DD format (e.g., '2024-10-01:' for Oct 1 onwards, '2024-01-01:2024-12-31' for specific range)"
    )

    parser.add_argument(
        "--sort",
        choices=["recent", "citations"],
        default="recent",
        help="Sort order: recent (by date) or citations (by count)"
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON instead of formatted text"
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print status messages to stderr"
    )

    args = parser.parse_args()

    # Initialize API client
    api = SemanticScholarAPI()

    # Execute query with retry
    result = query_with_retry(
        api=api,
        queries=args.queries,
        limit=args.limit,
        offset=args.offset,
        year_filter=args.year_filter,
        date_filter=args.date_filter,
        sort=args.sort,
        verbose=args.verbose
    )

    if result is None:
        print("ERROR: All query attempts failed or returned no results", file=sys.stderr)
        sys.exit(1)

    # Output results
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"\n{'='*80}")
        print(f"Query: '{result.get('query_used')}'")
        print(f"Attempt: {result.get('query_attempt')}/{len(args.queries)}")
        print(f"Total papers found: {result.get('total', 0)}")
        print(f"Showing: {len(result.get('data', []))} papers")
        print(f"{'='*80}")

        for i, paper in enumerate(result.get("data", []), 1):
            print(format_paper(paper, i))

        print(f"\n{'='*80}\n")


if __name__ == "__main__":
    main()
