import type { Plugin, Action, IAgentRuntime, Memory, HandlerCallback, State } from '@elizaos/core';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface Survey {
  name: string;
  description: string;
  triggers: string[];
  questions: string[];
  scoring: string;
  prompt: string;
}

const loadSurveys = (): Survey[] => {
  const surveySource = process.env.SURVEY_SOURCE || './surveys.json';
  const surveysPath = resolve(surveySource);

  try {
    const surveysData = readFileSync(surveysPath, 'utf-8');
    return JSON.parse(surveysData);
  } catch (error) {
    console.error('Failed to load surveys from', surveysPath, ':', error);
    return [];
  }
};

const SURVEYS: Survey[] = loadSurveys();

const triggerSurveyAction: Action = {
  name: 'TRIGGER_SURVEY',
  similes: ['survey', 'assessment', 'screening', 'test'],
  description: `Offers relevant health surveys when user mentions trigger topics. DO NOT offer surveys if user recently completed one in this chat.

Available surveys:
${SURVEYS.map(
  (survey) => `- ${survey.name} (${survey.description}): Triggers: ${survey.triggers.join(', ')}`
).join('\n')}`,

  validate: async (runtime: IAgentRuntime, message: Memory) => {
    // Don't trigger for Twitter messages
    if (message.content?.source === 'twitter') return false;

    const text = message.content?.text?.toLowerCase() || '';

    return SURVEYS.some((survey) => survey.triggers.some((trigger) => text.includes(trigger)));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ) => {
    const text = message.content?.text?.toLowerCase() || '';

    const relevantSurveys = SURVEYS.filter((survey) =>
      survey.triggers.some((trigger) => text.includes(trigger))
    );

    if (relevantSurveys.length === 0) return false;

    // Check cache for each survey to see if user has taken it within 6 hours
    const availableSurveys = [];
    const sixHoursInMs = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

    for (const survey of relevantSurveys) {
      const cacheKey = `survey:${survey.name}:${message.entityId}`;
      const cachedData: { timestamp: number; surveyName: string } | undefined =
        await runtime.getCache(cacheKey);

      if (cachedData) {
        const timeSinceLastSurvey = Date.now() - cachedData.timestamp;
        if (timeSinceLastSurvey < sixHoursInMs) {
          // Skip this survey - user took it within 6 hours
          continue;
        }
      }

      availableSurveys.push(survey);
    }

    if (availableSurveys.length === 0) {
      // All relevant surveys were taken within 6 hours
      return false;
    }

    const surveyContent = availableSurveys
      .map((survey) => {
        const questionsText = survey.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
        return `**${survey.name} (${survey.description})**\n\n${questionsText}\n\n**Scoring:** ${survey.scoring}`;
      })
      .join('\n\n---\n\n');

    // Cache that the user was offered these surveys
    for (const survey of availableSurveys) {
      const cacheKey = `survey:${survey.name}:${message.entityId}`;
      await runtime.setCache(cacheKey, {
        timestamp: Date.now(),
        surveyName: survey.name,
      });
    }

    const response = {
      text: surveyContent,
      content: {
        text: surveyContent,
      },
    };

    if (callback) {
      callback(response);
    }

    return true;
  },
};

const plugin: Plugin = {
  name: 'survey',
  description:
    'Health assessment survey plugin that offers clinical screenings based on user symptoms',
  actions: [triggerSurveyAction],
};

console.log('Survey plugin loaded');
export default plugin;
