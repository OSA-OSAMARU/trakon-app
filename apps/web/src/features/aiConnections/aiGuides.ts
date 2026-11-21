/**
 * AI サービス別の接続手順 (設計書 08-mcp §8.11 / SC-22 `/help/ai`)
 *
 * 各社の画面名称は更新で変わりやすい。**ボタン名などは英語表示のラベルをそのまま書く**
 * (日本語表示の訳語は確認できないため)。手順を変えたら GUIDE_CHECKED_AT も更新する。
 *
 * 文中の `{{URL}}` は表示時に MCP サーバの URL (この環境のオリジン + /api/mcp) へ置き換える。
 */

/** 各社の公式ドキュメントで手順を確認した時期 */
export const GUIDE_CHECKED_AT = '2026年11月';

export type GuideStep = {
  text: string;
  /** コマンドや設定ファイルの例 (コピーできる) */
  code?: string;
};

export type AiGuide = {
  /** ページ内リンクのアンカー */
  id: string;
  name: string;
  /** 利用できるプラン・前提 */
  availability: string;
  steps: GuideStep[];
  /** 画面操作の代わりに設定ファイルへ書く方法など */
  alternative?: GuideStep;
  /** 接続したあと、チャットでどう使うか */
  usage: string;
  notes?: string[];
  docs: { label: string; url: string };
};

export const AI_GUIDES: AiGuide[] = [
  {
    id: 'claude',
    name: 'Claude（claude.ai・デスクトップアプリ）',
    availability:
      'Free / Pro / Max / Team / Enterprise。Free プランで追加できるカスタムコネクタは 1 つまでです。',
    steps: [
      { text: 'claude.ai を開き、「Customize」→「Connectors」を開きます。' },
      { text: '「+ Add」→「Add custom connector」を選びます。' },
      {
        text: '名前に「TRAKON」、URL に次のアドレスを入力して「Continue」を押します。',
        code: '{{URL}}',
      },
      { text: '検出された認証設定を確認して、もう一度「Continue」を押します。' },
      {
        text: '「Authentication」は「Sign in now」、「OAuth client」は「Register automatically」を選んで「Add」を押します。',
      },
      { text: 'TRAKON の画面が開くので、内容を確認して「許可する」を押します。' },
    ],
    usage: 'チャット入力欄の左下にある「+」→「Connectors」で TRAKON をオンにしてから話しかけます。',
    notes: [
      'Team / Enterprise プランでは、オーナーが「Organization settings」→「Connectors」→「Add」→「Custom」→「Web」で TRAKON を追加します。その後、各メンバーが「Customize」→「Connectors」で TRAKON の「Connect」を押し、それぞれ自分の TRAKON アカウントで許可します。',
      '同じ Claude アカウントでログインしたデスクトップアプリでも使えます。',
    ],
    docs: {
      label: 'Claude ヘルプセンター',
      url: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    availability: 'Claude Code（ターミナル版・IDE 拡張）を使っている方。',
    steps: [
      {
        text: 'ターミナルで次のコマンドを実行します。すべてのプロジェクトで使う場合は末尾に --scope user を付けます。',
        code: 'claude mcp add --transport http trakon {{URL}}',
      },
      { text: 'Claude Code の中で /mcp を実行し、trakon を選んで認証します。', code: '/mcp' },
      { text: 'ブラウザで TRAKON の画面が開くので「許可する」を押します。' },
    ],
    usage: 'そのまま「今日の自分のボールを教えて」のように話しかけます。',
    notes: [
      'claude.ai でコネクタを追加済みなら、同じアカウントでログインした Claude Code からも使えます。',
    ],
    docs: { label: 'Claude Code ドキュメント', url: 'https://code.claude.com/docs/en/mcp' },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    availability:
      'Business / Enterprise / Edu プランの Web 版。Business ではワークスペースの管理者・オーナーが追加します。Pro プランは閲覧系の操作に限られます。モバイルアプリからは追加できません。',
    steps: [
      { text: 'chatgpt.com/plugins を開き、「+」→「Add custom MCP server」を選びます。' },
      {
        text: '名前に「TRAKON」を入力し、「Connection」に次の URL を入力します。',
        code: '{{URL}}',
      },
      { text: '認証方式は「OAuth」を選びます。' },
      { text: '注意事項を確認して「I understand and want to continue」を押します。' },
      {
        text: '「Create as a plugin」を押し、表示されたツールを確認してインストールします。サインインを求められたら、TRAKON の画面で「許可する」を押します。',
      },
    ],
    usage:
      '新しいチャットで「@」を入力して TRAKON を選んでから話しかけます。予定の作成・変更などは、実行前に ChatGPT が確認を求めます。',
    notes: [
      'Business / Enterprise では、管理者が管理画面（Admin Console）の「Plugins」から公開すると、メンバーも使えるようになります。',
      'プランや管理者の設定によっては、この機能が表示されないことがあります。',
    ],
    docs: {
      label: 'ChatGPT ヘルプセンター',
      url: 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt',
    },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    availability: 'Gemini CLI（コマンドライン版）を使っている方。',
    steps: [
      {
        text: '~/.gemini/settings.json（このプロジェクトだけで使うなら .gemini/settings.json）の mcpServers に次を追加します。',
        code: '{\n  "mcpServers": {\n    "trakon": {\n      "httpUrl": "{{URL}}"\n    }\n  }\n}',
      },
      { text: 'Gemini CLI を起動して次のコマンドを実行します。', code: '/mcp auth trakon' },
      { text: 'ブラウザで TRAKON の画面が開くので「許可する」を押します。' },
    ],
    usage: 'そのまま話しかけます。接続の状態は /mcp で確認できます。',
    notes: [
      '認証にはブラウザが必要です。SSH 接続先やコンテナの中では認証できません。',
      '無料枠・Google One のユーザー向けには、Gemini CLI の後継として Antigravity CLI が提供されています。その場合の設定方法は Google の公式ドキュメントをご確認ください。',
    ],
    docs: { label: 'Gemini CLI ドキュメント', url: 'https://geminicli.com/docs/tools/mcp-server/' },
  },
  {
    id: 'vscode',
    name: 'GitHub Copilot（VS Code）',
    availability: 'VS Code で GitHub Copilot を使っている方。',
    steps: [
      {
        text: 'コマンドパレットで「MCP: Add Server」を実行します（または「Chat: Open Customizations」→「MCP Servers」→「Add Server」）。',
      },
      {
        text: '「HTTP」を選び、次の URL を入力します。サーバ ID は trakon にします。',
        code: '{{URL}}',
      },
      { text: '保存先は「Global」→「Copilot Global」を選びます。' },
      { text: '「Authenticate」が表示されたら押し、ブラウザで TRAKON の「許可する」を押します。' },
    ],
    alternative: {
      text: '設定ファイルに直接書く場合は ~/.copilot/mcp-config.json に次のように書きます。',
      code: '{\n  "mcpServers": {\n    "trakon": {\n      "type": "http",\n      "url": "{{URL}}"\n    }\n  }\n}',
    },
    usage: 'Copilot のチャットでそのまま話しかけます。',
    notes: [
      'Copilot Business / Enterprise では、組織のポリシーで MCP サーバの利用が制限されていることがあります。使えない場合は管理者にご確認ください。',
    ],
    docs: {
      label: 'VS Code ドキュメント',
      url: 'https://code.visualstudio.com/docs/agent-customization/mcp-servers',
    },
  },
  {
    id: 'copilot-studio',
    name: 'Microsoft Copilot Studio',
    availability: 'Copilot Studio でエージェントを作成している方。',
    steps: [
      {
        text: 'エージェントの「Tools」→「Add a tool」→「New tool」→「Model Context Protocol」を選びます。',
      },
      {
        text: '「Server name」に TRAKON、「Server description」に用途（例: 制作進行管理ツール TRAKON の予定を確認・登録する）を入力し、「Server URL」に次の URL を入力します。',
        code: '{{URL}}',
      },
      { text: '認証は「OAuth 2.0」を選び、種類は「Dynamic discovery」にします。' },
      {
        text: '「Create」→「Next」→「Create a new connection」で TRAKON の画面が開くので「許可する」を押し、最後に「Add to agent」を押します。',
      },
    ],
    usage: 'エージェントとの会話で話しかけると、必要に応じて TRAKON のツールが使われます。',
    notes: ['Power Platform のデータポリシー（コネクタの制御）の対象になります。'],
    docs: {
      label: 'Microsoft Learn',
      url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent',
    },
  },
];

/** 話しかけ方の例 */
export const EXAMPLE_PROMPTS = [
  '今日わたしがボールを持っている予定を教えて',
  '「新サイト制作」の来週の予定を一覧にして',
  'バナー制作に、来週月曜から水曜で「デザイン初稿」を田中さん担当で入れて',
  'LP コーディングの予定を 2 日後ろにずらして',
  'デザイン初稿を山田さんに確認依頼して。メッセージは「初稿です。ご確認ください」',
];

/** `{{URL}}` を実際の URL に置き換える */
export function fillUrl(text: string, url: string): string {
  return text.split('{{URL}}').join(url);
}
