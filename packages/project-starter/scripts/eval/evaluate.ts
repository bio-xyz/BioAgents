import { Client } from 'pg';
import { fullDataset } from './constants.js';
import { EvaluationRecord } from './types.js';
import { ElizaSocketManager } from './eliza-utils.js';
import { LLMEvaluationUtils } from './llm-utils.js';
import { CSVExportUtils } from './csv-utils.js';

class AgentEvaluator {
  private socketManager: ElizaSocketManager;
  private llmUtils: LLMEvaluationUtils;
  private evaluateOtherModel: boolean;
  private externalModel: string;

  constructor(baseUrl: string, agentId: string) {
    this.socketManager = new ElizaSocketManager(baseUrl, agentId);

    const openRouterApiKey = process.env.OPENROUTER_API_KEY || '';
    if (!openRouterApiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }

    this.llmUtils = new LLMEvaluationUtils(openRouterApiKey);
    this.evaluateOtherModel = process.env.EVALUATE_OTHER_MODEL === 'true';
    this.externalModel = process.env.EVALUATION_EXTERNAL_MODEL || 'openai/o3-mini';

    if (this.evaluateOtherModel) {
      console.log(`🤖 External model evaluation mode enabled: ${this.externalModel}`);
    } else {
      console.log(`🎯 Agent evaluation mode: ${agentId}`);
    }
  }

  async run(): Promise<void> {
    if (this.evaluateOtherModel) {
      // External model mode - directly generate answers
      const evaluationRecords = await this.llmUtils.runExternalModelEvaluation(this.externalModel);
      if (evaluationRecords.length > 0) {
        const scoredEvaluations = await this.llmUtils.scoreEvaluations(evaluationRecords, true);
        await CSVExportUtils.exportToCSV(scoredEvaluations, true, this.externalModel);
      }
    } else {
      // Agent mode - use socket communication
      await this.socketManager.openSocket();
      await this.runAgentEvaluation();
      const evaluationRecords = await this.queryResults();
      if (evaluationRecords.length > 0) {
        const scoredEvaluations = await this.llmUtils.scoreEvaluations(evaluationRecords, false);
        await CSVExportUtils.exportToCSV(scoredEvaluations, false);
      }
    }
  }

  private async runAgentEvaluation(): Promise<void> {
    const groupSize = 5;
    const totalQuestions = fullDataset.length;
    const totalGroups = Math.ceil(totalQuestions / groupSize);

    console.log(
      `\n🚀 Starting evaluation with ${totalQuestions} questions in groups of ${groupSize} (each in fresh channel)`
    );

    for (let groupIndex = 0; groupIndex < totalGroups; groupIndex++) {
      const start = groupIndex * groupSize;
      const end = Math.min(start + groupSize, totalQuestions);
      const group = fullDataset.slice(start, end);

      console.log(
        `\n📋 Group ${groupIndex + 1}/${totalGroups}: Processing questions ${start + 1}-${end}`
      );

      for (const { question } of group) {
        console.log(`🔨 Creating new channel for: "${question.substring(0, 50)}..."`);
        const channelId = await this.socketManager.createAndSetupChannel();
        await this.socketManager.send(question, channelId);
        await new Promise((r) => setTimeout(r, 400));
      }

      console.log(`⏳ Waiting for ${group.length} responses...`);
      await this.socketManager.waitForResponses();
      console.log(`✅ Group ${groupIndex + 1} completed`);

      if (groupIndex < totalGroups - 1) {
        console.log('💤 Pausing before next group...');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log('\n🎉 All evaluation groups completed!');
  }

  private async queryResults(): Promise<EvaluationRecord[]> {
    console.log('\n📊 Querying database for results...');

    const postgresUrl =
      process.env.POSTGRES_URL || 'postgresql://postgres:123@localhost:5432/dbname';
    const client = new Client({
      connectionString: postgresUrl,
    });

    try {
      await client.connect();

      const channelIds = Array.from(this.socketManager.getActiveChannels());
      const placeholders = channelIds.map((_, i) => `$${i + 1}`).join(',');

      const query = `
        SELECT * FROM public.answer_eval 
        WHERE channel_id IN (${placeholders})
        ORDER BY updated_at DESC 
        LIMIT $${channelIds.length + 1}
      `;

      const result = await client.query(query, [
        ...channelIds,
        this.socketManager.getTotalResponsesReceived(),
      ]);

      console.log(`\n📋 Found ${result.rows.length} evaluation records`);
      return result.rows;
    } catch (error) {
      console.error('❌ Database query failed:', error);
      return [];
    } finally {
      await client.end();
    }
  }
}

(async () => {
  const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
  const agentId = process.env.AGENT_ID || 'bcdebbee-f7d1-0ec4-ab62-dbdd92105226';

  if (!agentId) {
    console.error('❌ Set AGENT_ID environment variable');
    process.exit(1);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('❌ Set OPENROUTER_API_KEY environment variable');
    console.error('Get your API key from: https://openrouter.ai/settings/keys');
    process.exit(1);
  }

  try {
    await new AgentEvaluator(serverUrl, agentId).run();
  } catch (e) {
    console.error('Fatal:', e);
    process.exit(1);
  }

  process.on('SIGINT', () => process.exit(0));
})();
