import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: [
    '../src/components/ui/**/*.stories.@(ts|tsx)',
    '../src/components/layout/**/*.stories.@(ts|tsx)',
    '../src/components/trakon/**/*.stories.@(ts|tsx)',
    '../src/app/**/*.stories.@(ts|tsx)',
    '../src/features/**/*.stories.@(ts|tsx)',
    '../src/styles/**/*.stories.@(ts|tsx)',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  // apps/web/vite.config.ts は vitest/config の defineConfig を使っており
  // Vitest のプロジェクト設定まで引き込んでしまうため、直接 import せず
  // Storybook に必要なプラグイン (Tailwind) とエイリアスだけをここで明示する。
  async viteFinal(viteConfig) {
    return mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '../src'),
        },
      },
    });
  },
};

export default config;
