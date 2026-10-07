import { fileURLToPath } from 'node:url';
import { reviewApiPlugin } from '../review-api.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default {
  framework: { name: '@storybook/html-vite', options: {} },
  stories: ['../stories/**/*.stories.js'],
  addons: [],
  core: { disableTelemetry: true },
  async viteFinal(config, { configType }) {
    const { mergeConfig } = await import('vite');
    return mergeConfig(config, {
      plugins: configType === 'DEVELOPMENT' ? [reviewApiPlugin(root)] : [],
      define: { __ELMA_REVIEW_ENABLED__: JSON.stringify(configType === 'DEVELOPMENT') },
      server: { host: '127.0.0.1', strictPort: true, fs: { allow: [root] } }
    });
  }
};
