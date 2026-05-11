import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      collapsed: false,
      items: [
        "getting-started/introduction",
        "getting-started/installation",
        "getting-started/configuration",
      ],
      label: "Getting Started",
      type: "category",
    },
    {
      collapsed: false,
      items: [
        "guides/authentication",
        "guides/deep-research",
        "guides/file-upload",
        "guides/job-queue",
        "guides/websocket",
      ],
      label: "Guides",
      type: "category",
    },
    {
      collapsed: true,
      items: ["architecture/overview"],
      label: "Architecture",
      type: "category",
    },
    {
      collapsed: true,
      items: ["deployment/docker"],
      label: "Deployment",
      type: "category",
    },
  ],
};

export default sidebars;
