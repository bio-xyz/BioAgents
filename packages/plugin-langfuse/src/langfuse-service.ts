import {
  type IAgentRuntime,
  Service,
  elizaLogger,
  type ModelTypeName,
  type ModelEventPayload,
  ModelType,
} from '@elizaos/core';
import { Langfuse } from 'langfuse';
import { v4 as uuidv4 } from 'uuid';

import type { CostSummary, LangfuseConfig } from './constants/types';
import { calculateCost, calculateCostEfficiency } from './utils/cost-calculator';
import { sanitizeOutput } from './utils/data-sanitizer';
import { getExpectedModelName } from './utils/model-utils';
import { modelMonitor } from './monitoring/model-monitor';

export class LangfuseService extends Service {
  static serviceType = 'langfuse';
  capabilityDescription =
    'Advanced Langfuse tracing with runtime-based model detection and cost tracking';

  private langfuse: Langfuse | null = null;
  private isEnabled: boolean = false;
  private sessionCosts: Map<string, number> = new Map();
  private totalCosts: number = 0;
  private originalUseModel: any = null;
  private skippedEmbeddingCalls: number = 0;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    elizaLogger.info('🚀 LangfuseService starting up');
    elizaLogger.debug('📋 Service initialization details:', {
      serviceType: LangfuseService.serviceType,
      runtimeId: runtime.agentId,
      timestamp: new Date().toISOString(),
    });

    this.initializeLangfuse(runtime);
    this.interceptRuntimeModelCalls(runtime);

    elizaLogger.info('✅ LangfuseService ready for model tracking');
  }

  /**
   * Debug method to check current service status
   */
  public getDebugStatus(): any {
    const status = {
      enabled: this.isEnabled,
      hasLangfuseClient: !!this.langfuse,
      totalCosts: this.totalCosts,
      sessionCount: this.sessionCosts.size,
      sessions: Array.from(this.sessionCosts.entries()).map(([id, cost]) => ({
        sessionId: id,
        cost: cost.toFixed(6),
      })),
      hasOriginalUseModel: !!this.originalUseModel,
      skippedEmbeddingCalls: this.skippedEmbeddingCalls,
      timestamp: new Date().toISOString(),
    };

    elizaLogger.info('🔍 Langfuse Debug Status:', status);
    return status;
  }

  /**
   * Debug method to manually trigger a test trace
   */
  public async debugTestTrace(): Promise<void> {
    if (!this.isEnabled) {
      elizaLogger.warn('❌ Cannot test trace: Langfuse is not enabled');
      return;
    }

    try {
      elizaLogger.info('🧪 Creating debug test trace');

      const testTrace = this.langfuse!.trace({
        id: 'debug-test-' + Date.now(),
        name: 'langfuse-debug-test',
        metadata: {
          test: true,
          timestamp: new Date().toISOString(),
        },
      });

      const testGeneration = testTrace.generation({
        name: 'debug-generation',
        model: 'debug-model',
        input: 'Debug test input',
      });

      testGeneration.end({
        output: 'Debug test output',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      });

      await this.langfuse!.flushAsync();
      elizaLogger.info('✅ Debug test trace completed successfully');
    } catch (error) {
      elizaLogger.error('❌ Debug test trace failed:', error);
    }
  }

  private initializeLangfuse(runtime: IAgentRuntime): void {
    try {
      elizaLogger.debug('🔧 Initializing Langfuse configuration');

      const config = {
        secretKey: runtime.getSetting('LANGFUSE_SECRET_KEY'),
        publicKey: runtime.getSetting('LANGFUSE_PUBLIC_KEY'),
        baseUrl: runtime.getSetting('LANGFUSE_BASE_URL'),
        debug: runtime.getSetting('LANGFUSE_DEBUG') === 'true',
      };

      elizaLogger.debug('🔑 Langfuse configuration check:', {
        hasSecretKey: !!config.secretKey,
        hasPublicKey: !!config.publicKey,
        baseUrl: config.baseUrl || 'default',
        debug: config.debug,
        secretKeyLength: config.secretKey?.length || 0,
        publicKeyPrefix: config.publicKey?.substring(0, 10) || 'none',
      });

      if (!config.secretKey || !config.publicKey) {
        elizaLogger.warn(
          '🔶 Langfuse not initialized: Missing required keys (LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY)'
        );
        elizaLogger.info('💡 Set your Langfuse environment variables to enable cost tracking');
        return;
      }

      elizaLogger.debug('🚀 Creating Langfuse client instance');
      this.langfuse = new Langfuse(config);
      this.isEnabled = true;
      elizaLogger.info('✅ Langfuse runtime-based cost tracking initialized successfully');

      elizaLogger.debug('📊 Langfuse client configuration:', {
        enabled: this.isEnabled,
        baseUrl: config.baseUrl,
        debugMode: config.debug,
      });
    } catch (error) {
      elizaLogger.error('❌ Failed to initialize Langfuse:', error);
      this.isEnabled = false;
    }
  }

  private getLangfuseConfig(runtime: IAgentRuntime): LangfuseConfig {
    return {
      secretKey: runtime.getSetting('LANGFUSE_SECRET_KEY') || process.env.LANGFUSE_SECRET_KEY || '',
      publicKey: runtime.getSetting('LANGFUSE_PUBLIC_KEY') || process.env.LANGFUSE_PUBLIC_KEY || '',
      baseUrl:
        runtime.getSetting('LANGFUSE_BASEURL') ||
        runtime.getSetting('LANGFUSE_HOST') ||
        process.env.LANGFUSE_BASEURL ||
        process.env.LANGFUSE_HOST ||
        'https://cloud.langfuse.com',
      flushAt: 5,
      flushInterval: 5000,
    };
  }

  static async start(runtime: IAgentRuntime): Promise<LangfuseService> {
    const service = new LangfuseService(runtime);
    if (service.isEnabled) {
      await service.wrapAllRuntimeActions(runtime);
      elizaLogger.info('✅ Langfuse cost tracking started');
      elizaLogger.info('💰 Track your AI costs at: https://cloud.langfuse.com');
    } else {
      elizaLogger.warn('⚠️ Langfuse disabled - set credentials to enable cost tracking');
    }
    return service;
  }

  static async stop(): Promise<void> {
    elizaLogger.info('🔄 Langfuse service stopped');
  }

  private async wrapAllRuntimeActions(runtime: IAgentRuntime): Promise<void> {
    // Model calls are already intercepted in constructor via interceptRuntimeModelCalls()
    this.setupModelEventTracking(runtime);
    elizaLogger.info('🔍 Runtime wrapped for comprehensive cost tracking');
  }

  private setupModelEventTracking(runtime: IAgentRuntime): void {
    if (!this.isEnabled || !this.langfuse) return;

    runtime.registerEvent('MODEL_USED', async (payload: ModelEventPayload) => {
      try {
        const { provider, type, tokens } = payload;

        if (tokens) {
          const cost = calculateCost(type, tokens.prompt, tokens.completion);
          this.totalCosts += cost.totalCost;

          elizaLogger.info(
            `💰 Model usage: ${provider}/${type} - $${cost.totalCost.toFixed(6)} (Total: $${this.totalCosts.toFixed(4)})`
          );
        }
      } catch (error) {
        elizaLogger.error('Error tracking model usage event:', error);
      }
    });
  }

  // Removed obsolete wrapModelCalls and traceModelCall methods
  // Now using the more advanced interceptRuntimeModelCalls method

  private createTrace(
    traceId: string,
    sessionId: string,
    modelType: ModelTypeName,
    provider: string,
    params: any,
    runtime: IAgentRuntime
  ) {
    // Get the actual model name instead of generic type
    const actualModelName = this.getExpectedModelName(modelType, provider, params, runtime);

    // Get the user ID from context
    const userId = this.extractUserIdFromContext(params, runtime);

    elizaLogger.debug(
      `🏷️ Creating trace with actual model name: ${actualModelName} (was: eliza-${modelType.toLowerCase()})`
    );
    elizaLogger.debug(`👤 Creating trace with user ID: ${userId}`);

    return this.langfuse!.trace({
      id: traceId,
      name: `${actualModelName}`, // Use actual model name like "gpt-4" or "claude-3-5-sonnet-20241022"
      sessionId,
      userId,
      tags: ['eliza-agent', 'cost-tracking', modelType.toLowerCase(), provider, actualModelName],
      metadata: {
        modelType,
        actualModelName,
        provider,
        userId, // Add user ID to metadata for visibility
        agentName: runtime.character.name,
        agentId: runtime.character.id,
        source: 'eliza-langfuse-plugin',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
      },
    });
  }

  private createGeneration(
    trace: any,
    modelType: ModelTypeName,
    params: any,
    provider: string = 'unknown',
    runtime?: IAgentRuntime
  ) {
    const actualModelName = this.getExpectedModelName(modelType, provider, params, runtime);

    elizaLogger.debug(`🔧 Creating generation with actual model: ${actualModelName}`);

    return trace.generation({
      name: `${actualModelName}-generation`, // Use actual model name in generation name too
      model: actualModelName,
      modelParameters: {
        temperature: params?.temperature ?? 0.7,
        maxTokens: params?.maxTokens ?? 1000,
        topP: params?.topP,
        frequencyPenalty: params?.frequencyPenalty,
        presencePenalty: params?.presencePenalty,
        ...params?.modelParameters,
      },
      input: sanitizeOutput(params),
    });
  }

  // Removed obsolete finalizeTrace method - now using finalizeTraceWithRuntimeData

  /**
   * Intercept runtime model calls to get accurate provider and model information
   */
  private interceptRuntimeModelCalls(runtime: IAgentRuntime): void {
    if (!runtime.useModel) {
      elizaLogger.warn('⚠️ Runtime useModel not available for interception');
      return;
    }

    // Store original method
    this.originalUseModel = runtime.useModel.bind(runtime);

    elizaLogger.info('🔗 Setting up runtime model interception for Langfuse tracing');

    // Wrap the useModel method
    runtime.useModel = async <T extends ModelTypeName, R = any>(
      modelType: T,
      params: any,
      provider?: string
    ): Promise<R> => {
      const callId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      elizaLogger.debug(`🎯 [${callId}] Model call intercepted:`, {
        modelType,
        requestedProvider: provider,
        hasParams: !!params,
        paramsKeys: params ? Object.keys(params) : [],
        langfuseEnabled: this.isEnabled,
      });

      // Skip tracing for embedding models to save Langfuse limits
      if (modelType === ModelType.TEXT_EMBEDDING) {
        this.skippedEmbeddingCalls++;
        elizaLogger.debug(
          `🚫 [${callId}] Skipping Langfuse tracing for embedding model (preserving limits) - Total skipped: ${this.skippedEmbeddingCalls}`
        );

        // Embedding calls are skipped but tracked in debug logs

        return this.originalUseModel(modelType, params, provider);
      }

      if (!this.isEnabled) {
        elizaLogger.debug(`⏭️ [${callId}] Langfuse disabled, bypassing tracing`);
        return this.originalUseModel(modelType, params, provider);
      }

      const sessionId = this.getSessionId(params);
      const startTime = performance.now();

      // Get model handler info BEFORE the call
      const modelHandler = runtime.getModel(modelType);
      const registeredProviders = (runtime as any).models?.get(modelType) || [];
      const selectedProvider = provider || registeredProviders[0]?.provider || 'unknown';

      elizaLogger.debug(`🔍 [${callId}] Provider detection:`, {
        requestedProvider: provider,
        registeredProvidersCount: registeredProviders.length,
        availableProviders: registeredProviders.map((p: any) => p.provider),
        selectedProvider,
        modelHandler: !!modelHandler,
      });

      // Start tracing
      elizaLogger.debug(`📊 [${callId}] Starting Langfuse trace`);
      const traceId = uuidv4();
      const trace = this.createTrace(
        traceId,
        sessionId,
        modelType,
        selectedProvider,
        params,
        runtime
      );
      const generation = this.createGeneration(trace, modelType, params, selectedProvider, runtime);

      elizaLogger.info(
        `🚀 [${callId}] Intercepted ${modelType} call via ${selectedProvider} (session: ${sessionId})`
      );

      try {
        elizaLogger.debug(`⚡ [${callId}] Executing original model call`);
        // Execute the original model call
        const result = await this.originalUseModel(modelType, params, provider);
        const endTime = performance.now();
        const duration = endTime - startTime;

        elizaLogger.debug(`✅ [${callId}] Model call completed in ${duration.toFixed(2)}ms`);

        // Finalize with accurate runtime data
        await this.finalizeTraceWithRuntimeData(
          generation,
          trace,
          result,
          startTime,
          endTime,
          sessionId,
          modelType,
          selectedProvider,
          params,
          callId
        );

        return result;
      } catch (error) {
        const endTime = performance.now();
        const duration = endTime - startTime;

        elizaLogger.error(
          `❌ [${callId}] Model call failed after ${duration.toFixed(2)}ms:`,
          error
        );

        this.handleModelError(generation, trace, error as Error, startTime, endTime, sessionId);
        throw error;
      }
    };

    elizaLogger.info('✅ Runtime model interception enabled for cost tracking');
  }

  private getSessionId(params: any): string {
    // Extract session ID from params with priority:
    // 1. Room ID (best for conversation grouping)
    // 2. Explicit session ID
    // 3. Run ID
    // 4. Generate new one
    const sessionId = params?.roomId || params?.sessionId || params?.runId || uuidv4();

    elizaLogger.debug('🔑 Session ID resolution:', {
      roomId: params?.roomId,
      sessionId: params?.sessionId,
      runId: params?.runId,
      generated: !params?.roomId && !params?.sessionId && !params?.runId,
      selectedSessionId: sessionId,
    });

    return sessionId;
  }

  private handleModelError(
    generation: any,
    trace: any,
    error: Error,
    startTime: number,
    endTime: number,
    sessionId: string
  ): void {
    const duration = endTime - startTime;

    elizaLogger.error(`❌ Model call failed after ${duration.toFixed(2)}ms:`, error.message);

    // End generation with error
    generation.end({
      output: null,
      metadata: {
        error: error.message,
        duration,
        sessionId,
        status: 'error',
      },
    });

    // Score the error
    trace.score({
      name: 'error-tracking',
      value: 0.0,
      comment: `Error: ${error.message}`,
    });
  }

  private async finalizeTraceWithRuntimeData(
    generation: any,
    trace: any,
    result: any,
    startTime: number,
    endTime: number,
    sessionId: string,
    modelType: ModelTypeName,
    provider: string,
    params: any,
    callId: string
  ) {
    const duration = endTime - startTime;

    elizaLogger.debug(`🔬 [${callId}] Starting model detection and cost calculation`);

    // Extract usage and model info - now with guaranteed provider info
    const usage = this.extractUsageFromResult(result);
    const actualModelName =
      this.extractModelNameFromResult(result) ||
      this.getExpectedModelName(modelType, provider, params, this.runtime);

    elizaLogger.debug(`🏷️ [${callId}] Model name detection:`, {
      expectedModel: this.getExpectedModelName(modelType, provider, params, this.runtime),
      actualModel: actualModelName,
      usageExtracted: !!usage,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
    });

    const costCalc = calculateCost(actualModelName, usage.inputTokens, usage.outputTokens);

    elizaLogger.debug(`💰 [${callId}] Cost calculation:`, {
      model: actualModelName,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      inputCost: costCalc.inputCost,
      outputCost: costCalc.outputCost,
      totalCost: costCalc.totalCost,
      costPerInputToken: costCalc.inputCost / (usage.inputTokens || 1),
      costPerOutputToken: costCalc.outputCost / (usage.outputTokens || 1),
    });

    // Update session and total costs
    const previousSessionCost = this.sessionCosts.get(sessionId) || 0;
    const newSessionCost = previousSessionCost + costCalc.totalCost;
    this.sessionCosts.set(sessionId, newSessionCost);
    this.totalCosts += costCalc.totalCost;

    elizaLogger.debug(`📊 [${callId}] Cost tracking updated:`, {
      sessionId,
      previousSessionCost: previousSessionCost.toFixed(6),
      newSessionCost: newSessionCost.toFixed(6),
      totalCosts: this.totalCosts.toFixed(6),
      costIncrease: costCalc.totalCost.toFixed(6),
    });

    // Record monitoring data with accurate provider info
    elizaLogger.debug(`📈 [${callId}] Recording monitoring data`);
    modelMonitor.recordModelUsage({
      modelType,
      expectedModel: this.getExpectedModelName(modelType, provider, params, this.runtime),
      actualModel: actualModelName,
      confidence: 'high', // High confidence since we got provider from runtime
      source: 'runtime-interception',
      cost: costCalc.totalCost,
      tokens: { input: usage.inputTokens, output: usage.outputTokens },
      provider,
      sessionId,
      duration,
    });

    // End generation with comprehensive runtime data
    elizaLogger.debug(`🏁 [${callId}] Finalizing Langfuse generation`);
    generation.end({
      output: sanitizeOutput(result),
      usage: {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        inputCost: costCalc.inputCost,
        outputCost: costCalc.outputCost,
        totalCost: costCalc.totalCost,
      },
      metadata: {
        duration,
        actualModel: actualModelName,
        provider,
        modelType,
        costBreakdown: costCalc,
        sessionCost: newSessionCost,
        totalCost: this.totalCosts,
        detectionMethod: 'runtime-interception',
        callId,
      },
    });

    // Add cost and provider scoring
    elizaLogger.debug(`⭐ [${callId}] Adding Langfuse scores`);
    trace.score({
      name: 'cost-efficiency',
      value: calculateCostEfficiency(costCalc.totalCost),
      comment: `Cost: $${costCalc.totalCost.toFixed(6)} for ${usage.inputTokens + usage.outputTokens} tokens via ${provider}`,
    });

    trace.score({
      name: 'provider-reliability',
      value: 1.0, // High reliability since detected via runtime
      comment: `Provider: ${provider} (runtime-detected)`,
    });

    elizaLogger.info(
      `💰 [${callId}] Model usage tracked: ${actualModelName} via ${provider} - $${costCalc.totalCost.toFixed(6)} | Session: $${newSessionCost.toFixed(4)} | Total: $${this.totalCosts.toFixed(4)}`
    );
  }

  private extractUsageFromResult(result: any): { inputTokens: number; outputTokens: number } {
    elizaLogger.debug('🔍 Extracting token usage from result:', {
      resultType: typeof result,
      isArray: Array.isArray(result),
      hasUsage: !!result?.usage,
      resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
    });

    // Try multiple common token usage paths
    const paths = ['usage', 'token_usage', 'tokenUsage', '_usage', 'response.usage'];

    for (const path of paths) {
      const usage = this.getNestedValue(result, path);
      if (usage) {
        const extracted = {
          inputTokens:
            usage.prompt_tokens ||
            usage.promptTokens ||
            usage.input_tokens ||
            usage.inputTokens ||
            0,
          outputTokens:
            usage.completion_tokens ||
            usage.completionTokens ||
            usage.output_tokens ||
            usage.outputTokens ||
            0,
        };

        elizaLogger.debug(`✅ Token usage found at path '${path}':`, {
          path,
          raw: usage,
          extracted,
          total: extracted.inputTokens + extracted.outputTokens,
        });

        return extracted;
      }
    }

    // Fallback to estimated tokens if no usage found
    const text = this.extractTextFromResult(result);
    const estimatedTokens = Math.ceil(text.length / 4); // Rough estimate

    elizaLogger.debug('⚠️ No usage found, using estimation:', {
      textLength: text.length,
      estimatedTokens,
      textSample: text.substring(0, 100),
    });

    return { inputTokens: 0, outputTokens: estimatedTokens };
  }

  private extractModelNameFromResult(result: any): string | null {
    elizaLogger.debug('🏷️ Extracting model name from result');

    // Try common model name paths
    const paths = ['model', 'object', 'usage.model', '_response.model', 'response.model'];

    for (const path of paths) {
      const model = this.getNestedValue(result, path);
      if (model && typeof model === 'string') {
        elizaLogger.debug(`✅ Model name found at path '${path}': ${model}`);
        return model;
      }
    }

    elizaLogger.debug('❌ No model name found in result');
    return null;
  }

  private getExpectedModelName(
    modelType: ModelTypeName,
    provider: string,
    params: any,
    runtime?: IAgentRuntime
  ): string {
    elizaLogger.debug(`🏷️ Getting expected model name for ${modelType} via ${provider}`);

    // 1. HIGHEST PRIORITY: Use params.model if provided (direct specification)
    if (params?.model) {
      elizaLogger.debug(`✅ Using params.model: ${params.model}`);
      return params.model;
    }

    // 2. MEDIUM PRIORITY: Provider-specific model mappings (fallback)
    const providerModels: Record<string, Record<ModelTypeName, string>> = {
      openai: {
        [ModelType.TEXT_LARGE]: runtime?.getSetting('OPENAI_LARGE_MODEL') || 'gpt-4',
        [ModelType.OBJECT_LARGE]: runtime?.getSetting('OPENAI_LARGE_MODEL') || 'gpt-4',
        [ModelType.TEXT_SMALL]: runtime?.getSetting('OPENAI_SMALL_MODEL') || 'gpt-3.5-turbo',
        [ModelType.OBJECT_SMALL]: runtime?.getSetting('OPENAI_SMALL_MODEL') || 'gpt-3.5-turbo',
        [ModelType.TEXT_EMBEDDING]: 'text-embedding-3-large',
      },
      anthropic: {
        [ModelType.TEXT_LARGE]:
          runtime?.getSetting('ANTHROPIC_LARGE_MODEL') || 'claude-3-5-sonnet-20241022',
        [ModelType.OBJECT_LARGE]:
          runtime?.getSetting('ANTHROPIC_LARGE_MODEL') || 'claude-3-5-sonnet-20241022',
        [ModelType.TEXT_SMALL]:
          runtime?.getSetting('ANTHROPIC_SMALL_MODEL') || 'claude-3-5-haiku-20241022',
        [ModelType.OBJECT_SMALL]:
          runtime?.getSetting('ANTHROPIC_SMALL_MODEL') || 'claude-3-5-haiku-20241022',
      },
      google: {
        [ModelType.TEXT_LARGE]: runtime?.getSetting('GOOGLE_LARGE_MODEL') || 'gemini-pro',
        [ModelType.OBJECT_LARGE]: runtime?.getSetting('GOOGLE_LARGE_MODEL') || 'gemini-pro',
        [ModelType.TEXT_SMALL]: runtime?.getSetting('GOOGLE_SMALL_MODEL') || 'gemini-pro',
        [ModelType.OBJECT_SMALL]: runtime?.getSetting('GOOGLE_SMALL_MODEL') || 'gemini-pro',
      },
      groq: {
        [ModelType.TEXT_LARGE]: 'llama-3.1-8b-instant',
        [ModelType.OBJECT_LARGE]: 'llama-3.1-8b-instant',
        [ModelType.TEXT_SMALL]: 'llama-3.1-8b-instant',
        [ModelType.OBJECT_SMALL]: 'llama-3.1-8b-instant',
      },
      openrouter: {
        [ModelType.TEXT_LARGE]: runtime?.getSetting('OPENROUTER_LARGE_MODEL') || 'gpt-4o',
        [ModelType.OBJECT_LARGE]: runtime?.getSetting('OPENROUTER_LARGE_MODEL') || 'gpt-4o',
        [ModelType.TEXT_SMALL]: runtime?.getSetting('OPENROUTER_SMALL_MODEL') || 'gpt-4o-mini',
        [ModelType.OBJECT_SMALL]: runtime?.getSetting('OPENROUTER_SMALL_MODEL') || 'gpt-4o-mini',
      },
    };

    const providerConfig = providerModels[provider];
    const fallbackModel = providerConfig?.[modelType] || `${provider}-${modelType.toLowerCase()}`;

    elizaLogger.debug(`⚠️ Using fallback model mapping: ${fallbackModel}`);
    return fallbackModel;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private extractTextFromResult(result: any): string {
    if (typeof result === 'string') return result;
    if (result?.text) return result.text;
    if (result?.content) return result.content;
    if (result?.choices?.[0]?.text) return result.choices[0].text;
    if (result?.choices?.[0]?.message?.content) return result.choices[0].message.content;
    return JSON.stringify(result).substring(0, 1000);
  }

  public getCostSummary(): CostSummary {
    return {
      totalCosts: this.totalCosts,
      sessionCosts: Object.fromEntries(this.sessionCosts),
      isEnabled: this.isEnabled,
      skippedEmbeddingCalls: this.skippedEmbeddingCalls,
    };
  }

  async stop(): Promise<void> {
    if (this.isEnabled && this.langfuse) {
      try {
        elizaLogger.info('🔄 Shutting down Langfuse SDK...');
        elizaLogger.info(
          `💰 Final cost summary: $${this.totalCosts.toFixed(4)} total across ${this.sessionCosts.size} sessions`
        );

        await this.langfuse.shutdownAsync();
        elizaLogger.info('✅ Langfuse SDK shutdown complete');
      } catch (error) {
        elizaLogger.warn('⚠️ Error during Langfuse shutdown:', error);
      }
    }
  }

  /**
   * Simple helper to extract user ID from model call context
   */
  private extractUserIdFromContext(params: any, runtime: IAgentRuntime): string {
    // Try to get user ID from various sources:
    // 1. Direct from params (if actions pass user context)
    if (params?.entityId) {
      return params.entityId;
    }

    // 2. From user-related fields in params
    if (params?.userId) {
      return params.userId;
    }

    // 3. From message context if available
    if (params?.message?.entityId) {
      return params.message.entityId;
    }

    // 4. From state context if available
    if (params?.state?.userId) {
      return params.state.userId;
    }

    // 5. Try to get from runtime's current action context
    const currentContext = (runtime as any).currentActionContext;
    if (currentContext?.entityId) {
      return currentContext.entityId;
    }

    // 6. Fallback to agent ID (this means we couldn't determine the user)
    return runtime.agentId;
  }
}
