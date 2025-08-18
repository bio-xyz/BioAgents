import { elizaLogger } from '@elizaos/core';

/**
 * Dynamic model configuration that can be updated at runtime
 */
export interface ModelConfig {
    providers: Record<string, ProviderConfig>;
    costOverrides: Record<string, { input: number; output: number }>;
    modelAliases: Record<string, string>;
    extractionRules: ExtractionRule[];
    monitoring: MonitoringConfig;
}

interface ProviderConfig {
    name: string;
    priority: number;
    modelPaths: string[];
    responseHeaders: string[];
    patterns: RegExp[];
    costMultiplier?: number;
    rateLimits?: {
        requestsPerMinute: number;
        tokensPerMinute: number;
    };
}

interface ExtractionRule {
    name: string;
    condition: (result: any, provider?: string) => boolean;
    extract: (result: any) => string | null;
    confidence: 'high' | 'medium' | 'low';
}

interface MonitoringConfig {
    alertOnCostSpike: boolean;
    costSpikeThreshold: number; // percentage increase
    alertOnModelMismatch: boolean;
    trackUnknownModels: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Default configuration that can be extended
 */
const DEFAULT_CONFIG: ModelConfig = {
    providers: {
        openai: {
            name: 'OpenAI',
            priority: 1,
            modelPaths: ['model', 'object', 'usage.model'],
            responseHeaders: ['openai-model', 'x-request-id'],
            patterns: [
                /gpt-[\d\.]+(o|turbo|mini|nano)?(-\w+)?/i,
                /o\d+(-\w+)?/i,
                /text-embedding-[\w-]+/i
            ]
        },
        anthropic: {
            name: 'Anthropic',
            priority: 1,
            modelPaths: ['model', 'usage.model', '_response.model'],
            responseHeaders: ['anthropic-version', 'request-id'],
            patterns: [
                /claude-[\d\.]+-[\w-]+(-\d+)?/i,
                /claude-opus-\d+-\d+/i
            ]
        },
        google: {
            name: 'Google',
            priority: 1,
            modelPaths: ['model', 'modelDisplayName', 'candidates[0].model'],
            responseHeaders: ['x-goog-request-id'],
            patterns: [
                /gemini-[\d\.]+-[\w-]+/i,
                /models\/[\w-]+/i
            ]
        }
    },
    costOverrides: {},
    modelAliases: {
        'gpt-4o': 'gpt-4o',
        'gpt-4o-mini': 'gpt-4o-mini',
        'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku': 'claude-3-5-haiku-20241022'
    },
    extractionRules: [
        {
            name: 'openai-direct',
            condition: (result, provider) => provider === 'openai' && result?.model,
            extract: (result) => result.model,
            confidence: 'high'
        },
        {
            name: 'anthropic-direct',
            condition: (result, provider) => provider === 'anthropic' && result?.model,
            extract: (result) => result.model,
            confidence: 'high'
        }
    ],
    monitoring: {
        alertOnCostSpike: true,
        costSpikeThreshold: 50, // 50% increase
        alertOnModelMismatch: true,
        trackUnknownModels: true,
        logLevel: 'info'
    }
};

/**
 * Runtime configuration manager
 */
export class ModelConfigManager {
    private config: ModelConfig;
    private configUpdateHandlers: Array<(config: ModelConfig) => void> = [];

    constructor(initialConfig?: Partial<ModelConfig>) {
        this.config = this.mergeConfig(DEFAULT_CONFIG, initialConfig || {});
    }

    /**
     * Get current configuration
     */
    getConfig(): ModelConfig {
        return { ...this.config };
    }

    /**
     * Update configuration at runtime
     */
    updateConfig(updates: Partial<ModelConfig>): void {
        const oldConfig = { ...this.config };
        this.config = this.mergeConfig(this.config, updates);

        elizaLogger.info('📝 Model configuration updated', {
            changes: this.getConfigDiff(oldConfig, this.config)
        });

        // Notify handlers
        this.configUpdateHandlers.forEach(handler => {
            try {
                handler(this.config);
            } catch (error) {
                elizaLogger.error('Error in config update handler:', error);
            }
        });
    }

    /**
     * Add a provider configuration
     */
    addProvider(providerId: string, config: ProviderConfig): void {
        this.updateConfig({
            providers: {
                ...this.config.providers,
                [providerId]: config
            }
        });
    }

    /**
     * Add cost override for a specific model
     */
    addCostOverride(modelName: string, costs: { input: number; output: number }): void {
        this.updateConfig({
            costOverrides: {
                ...this.config.costOverrides,
                [modelName]: costs
            }
        });
    }

    /**
     * Add custom extraction rule
     */
    addExtractionRule(rule: ExtractionRule): void {
        this.updateConfig({
            extractionRules: [...this.config.extractionRules, rule]
        });
    }

    /**
     * Subscribe to configuration changes
     */
    onConfigUpdate(handler: (config: ModelConfig) => void): () => void {
        this.configUpdateHandlers.push(handler);

        // Return unsubscribe function
        return () => {
            const index = this.configUpdateHandlers.indexOf(handler);
            if (index > -1) {
                this.configUpdateHandlers.splice(index, 1);
            }
        };
    }

    /**
     * Load configuration from environment or external source
     */
    async loadFromEnvironment(): Promise<void> {
        try {
            // Load from environment variables
            const envConfig = this.parseEnvironmentConfig();
            if (Object.keys(envConfig).length > 0) {
                this.updateConfig(envConfig);
                elizaLogger.info('🔧 Loaded configuration from environment');
            }
        } catch (error) {
            elizaLogger.warn('Failed to load configuration from environment:', error);
        }
    }

    /**
     * Validate configuration
     */
    validateConfig(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Validate providers
        for (const [providerId, provider] of Object.entries(this.config.providers)) {
            if (!provider.name) {
                errors.push(`Provider ${providerId} missing name`);
            }
            if (!provider.modelPaths || provider.modelPaths.length === 0) {
                errors.push(`Provider ${providerId} missing model paths`);
            }
        }

        // Validate extraction rules
        this.config.extractionRules.forEach((rule, index) => {
            if (!rule.name) {
                errors.push(`Extraction rule at index ${index} missing name`);
            }
            if (typeof rule.condition !== 'function') {
                errors.push(`Extraction rule ${rule.name} missing condition function`);
            }
        });

        return {
            valid: errors.length === 0,
            errors
        };
    }

    private mergeConfig(base: ModelConfig, updates: Partial<ModelConfig>): ModelConfig {
        return {
            providers: { ...base.providers, ...updates.providers },
            costOverrides: { ...base.costOverrides, ...updates.costOverrides },
            modelAliases: { ...base.modelAliases, ...updates.modelAliases },
            extractionRules: updates.extractionRules || base.extractionRules,
            monitoring: { ...base.monitoring, ...updates.monitoring }
        };
    }

    private getConfigDiff(oldConfig: ModelConfig, newConfig: ModelConfig): Record<string, any> {
        const diff: Record<string, any> = {};

        // Compare providers
        const oldProviders = Object.keys(oldConfig.providers);
        const newProviders = Object.keys(newConfig.providers);
        if (oldProviders.length !== newProviders.length ||
            !oldProviders.every(p => newProviders.includes(p))) {
            diff.providers = {
                added: newProviders.filter(p => !oldProviders.includes(p)),
                removed: oldProviders.filter(p => !newProviders.includes(p))
            };
        }

        // Compare cost overrides
        const oldOverrides = Object.keys(oldConfig.costOverrides);
        const newOverrides = Object.keys(newConfig.costOverrides);
        if (oldOverrides.length !== newOverrides.length ||
            !oldOverrides.every(o => newOverrides.includes(o))) {
            diff.costOverrides = {
                added: newOverrides.filter(o => !oldOverrides.includes(o)),
                removed: oldOverrides.filter(o => !newOverrides.includes(o))
            };
        }

        return diff;
    }

    private parseEnvironmentConfig(): Partial<ModelConfig> {
        const config: Partial<ModelConfig> = {};

        // Parse monitoring settings from environment
        const costSpikeThreshold = process.env.LANGFUSE_COST_SPIKE_THRESHOLD;
        if (costSpikeThreshold) {
            config.monitoring = {
                ...DEFAULT_CONFIG.monitoring,
                costSpikeThreshold: parseInt(costSpikeThreshold, 10)
            };
        }

        const logLevel = process.env.LANGFUSE_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
        if (logLevel) {
            config.monitoring = {
                ...config.monitoring || DEFAULT_CONFIG.monitoring,
                logLevel
            };
        }

        // Parse custom model costs from environment
        const customCosts = process.env.LANGFUSE_CUSTOM_MODEL_COSTS;
        if (customCosts) {
            try {
                config.costOverrides = JSON.parse(customCosts);
            } catch (error) {
                elizaLogger.warn('Failed to parse LANGFUSE_CUSTOM_MODEL_COSTS:', error);
            }
        }

        return config;
    }
}

// Export singleton instance
export const modelConfigManager = new ModelConfigManager(); 