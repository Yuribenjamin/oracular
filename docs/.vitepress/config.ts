import { defineConfig } from 'vitepress';
import typedocSidebar from '../api/typedoc-sidebar.json';

const site = 'https://yuribenjamin.github.io/oracular/';
const title = 'oracular';
const ogTitle = 'oracular: your app learns when the user is ready. Nothing leaves the device.';
const description =
  'A tiny, zero-dependency, pure-functional on-device intent engine. Feed it events; it tells you when a user is likely to upgrade, churn, get stuck or buy, with enough confidence to act, and shows its reasons.';

export default defineConfig({
  title,
  description,
  base: '/oracular/',
  lang: 'en-US',
  lastUpdated: true,
  sitemap: { hostname: site },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/oracular/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#3a6b8c' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: title }],
    ['meta', { property: 'og:title', content: ogTitle }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:url', content: site }],
    ['meta', { property: 'og:image', content: `${site}og-image.png` }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    [
      'meta',
      {
        property: 'og:image:alt',
        content:
          'A tray of cookies next to the words: oracular. Your app learns when the user is ready. Nothing leaves the device.',
      },
    ],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: ogTitle }],
    ['meta', { name: 'twitter:description', content: description }],
    ['meta', { name: 'twitter:image', content: `${site}og-image.png` }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'oracular',
    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
      { text: 'Playground', link: '/playground' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Quickstart', link: '/guide/quickstart' },
          ],
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Intents & priors', link: '/guide/concepts/intents-and-priors' },
            { text: 'Signals & weights', link: '/guide/concepts/signals-and-weights' },
            { text: 'Decay', link: '/guide/concepts/decay' },
            { text: 'Episodes & learning', link: '/guide/concepts/episodes-and-learning' },
            { text: 'Reveal & confidence', link: '/guide/concepts/reveal-and-confidence' },
            { text: 'Outcomes & cooldowns', link: '/guide/concepts/outcomes-and-cooldowns' },
          ],
        },
        {
          text: 'Going further',
          items: [
            { text: 'Persistence & migration', link: '/guide/persistence' },
            { text: 'Explainability', link: '/guide/explainability' },
            { text: 'Tuning guide', link: '/guide/tuning' },
            { text: 'Recipes', link: '/guide/recipes' },
            { text: 'Using with frameworks', link: '/guide/frameworks' },
          ],
        },
        {
          text: 'Project',
          items: [
            { text: 'FAQ', link: '/guide/faq' },
            { text: 'Roadmap', link: '/guide/roadmap' },
          ],
        },
      ],
      '/api/': [{ text: 'API reference', link: '/api/', items: typedocSidebar }],
    },
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Yuribenjamin/oracular' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/oracular' },
    ],
    editLink: {
      pattern: 'https://github.com/Yuribenjamin/oracular/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Ibrahim Ragab',
    },
    outline: { level: [2, 3] },
  },
});
