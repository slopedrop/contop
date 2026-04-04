import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Contop - Docs',
  tagline: 'Your Desktop, From Anywhere',
  favicon: 'img/favicon.svg',

  url: 'https://docs.contop.dev',
  baseUrl: '/',

  organizationName: 'contop',
  projectName: 'contop',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
  },

  themes: [
    '@docusaurus/theme-mermaid',
    ['@easyops-cn/docusaurus-search-local', {
      hashed: true,
      indexBlog: false,
      docsRouteBasePath: '/',
      highlightSearchTermsOnTargetPage: true,
      searchBarShortcutHint: true,
    }],
  ],

  clientModules: [
    require.resolve('./src/mermaid-zoom.js'),
    require.resolve('./src/search-mobile-portal.js'),
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'Contop',
      logo: {
        alt: 'Contop Logo',
        src: 'img/contop-logo.svg',
      },
      items: [
        { type: 'docSidebar', sidebarId: 'gettingStartedSidebar', position: 'left', label: 'Getting Started' },
        { type: 'docSidebar', sidebarId: 'userGuideSidebar', position: 'left', label: 'User Guide' },
        { type: 'docSidebar', sidebarId: 'architectureSidebar', position: 'left', label: 'Architecture' },
        { type: 'docSidebar', sidebarId: 'developerGuideSidebar', position: 'left', label: 'Developer Guide' },
        { type: 'docSidebar', sidebarId: 'apiReferenceSidebar', position: 'left', label: 'API Reference' },
        { type: 'docSidebar', sidebarId: 'securitySidebar', position: 'left', label: 'Security' },
        {
          href: 'https://github.com/swaroop-contop/contop',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'python', 'rust', 'toml'],
    },
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    mermaid: {
      theme: { light: 'neutral', dark: 'dark' },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
