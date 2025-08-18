import { elizaLogger } from '@elizaos/core';
import { modelConfigManager } from '../config/model-config';

/**
 * Production monitoring system for model detection and costs
 */
export class ModelMonitor {
  private static instance: ModelMonitor;
  private metrics = new Map<string, ModelMetrics>();
  private alerts = new Map<string, AlertState>();
  private costHistory: CostEntry[] = [];
  private unknownModels = new Set<string>();
  private detectionFailures: DetectionFailure[] = [];

  private constructor() {
    // Start background monitoring
    this.startBackgroundMonitoring();
  }

  static getInstance(): ModelMonitor {
    if (!ModelMonitor.instance) {
      ModelMonitor.instance = new ModelMonitor();
    }
    return ModelMonitor.instance;
  }

  /**
   * Record a model usage event
   */
  recordModelUsage(info: {
    modelType: string;
    expectedModel: string;
    actualModel: string | null;
    confidence: 'high' | 'medium' | 'low';
    source: string;
    cost: number;
    tokens: { input: number; output: number };
    provider?: string;
    sessionId: string;
    duration: number;
  }): void {
    const key = info.actualModel || info.expectedModel;
    const now = Date.now();

    // Update model metrics
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        totalCalls: 0,
        totalCost: 0,
        totalTokens: 0,
        averageCost: 0,
        averageDuration: 0,
        confidenceDistribution: { high: 0, medium: 0, low: 0 },
        lastUsed: now,
        provider: info.provider,
      });
    }

    const metrics = this.metrics.get(key)!;
    metrics.totalCalls++;
    metrics.totalCost += info.cost;
    metrics.totalTokens += info.tokens.input + info.tokens.output;
    metrics.averageCost = metrics.totalCost / metrics.totalCalls;
    metrics.averageDuration =
      (metrics.averageDuration * (metrics.totalCalls - 1) + info.duration) / metrics.totalCalls;
    metrics.confidenceDistribution[info.confidence]++;
    metrics.lastUsed = now;

    // Record cost history
    this.costHistory.push({
      timestamp: now,
      model: key,
      cost: info.cost,
      tokens: info.tokens.input + info.tokens.output,
      sessionId: info.sessionId,
    });

    // Trim old cost history (keep last 24 hours)
    const dayAgo = now - 24 * 60 * 60 * 1000;
    this.costHistory = this.costHistory.filter((entry) => entry.timestamp > dayAgo);

    // Track unknown models
    if (info.confidence === 'low' && info.actualModel !== info.expectedModel) {
      this.unknownModels.add(info.actualModel || 'unknown');
    }

    // Record detection failure if confidence is low
    if (info.confidence === 'low') {
      this.recordDetectionFailure({
        timestamp: now,
        expectedModel: info.expectedModel,
        actualModel: info.actualModel,
        source: info.source,
        provider: info.provider,
        reason: 'low_confidence',
      });
    }

    // Check for alerts
    this.checkAlerts(info);

    // Log detailed metrics periodically
    if (metrics.totalCalls % 100 === 0) {
      this.logModelMetrics(key, metrics);
    }
  }

  /**
   * Get comprehensive model metrics
   */
  getMetrics(): ModelMonitorMetrics {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;

    const recentCosts = this.costHistory.filter((entry) => entry.timestamp > hourAgo);
    const totalRecentCost = recentCosts.reduce((sum, entry) => sum + entry.cost, 0);

    return {
      totalModels: this.metrics.size,
      totalCalls: Array.from(this.metrics.values()).reduce((sum, m) => sum + m.totalCalls, 0),
      totalCost: Array.from(this.metrics.values()).reduce((sum, m) => sum + m.totalCost, 0),
      recentHourCost: totalRecentCost,
      unknownModelsCount: this.unknownModels.size,
      detectionFailuresCount: this.detectionFailures.length,
      averageConfidence: this.calculateAverageConfidence(),
      topModels: this.getTopModels(5),
      costTrend: this.getCostTrend(),
      alertsSummary: this.getAlertsSummary(),
    };
  }

  /**
   * Get detailed model breakdown
   */
  getModelBreakdown(): ModelBreakdown[] {
    return Array.from(this.metrics.entries()).map(([model, metrics]) => ({
      model,
      ...metrics,
      costPercentage: (metrics.totalCost / this.getTotalCost()) * 100,
      efficiency: this.calculateEfficiency(metrics),
    }));
  }

  /**
   * Get recent detection failures
   */
  getDetectionFailures(limit = 50): DetectionFailure[] {
    return this.detectionFailures.slice(-limit).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get cost analysis
   */
  getCostAnalysis(): CostAnalysis {
    const now = Date.now();
    const periods = {
      hour: now - 60 * 60 * 1000,
      day: now - 24 * 60 * 60 * 1000,
      week: now - 7 * 24 * 60 * 60 * 1000,
    };

    const analysis: CostAnalysis = {
      periods: {},
      topCostModels: [],
      costEfficiency: {},
      projectedMonthlyCost: 0,
    };

    // Calculate costs for different periods
    for (const [period, startTime] of Object.entries(periods)) {
      const periodCosts = this.costHistory.filter((entry) => entry.timestamp > startTime);
      analysis.periods[period] = {
        totalCost: periodCosts.reduce((sum, entry) => sum + entry.cost, 0),
        totalTokens: periodCosts.reduce((sum, entry) => sum + entry.tokens, 0),
        calls: periodCosts.length,
      };
    }

    // Calculate projected monthly cost
    const dailyCost = analysis.periods.day?.totalCost || 0;
    analysis.projectedMonthlyCost = dailyCost * 30;

    // Get top cost models
    analysis.topCostModels = this.getTopModels(10);

    return analysis;
  }

  private checkAlerts(info: any): void {
    const config = modelConfigManager.getConfig();

    // Cost spike alert
    if (config.monitoring.alertOnCostSpike) {
      this.checkCostSpikeAlert(info);
    }

    // Model mismatch alert
    if (config.monitoring.alertOnModelMismatch && info.actualModel !== info.expectedModel) {
      this.triggerAlert('model_mismatch', {
        expected: info.expectedModel,
        actual: info.actualModel,
        confidence: info.confidence,
        provider: info.provider,
      });
    }

    // Unknown model alert
    if (config.monitoring.trackUnknownModels && info.confidence === 'low') {
      this.triggerAlert('unknown_model', {
        model: info.actualModel || 'unknown',
        provider: info.provider,
        confidence: info.confidence,
      });
    }
  }

  private checkCostSpikeAlert(info: any): void {
    const config = modelConfigManager.getConfig();
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;

    const recentCosts = this.costHistory.filter((entry) => entry.timestamp > hourAgo);
    const currentHourCost = recentCosts.reduce((sum, entry) => sum + entry.cost, 0);

    // Compare with previous hour
    const twoHoursAgo = hourAgo - 60 * 60 * 1000;
    const previousHourCosts = this.costHistory.filter(
      (entry) => entry.timestamp > twoHoursAgo && entry.timestamp <= hourAgo
    );
    const previousHourCost = previousHourCosts.reduce((sum, entry) => sum + entry.cost, 0);

    if (previousHourCost > 0) {
      const increase = ((currentHourCost - previousHourCost) / previousHourCost) * 100;

      if (increase > config.monitoring.costSpikeThreshold) {
        this.triggerAlert('cost_spike', {
          currentCost: currentHourCost,
          previousCost: previousHourCost,
          increase: increase.toFixed(2),
          threshold: config.monitoring.costSpikeThreshold,
        });
      }
    }
  }

  private triggerAlert(type: string, data: any): void {
    if (
      !this.alerts.has(type) ||
      Date.now() - this.alerts.get(type)!.lastTriggered > 60 * 60 * 1000
    ) {
      this.alerts.set(type, {
        type,
        count: (this.alerts.get(type)?.count || 0) + 1,
        lastTriggered: Date.now(),
        data,
      });

      elizaLogger.warn(`🚨 Langfuse Alert: ${type}`, data);
    }
  }

  private recordDetectionFailure(failure: DetectionFailure): void {
    this.detectionFailures.push(failure);

    // Keep only last 1000 failures
    if (this.detectionFailures.length > 1000) {
      this.detectionFailures = this.detectionFailures.slice(-1000);
    }
  }

  private startBackgroundMonitoring(): void {
    // Log summary metrics every 5 minutes
    setInterval(
      () => {
        const metrics = this.getMetrics();
        elizaLogger.info('📊 Langfuse Model Monitor Summary', {
          totalModels: metrics.totalModels,
          totalCalls: metrics.totalCalls,
          totalCost: metrics.totalCost.toFixed(6),
          recentHourCost: metrics.recentHourCost.toFixed(6),
          unknownModels: metrics.unknownModelsCount,
          detectionFailures: metrics.detectionFailuresCount,
        });
      },
      5 * 60 * 1000
    );

    // Clear old data every hour
    setInterval(
      () => {
        this.cleanupOldData();
      },
      60 * 60 * 1000
    );
  }

  private cleanupOldData(): void {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Clear old detection failures
    this.detectionFailures = this.detectionFailures.filter(
      (failure) => failure.timestamp > weekAgo
    );

    // Clear old alerts
    for (const [key, alert] of this.alerts.entries()) {
      if (now - alert.lastTriggered > 24 * 60 * 60 * 1000) {
        this.alerts.delete(key);
      }
    }
  }

  private calculateAverageConfidence(): number {
    const allMetrics = Array.from(this.metrics.values());
    const totalDistribution = allMetrics.reduce(
      (acc, metrics) => ({
        high: acc.high + metrics.confidenceDistribution.high,
        medium: acc.medium + metrics.confidenceDistribution.medium,
        low: acc.low + metrics.confidenceDistribution.low,
      }),
      { high: 0, medium: 0, low: 0 }
    );

    const total = totalDistribution.high + totalDistribution.medium + totalDistribution.low;
    if (total === 0) return 0;

    return (
      (totalDistribution.high * 3 + totalDistribution.medium * 2 + totalDistribution.low * 1) /
      (total * 3)
    );
  }

  private getTopModels(limit: number): Array<{ model: string; cost: number; calls: number }> {
    return Array.from(this.metrics.entries())
      .map(([model, metrics]) => ({
        model,
        cost: metrics.totalCost,
        calls: metrics.totalCalls,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, limit);
  }

  private getCostTrend(): 'increasing' | 'decreasing' | 'stable' {
    if (this.costHistory.length < 10) return 'stable';

    const recent = this.costHistory.slice(-5);
    const older = this.costHistory.slice(-10, -5);

    const recentAvg = recent.reduce((sum, entry) => sum + entry.cost, 0) / recent.length;
    const olderAvg = older.reduce((sum, entry) => sum + entry.cost, 0) / older.length;

    const change = (recentAvg - olderAvg) / olderAvg;

    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private getTotalCost(): number {
    return Array.from(this.metrics.values()).reduce((sum, m) => sum + m.totalCost, 0);
  }

  private calculateEfficiency(metrics: ModelMetrics): number {
    // Calculate efficiency as cost per token
    return metrics.totalTokens > 0 ? metrics.totalCost / metrics.totalTokens : 0;
  }

  private getAlertsSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const alert of this.alerts.values()) {
      summary[alert.type] = (summary[alert.type] || 0) + alert.count;
    }
    return summary;
  }

  private logModelMetrics(model: string, metrics: ModelMetrics): void {
    elizaLogger.info(`📈 Model Metrics: ${model}`, {
      calls: metrics.totalCalls,
      cost: metrics.totalCost.toFixed(6),
      avgCost: metrics.averageCost.toFixed(6),
      tokens: metrics.totalTokens,
      avgDuration: `${metrics.averageDuration.toFixed(2)}ms`,
      confidence: metrics.confidenceDistribution,
    });
  }
}

// Type definitions
interface ModelMetrics {
  totalCalls: number;
  totalCost: number;
  totalTokens: number;
  averageCost: number;
  averageDuration: number;
  confidenceDistribution: { high: number; medium: number; low: number };
  lastUsed: number;
  provider?: string;
}

interface ModelMonitorMetrics {
  totalModels: number;
  totalCalls: number;
  totalCost: number;
  recentHourCost: number;
  unknownModelsCount: number;
  detectionFailuresCount: number;
  averageConfidence: number;
  topModels: Array<{ model: string; cost: number; calls: number }>;
  costTrend: 'increasing' | 'decreasing' | 'stable';
  alertsSummary: Record<string, number>;
}

interface ModelBreakdown {
  model: string;
  totalCalls: number;
  totalCost: number;
  totalTokens: number;
  averageCost: number;
  averageDuration: number;
  confidenceDistribution: { high: number; medium: number; low: number };
  lastUsed: number;
  provider?: string;
  costPercentage: number;
  efficiency: number;
}

interface CostEntry {
  timestamp: number;
  model: string;
  cost: number;
  tokens: number;
  sessionId: string;
}

interface DetectionFailure {
  timestamp: number;
  expectedModel: string;
  actualModel: string | null;
  source: string;
  provider?: string;
  reason: string;
}

interface AlertState {
  type: string;
  count: number;
  lastTriggered: number;
  data: any;
}

interface CostAnalysis {
  periods: Record<string, { totalCost: number; totalTokens: number; calls: number }>;
  topCostModels: Array<{ model: string; cost: number; calls: number }>;
  costEfficiency: Record<string, number>;
  projectedMonthlyCost: number;
}

// Export singleton instance
export const modelMonitor = ModelMonitor.getInstance();
