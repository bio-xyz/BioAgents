# JSON-LD to Oxigraph Loader

Load scientific paper data from JSON-LD files into Oxigraph triple store.

## Setup

### Install dependencies

```bash
pnpm install
```

### Start Oxigraph server

```bash
docker run --rm -v $PWD/oxigraph:/data -p 7878:7878 ghcr.io/oxigraph/oxigraph serve --location /data --bind 0.0.0.0:7878
```

### Load the data

```bash
npx tsx scripts/jsonldToQuads.ts
```

### Clear database (if needed)

```bash
npx tsx scripts/clearGraph.ts
```

The script processes all `.json` files in `markoJSONLDs/` directory and loads them into the graph database for querying.
