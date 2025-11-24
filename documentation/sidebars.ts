import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'html',
      value: '<hr style="margin: 0.5rem 0; border: none; border-top: 1px solid var(--ifm-toc-border-color);" />',
    },
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: true,
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: true,
      items: [
        'core-concepts/architecture',
        'core-concepts/state-management',
        'core-concepts/character-system',
      ],
    },
    {
      type: 'html',
      value: '<hr style="margin: 0.5rem 0; border: none; border-top: 1px solid var(--ifm-toc-border-color);" />',
    },
    {
      type: 'category',
      label: 'Agent Framework',
      collapsed: true,
      items: [
        'backend/architecture',
        'backend/routes',
        {
          type: 'category',
          label: 'Tools System',
          items: [
            'backend/tools/overview',
            'backend/tools/planning-tool',
            'backend/tools/knowledge-tool',
            'backend/tools/hypothesis-tool',
            'backend/tools/file-upload-tool',
            'backend/tools/semantic-scholar',
            'backend/tools/reply-tool',
          ],
        },
        'backend/llm-library',
        'backend/embeddings',
        'backend/middleware',
        'backend/services',
      ],
    },
    {
      type: 'category',
      label: 'Deep Research',
      collapsed: true,
      items: [
        'deep-research/introduction',
        'deep-research/overview',
        'deep-research/pipeline',
        'deep-research/configuration',
        'deep-research/workflow',
        'deep-research/api',
        'deep-research/best-practices',
        'deep-research/examples',
      ],
    },
    {
      type: 'category',
      label: 'Code Execution',
      collapsed: true,
      items: [
        'code-execution/overview',
        'code-execution/architecture',
        'code-execution/supported-languages',
        'code-execution/security',
        'code-execution/code-generation',
        'code-execution/execution-lifecycle',
        'code-execution/result-processing',
      ],
    },
    {
      type: 'html',
      value: '<hr style="margin: 0.5rem 0; border: none; border-top: 1px solid var(--ifm-toc-border-color);" />',
    },
    {
      type: 'category',
      label: 'Client UI',
      collapsed: true,
      items: [
        'frontend/overview',
        'frontend/components',
        'frontend/hooks',
        'frontend/styling',
      ],
    },
    {
      type: 'category',
      label: 'x402 Payment System',
      collapsed: true,
      items: [
        'x402-payments/overview',
        'x402-payments/setup',
        'x402-payments/embedded-wallets',
        'x402-payments/pricing',
        'x402-payments/authentication',
      ],
    },
    {
      type: 'html',
      value: '<hr style="margin: 0.5rem 0; border: none; border-top: 1px solid var(--ifm-toc-border-color);" />',
    },
    {
      type: 'category',
      label: 'API Reference',
      collapsed: true,
      items: [
        'api-reference/overview',
        'api-reference/rest-api',
        'api-reference/websocket',
        'api-reference/tools',
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      collapsed: true,
      items: [
        'deployment/docker',
        'deployment/production',
        'deployment/database',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: true,
      items: [
        'guides/creating-custom-tool',
        'guides/custom-character',
        'guides/processing-documents',
        'guides/integrating-new-llm',
      ],
    },
    {
      type: 'html',
      value: '<hr style="margin: 0.5rem 0; border: none; border-top: 1px solid var(--ifm-toc-border-color);" />',
    },
    'changelog',
  ],
};

export default sidebars;
