# OpenScholar Tool Overview

This directory packages helper scripts and configuration for working with the OpenScholar base retrieval models from within the BioAgents framework. The complete upstream implementation lives in the bio-xyz/bio-openscholar repository: https://github.com/bio-xyz/bio-openscholar.

## Setting up OpenScholar locally

- **Use the base pipeline locally.** Clone the upstream repo, create a Python environment, and install its dependencies (see the repository README). The provided scripts let you ingest papers, build a FAISS index, and run retrieval + reranking queries without any additional fine-tuning.
- **Prep your manuscript corpus.** Follow the cleaning flow described in [BUILDING_INDEX.md](https://github.com/bio-xyz/bio-openscholar/blob/main/BUILDING_INDEX.md): extract raw text with `mineru`, enrich metadata with GROBID, and normalize each paper into JSON objects containing title/abstract/sections/keywords.
- **Build the vector index.** Point the helper scripts at your cleaned JSONL data:
  ```bash
  python bio-openscholar/build_index.py \
    --data_dir bio-openscholar/data \
    --out_dir bio-openscholar/index_1
  python bio-openscholar/build_parquet.py \
    --data_dir bio-openscholar/data \
    --index_dir bio-openscholar/index_1 \
    --output bio-openscholar/chunks.parquet \
    --method from_meta
  ```
  The first command creates `index.faiss` plus `meta.jsonl`; the second generates a parquet file so retrieval helpers can hydrate the original passages.
- **Verify retrieval quality.** Run the CLI sanity check:
  ```bash
  python bio-openscholar/search_then_rerank.py \
    --index_path bio-openscholar/index_1/index.faiss \
    --meta_path bio-openscholar/index_1/meta.jsonl \
    --query "cytokine storm mitigation strategies"
  ```
  Successful responses confirm the base model and index are wired correctly.
- **Integrate with BioAgents.** Once the index and parquet sit alongside this toolkit, create a small FastAPI service to expose them; that endpoint becomes your `OPENSCHOLAR_API_URL`, and the framework can call it to answer questions against your curated corpus. When running locally you can skip auth, but if you deploy it remotely be sure to add authentication and require an `OPENSCHOLAR_API_KEY`.

## Deployment Notes

- The open-source release ships the **base retrieval and reranking models** only. There is no managed API; you run the scripts locally or host them yourself.
- Deployments mirror the local setup: build an index, package `index.faiss`, `meta.jsonl`, and the parquet file, then expose `search_then_rerank.py` (or a thin web wrapper) on your infrastructure of choice. The upstream docs note that GPU-enabled services such as Runpod or Lambda are popular if you need remote hosting.

## Additional Resources

- Upstream repository and full documentation: https://github.com/bio-xyz/bio-openscholar
- Corpus preparation and indexing walkthrough: [BUILDING_INDEX.md](https://github.com/bio-xyz/bio-openscholar/blob/main/BUILDING_INDEX.md)
