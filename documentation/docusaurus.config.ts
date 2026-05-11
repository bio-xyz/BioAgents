import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  baseUrl: "/documentation/",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  onBrokenLinks: "warn",

  organizationName: "bio-xyz",

  presets: [
    [
      "classic",
      {
        blog: false, // Disable blog
        docs: {
          editUrl: "https://github.com/bio-xyz/BioAgents/tree/main/documentation/",
          path: "content",
          routeBasePath: "/", // Docs at root - no /docs prefix
          sidebarPath: "./sidebars.ts",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],
  projectName: "BioAgents",
  tagline: "AI-powered research agents for biological sciences",

  themeConfig: {
    colorMode: {
      defaultMode: "light",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    footer: {
      copyright: `Copyright © ${new Date().getFullYear()} Bio.xyz`,
      links: [
        {
          items: [
            {
              label: "Getting Started",
              to: "/",
            },
            {
              label: "Installation",
              to: "/getting-started/installation",
            },
            {
              label: "Configuration",
              to: "/getting-started/configuration",
            },
          ],
          title: "Documentation",
        },
        {
          items: [
            {
              label: "Architecture",
              to: "/architecture/overview",
            },
            {
              label: "Deployment",
              to: "/deployment/docker",
            },
          ],
          title: "Reference",
        },
        {
          items: [
            {
              href: "https://github.com/bio-xyz/BioAgents",
              label: "GitHub",
            },
            {
              href: "https://bio.xyz",
              label: "Bio.xyz",
            },
          ],
          title: "Community",
        },
      ],
      style: "light",
    },
    image: "img/BIOLogo.svg",
    navbar: {
      items: [
        {
          label: "Documentation",
          position: "left",
          to: "/",
        },
        {
          href: "https://github.com/bio-xyz/BioAgents",
          label: "GitHub",
          position: "right",
        },
      ],
      logo: {
        alt: "BioAgents Logo",
        src: "img/BIOLogo.svg",
        srcDark: "img/BIOLogo-dark.svg",
      },
      title: "BioAgents",
    },
    prism: {
      additionalLanguages: ["bash", "typescript", "json", "yaml", "docker"],
      darkTheme: prismThemes.dracula,
      theme: prismThemes.github,
    },
  } satisfies Preset.ThemeConfig,

  themes: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        docsDir: "content",
        docsRouteBasePath: "/",
        explicitSearchResultPath: true,
        hashed: true,
        highlightSearchTermsOnTargetPage: true,
        indexBlog: false,
        language: ["en"],
        removeDefaultStemmer: true,
        searchBarPosition: "right",
        searchBarShortcutHint: false,
        searchContextByPaths: ["getting-started", "guides", "architecture", "deployment"],
      },
    ],
  ],
  title: "BioAgents",

  url: "https://bio-xyz.github.io",
};

export default config;
