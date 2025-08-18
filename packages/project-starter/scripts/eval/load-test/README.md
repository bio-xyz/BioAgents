# Load Test

Concurrent load testing tool for BioAgentsv2 agent using the existing evaluation infrastructure.

## Overview

This load test creates multiple concurrent users (default: 20) that simultaneously:

1. Create DM channels with the agent
2. Send random questions from the evaluation dataset
3. Wait for responses
4. Measure response times and success rates

## Usage

### Basic Usage

```bash
# Run with defaults (20 concurrent users, localhost)
bun run packages/project-starter/scripts/eval/load-test/load-test.ts

# Run with custom concurrent users
CONCURRENT_USERS=50 bun run packages/project-starter/scripts/eval/load-test/load-test.ts

# Run against production
SERVER_URL=https://main.aubr.ai CONCURRENT_USERS=10 bun run packages/project-starter/scripts/eval/load-test/load-test.ts
```

### Environment Variables

- `SERVER_URL`: Target server (default: `http://localhost:3000`)
- `AGENT_ID`: Agent to test (default: `bcdebbee-f7d1-0ec4-ab62-dbdd92105226`)
- `CONCURRENT_USERS`: Number of concurrent users (default: `20`)
- `P95_THRESHOLD_MS`: 95% of responses must be faster than this (default: `60000`)
- `P99_THRESHOLD_MS`: 99% of responses must be faster than this (default: `75000`)

## Features

- **Reuses existing infrastructure**: Uses `ElizaSocketManager` and question dataset from evaluation scripts
- **Concurrent testing**: All users run simultaneously to simulate real load with randomized backoff (0-2s)
- **Success rate thresholds**: Configurable P95/P99 response time requirements
- **Detailed metrics**: Response times, channel setup times, success/failure rates, percentiles
- **CSV logging**: Results automatically saved to `results.csv` for tracking over time
- **Random questions**: Each user picks a random question from the full evaluation dataset
- **Graceful error handling**: Continues testing even if some users fail

## Output

The load test provides detailed results including:

- Total users, successful connections, failures, success rate percentage
- Response time statistics (average, min, max, median, P95, P99)
- Success rate threshold validation (✅/❌ indicators)
- Channel setup time statistics
- Individual user results
- Error details for failed connections
- CSV export to `results.csv` for historical tracking

## Example Output

```
🚀 Starting load test with 20 concurrent users
📋 Using 25 questions from evaluation dataset
🔌 Opening socket connections...
✅ All socket connections established
...
================================================================================
🎯 LOAD TEST RESULTS
================================================================================
📊 Total Users: 20
✅ Successful: 18 (90.0%)
❌ Failed: 2
⏱️  Total Test Time: 15.32s

📈 RESPONSE TIME STATS:
   Average: 8450ms
   Min: 3200ms
   Max: 15600ms
   Median (P50): 7800ms
   P95: 14200ms
   P99: 15400ms

🎯 SUCCESS RATE THRESHOLDS:
   95% under 15000ms: 94.4% ❌
   99% under 30000ms: 100.0% ✅

🔧 CHANNEL SETUP TIME STATS:
   Average: 1200ms
   Min: 800ms
   Max: 2100ms

📁 Results saved to: /path/to/results.csv
```
