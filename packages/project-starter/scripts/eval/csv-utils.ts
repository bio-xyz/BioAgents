import { createObjectCsvWriter } from 'csv-writer';
import { ScoredEvaluation, AverageScores } from './types.js';

export class CSVExportUtils {
  static calculateAverageScores(scoredEvaluations: ScoredEvaluation[]): AverageScores {
    // Filter out questions that were ignored (no answer) from average calculation
    const answeredEvaluations = scoredEvaluations.filter(
      (evaluation) => evaluation.answer && evaluation.answer.trim().length > 0
    );

    if (answeredEvaluations.length === 0) {
      return {
        avg_completeness: '0',
        avg_relevance: '0',
        avg_tool_efficiency: '0',
        avg_safety_ethics: '0',
        avg_evidence_synthesis_quality: '0',
        avg_hallucinations: '0',
        avg_character_adherence: '0',
        avg_response_time_ms: '0',
        answered_questions_count: 0,
        total_questions_count: scoredEvaluations.length,
      };
    }

    const totals = answeredEvaluations.reduce(
      (acc, evaluation) => ({
        completeness: acc.completeness + evaluation.completeness,
        relevance: acc.relevance + evaluation.relevance,
        tool_efficiency: acc.tool_efficiency + evaluation.tool_efficiency,
        safety_ethics: acc.safety_ethics + evaluation.safety_ethics,
        evidence_synthesis_quality:
          acc.evidence_synthesis_quality + evaluation.evidence_synthesis_quality,
        hallucinations: acc.hallucinations + evaluation.hallucinations,
        character_adherence: acc.character_adherence + evaluation.character_adherence,
        response_time_ms: acc.response_time_ms + evaluation.response_time_ms,
      }),
      {
        completeness: 0,
        relevance: 0,
        tool_efficiency: 0,
        safety_ethics: 0,
        evidence_synthesis_quality: 0,
        hallucinations: 0,
        character_adherence: 0,
        response_time_ms: 0,
      }
    );

    const count = answeredEvaluations.length;

    return {
      avg_completeness: (totals.completeness / count).toFixed(2),
      avg_relevance: (totals.relevance / count).toFixed(2),
      avg_tool_efficiency: (totals.tool_efficiency / count).toFixed(2),
      avg_safety_ethics: (totals.safety_ethics / count).toFixed(2),
      avg_evidence_synthesis_quality: (totals.evidence_synthesis_quality / count).toFixed(2),
      avg_hallucinations: (totals.hallucinations / count).toFixed(2),
      avg_character_adherence: (totals.character_adherence / count).toFixed(2),
      avg_response_time_ms: (totals.response_time_ms / count).toFixed(0),
      answered_questions_count: count,
      total_questions_count: scoredEvaluations.length,
    };
  }

  static async exportToCSV(
    scoredEvaluations: ScoredEvaluation[],
    isExternalModel: boolean,
    externalModel?: string
  ): Promise<void> {
    console.log('\n📄 Exporting results to CSV...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const modelPrefix = isExternalModel && externalModel
      ? externalModel.replace(/[\/\-]/g, '_')
      : 'agent';
    const filename = `./packages/project-starter/scripts/eval/results/${modelPrefix}_evaluation_results_${timestamp}.csv`;

    // Calculate average scores
    const averageScores = this.calculateAverageScores(scoredEvaluations);

    // Add average scores as the first row
    const recordsWithAverages = [
      {
        id: 'AVERAGES',
        question: `Average Scores (${averageScores.answered_questions_count}/${averageScores.total_questions_count} answered)`,
        answer: 'N/A',
        factual_accuracy: 'N/A',
        completeness: averageScores.avg_completeness,
        relevance: averageScores.avg_relevance,
        tool_efficiency: averageScores.avg_tool_efficiency,
        response_time_ms: averageScores.avg_response_time_ms,
        safety_ethics: averageScores.avg_safety_ethics,
        evidence_synthesis_quality: averageScores.avg_evidence_synthesis_quality,
        hallucinations: averageScores.avg_hallucinations,
        character_adherence: averageScores.avg_character_adherence,
        created_at: 'N/A',
        channel_id: 'N/A',
      },
      ...scoredEvaluations,
    ];

    const csvWriter = createObjectCsvWriter({
      path: filename,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'question', title: 'Question' },
        { id: 'answer', title: 'Answer' },
        { id: 'factual_accuracy', title: 'Factual Accuracy (Human)' },
        { id: 'completeness', title: 'Completeness' },
        { id: 'relevance', title: 'Relevance' },
        { id: 'tool_efficiency', title: 'Tool Efficiency' },
        { id: 'response_time_ms', title: 'Response Time (ms)' },
        { id: 'safety_ethics', title: 'Safety & Ethics' },
        { id: 'evidence_synthesis_quality', title: 'Evidence Synthesis Quality' },
        { id: 'hallucinations', title: 'Hallucinations (5=no hallucinations)' },
        { id: 'character_adherence', title: 'Character Adherence' },
        { id: 'created_at', title: 'Created At' },
        { id: 'channel_id', title: 'Channel ID' },
      ],
    });

    try {
      await csvWriter.writeRecords(recordsWithAverages);
      console.log(`✅ Results exported to: ${filename}`);
      console.log(`📊 Total evaluations: ${scoredEvaluations.length}`);
      console.log(`📊 Answered questions: ${averageScores.answered_questions_count}`);
      console.log(`📊 Average scores calculated from answered questions only`);
    } catch (error) {
      console.error('❌ Failed to export CSV:', error);
    }
  }
}