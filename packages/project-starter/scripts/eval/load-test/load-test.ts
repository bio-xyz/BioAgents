import { ElizaSocketManager } from '../eliza-utils.js';
import { fullDataset } from '../constants.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';

class LoadTester {
  private socketManagers: ElizaSocketManager[] = [];
  private concurrentUsers: number;
  private results: LoadTestResult[] = [];
  private p95ThresholdMs: number;
  private p99ThresholdMs: number;
  private serverUrl: string;

  constructor(
    baseUrl: string,
    agentId: string,
    concurrentUsers: number = 20,
    p95ThresholdMs: number = 100000,
    p99ThresholdMs: number = 120000
  ) {
    this.serverUrl = baseUrl.replace(/\/+$/, '');
    this.concurrentUsers = concurrentUsers;
    this.p95ThresholdMs = p95ThresholdMs;
    this.p99ThresholdMs = p99ThresholdMs;

    // Create socket managers for each concurrent user (like evaluate.ts)
    for (let i = 0; i < concurrentUsers; i++) {
      this.socketManagers.push(new ElizaSocketManager(baseUrl, agentId));
    }
  }

  async run(): Promise<void> {
    console.log(`🚀 Starting load test with ${this.concurrentUsers} concurrent users`);
    console.log(`📋 Using ${fullDataset.length} questions from evaluation dataset`);

    // Check server availability first
    console.log('🔍 Checking server availability...');
    await this.checkServerAvailability();

    // Open all socket connections
    console.log('🔌 Opening socket connections...');
    await Promise.all(this.socketManagers.map((manager) => manager.openSocket()));
    console.log('✅ All socket connections established');

    // Run concurrent load test
    const startTime = Date.now();
    const promises = this.socketManagers.map((manager, index) =>
      this.runUserLoadTest(manager, index)
    );

    await Promise.all(promises);

    const totalTime = Date.now() - startTime;
    this.printResults(totalTime);
    this.saveResultsToCSV();
  }

  private async runUserLoadTest(manager: ElizaSocketManager, userIndex: number): Promise<void> {
    try {
      // Add randomized backoff (0-10s) to avoid 429 rate limits
      const backoffDelay = Math.random() * 10000;
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));

      // Each user picks a random question
      const question = fullDataset[Math.floor(Math.random() * fullDataset.length)].question;

      console.log(
        `👤 User ${userIndex + 1}: Creating channel for "${question.substring(0, 50)}..." (after ${backoffDelay.toFixed(0)}ms delay)`
      );

      const channelStartTime = Date.now();
      const channelId = await manager.createAndSetupChannel();
      const channelSetupTime = Date.now() - channelStartTime;

      console.log(`📤 User ${userIndex + 1}: Sending question...`);
      const messageStartTime = Date.now();
      await manager.send(question, channelId);

      console.log(`⏳ User ${userIndex + 1}: Waiting for response...`);
      await manager.waitForResponses();

      const totalResponseTime = Date.now() - messageStartTime;

      this.results.push({
        userIndex: userIndex + 1,
        question: question.substring(0, 100),
        channelSetupTime,
        responseTime: totalResponseTime,
        success: true,
      });

      console.log(`✅ User ${userIndex + 1}: Completed in ${totalResponseTime}ms`);
    } catch (error) {
      console.error(`❌ User ${userIndex + 1}: Failed -`, error);
      this.results.push({
        userIndex: userIndex + 1,
        question: 'Failed to execute',
        channelSetupTime: 0,
        responseTime: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async checkServerAvailability(): Promise<void> {
    const serverId = '00000000-0000-0000-0000-000000000000';
    const checkUrl = `${this.serverUrl}/api/messaging/central-servers/${serverId}/channels`;

    try {
      console.log(`   Testing: ${checkUrl}`);
      const response = await fetch(checkUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      if (response.ok) {
        const data = await response.json();
        console.log(
          `✅ Server is reachable! Found ${data.data?.channels.length || 0} existing channels`
        );
      } else {
        console.log(`⚠️  Server responded with ${response.status}: ${response.statusText}`);
        console.log('   Continuing with load test anyway...');
      }
    } catch (error) {
      console.error(`❌ Server availability check failed: ${error.message}`);
      console.log('   This might indicate connection issues. Proceeding anyway...');
    }
    console.log('');
  }

  private printResults(totalTime: number): void {
    console.log('\n' + '='.repeat(80));
    console.log('🎯 LOAD TEST RESULTS');
    console.log('='.repeat(80));

    const successful = this.results.filter((r) => r.success);
    const failed = this.results.filter((r) => !r.success);
    const successRate = (successful.length / this.concurrentUsers) * 100;

    console.log(`📊 Total Users: ${this.concurrentUsers}`);
    console.log(`✅ Successful: ${successful.length} (${successRate.toFixed(1)}%)`);
    console.log(`❌ Failed: ${failed.length}`);
    console.log(`⏱️  Total Test Time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log('');

    if (successful.length > 0) {
      const responseTimes = successful.map((r) => r.responseTime);
      const channelSetupTimes = successful.map((r) => r.channelSetupTime);

      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const p95 = this.getPercentile(responseTimes, 95);
      const p99 = this.getPercentile(responseTimes, 99);

      console.log('📈 RESPONSE TIME STATS:');
      console.log(`   Average: ${avgResponseTime.toFixed(0)}ms`);
      console.log(`   Min: ${Math.min(...responseTimes)}ms`);
      console.log(`   Max: ${Math.max(...responseTimes)}ms`);
      console.log(`   Median (P50): ${this.getMedian(responseTimes).toFixed(0)}ms`);
      console.log(`   P95: ${p95.toFixed(0)}ms`);
      console.log(`   P99: ${p99.toFixed(0)}ms`);
      console.log('');

      console.log('🎯 SUCCESS RATE THRESHOLDS:');
      const p95Success =
        (responseTimes.filter((t) => t <= this.p95ThresholdMs).length / responseTimes.length) * 100;
      const p99Success =
        (responseTimes.filter((t) => t <= this.p99ThresholdMs).length / responseTimes.length) * 100;

      console.log(
        `   95% under ${this.p95ThresholdMs}ms: ${p95Success.toFixed(1)}% ${p95Success >= 95 ? '✅' : '❌'}`
      );
      console.log(
        `   99% under ${this.p99ThresholdMs}ms: ${p99Success.toFixed(1)}% ${p99Success >= 99 ? '✅' : '❌'}`
      );
      console.log('');

      console.log('🔧 CHANNEL SETUP TIME STATS:');
      console.log(
        `   Average: ${(channelSetupTimes.reduce((a, b) => a + b, 0) / channelSetupTimes.length).toFixed(0)}ms`
      );
      console.log(`   Min: ${Math.min(...channelSetupTimes)}ms`);
      console.log(`   Max: ${Math.max(...channelSetupTimes)}ms`);
      console.log('');
    }

    console.log('='.repeat(80));
  }

  private getMedian(numbers: number[]): number {
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private getPercentile(numbers: number[], percentile: number): number {
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  private saveResultsToCSV(): void {
    const successful = this.results.filter((r) => r.success);
    const failed = this.results.filter((r) => !r.success);
    const successRate = (successful.length / this.concurrentUsers) * 100;

    let csvContent =
      'timestamp,total_users,successful,failed,success_rate_percent,avg_response_time_ms,min_response_time_ms,max_response_time_ms,p50_ms,p95_ms,p99_ms,p95_threshold_ms,p99_threshold_ms,p95_success_rate_percent,p99_success_rate_percent,avg_channel_setup_ms\n';

    if (successful.length > 0) {
      const responseTimes = successful.map((r) => r.responseTime);
      const channelSetupTimes = successful.map((r) => r.channelSetupTime);

      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const p50 = this.getMedian(responseTimes);
      const p95 = this.getPercentile(responseTimes, 95);
      const p99 = this.getPercentile(responseTimes, 99);
      const avgChannelSetup =
        channelSetupTimes.reduce((a, b) => a + b, 0) / channelSetupTimes.length;

      const p95Success =
        (responseTimes.filter((t) => t <= this.p95ThresholdMs).length / responseTimes.length) * 100;
      const p99Success =
        (responseTimes.filter((t) => t <= this.p99ThresholdMs).length / responseTimes.length) * 100;

      csvContent += `${new Date().toISOString()},${this.concurrentUsers},${successful.length},${failed.length},${successRate.toFixed(2)},${avgResponseTime.toFixed(0)},${Math.min(...responseTimes)},${Math.max(...responseTimes)},${p50.toFixed(0)},${p95.toFixed(0)},${p99.toFixed(0)},${this.p95ThresholdMs},${this.p99ThresholdMs},${p95Success.toFixed(2)},${p99Success.toFixed(2)},${avgChannelSetup.toFixed(0)}\n`;
    } else {
      csvContent += `${new Date().toISOString()},${this.concurrentUsers},0,${failed.length},0,0,0,0,0,0,0,${this.p95ThresholdMs},${this.p99ThresholdMs},0,0,0\n`;
    }

    const resultsPath = join(
      process.cwd(),
      'packages/project-starter/scripts/eval/load-test/results.csv'
    );

    try {
      const existingContent = require('fs').existsSync(resultsPath)
        ? require('fs').readFileSync(resultsPath, 'utf8')
        : '';
      const finalContent = existingContent.includes('timestamp,')
        ? existingContent + csvContent.split('\n')[1] + '\n'
        : csvContent;
      writeFileSync(resultsPath, finalContent);
      console.log(`📁 Results saved to: ${resultsPath}`);
    } catch (error) {
      console.error('❌ Failed to save results to CSV:', error);
    }
  }
}

interface LoadTestResult {
  userIndex: number;
  question: string;
  channelSetupTime: number;
  responseTime: number;
  success: boolean;
  error?: string;
}

// Main execution (similar to evaluate.ts)
(async () => {
  const serverUrl = process.env.SERVER_URL || 'https://main.aubr.ai';
  const agentId = process.env.AGENT_ID || 'bcdebbee-f7d1-0ec4-ab62-dbdd92105226';
  const concurrentUsers = parseInt(process.env.CONCURRENT_USERS || '20');
  const p95ThresholdMs = parseInt(process.env.P95_THRESHOLD_MS || '100000');
  const p99ThresholdMs = parseInt(process.env.P99_THRESHOLD_MS || '120000');

  if (!agentId) {
    console.error('❌ Set AGENT_ID environment variable');
    process.exit(1);
  }

  console.log(`🎯 Load Test Configuration:`);
  console.log(`   Server: ${serverUrl}`);
  console.log(`   Agent ID: ${agentId}`);
  console.log(`   Concurrent Users: ${concurrentUsers}`);
  console.log(`   P95 Threshold: ${p95ThresholdMs}ms (95% must be faster)`);
  console.log(`   P99 Threshold: ${p99ThresholdMs}ms (99% must be faster)`);
  console.log('');

  try {
    const loadTester = new LoadTester(
      serverUrl,
      agentId,
      concurrentUsers,
      p95ThresholdMs,
      p99ThresholdMs
    );
    await loadTester.run();
  } catch (e) {
    console.error('Fatal error:', e);
    process.exit(1);
  }

  process.on('SIGINT', () => {
    console.log('\n👋 Load test interrupted');
    process.exit(0);
  });
})();
