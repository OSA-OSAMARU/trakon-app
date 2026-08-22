import React from 'react';
import type { Preview } from '@storybook/react';
import '../src/styles/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  // アプリ本体と同じ暖色グレー背景 (--content) の上で確認する
  decorators: [
    (Story) =>
      React.createElement(
        'div',
        { className: 'bg-content text-foreground min-h-screen p-4' },
        React.createElement(Story),
      ),
  ],
};

export default preview;
