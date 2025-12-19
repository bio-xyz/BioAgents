import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'BioAgents',
  tagline: 'AI-powered research agents for biological sciences',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://bio-xyz.github.io',
  baseUrl: '/documentation/',

  organizationName: 'bio-xyz',
  projectName: 'BioAgents',

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'content',
          routeBasePath: '/', // Docs at root - no /docs prefix
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/bio-xyz/BioAgents/tree/main/documentation/',
        },
        blog: false, // Disable blog
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        docsDir: 'content',
        docsRouteBasePath: '/',
        indexBlog: false,
        searchBarShortcutHint: false,
        searchBarPosition: 'right',
        searchContextByPaths: ['getting-started', 'guides', 'architecture', 'deployment'],
        removeDefaultStemmer: true,
      },
    ],
  ],

  themeConfig: {
    image: 'img/BIOLogo.svg',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'BioAgents',
      logo: {
        alt: 'BioAgents Logo',
        src: 'img/BIOLogo.svg',
        srcDark: 'img/BIOLogo-dark.svg',
      },
      items: [
        {
          to: '/',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/bio-xyz/BioAgents',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/',
            },
            {
              label: 'Installation',
              to: '/getting-started/installation',
            },
            {
              label: 'Configuration',
              to: '/getting-started/configuration',
            },
          ],
        },
        {
          title: 'Reference',
          items: [
            {
              label: 'Architecture',
              to: '/architecture/overview',
            },
            {
              label: 'Deployment',
              to: '/deployment/docker',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/bio-xyz/BioAgents',
            },
            {
              label: 'Bio.xyz',
              href: 'https://bio.xyz',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Bio.xyz`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'typescript', 'json', 'yaml', 'docker'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
