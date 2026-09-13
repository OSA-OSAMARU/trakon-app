import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// react-easy-crop は実 DOM 計測に依存するので差し替える。
// マウント時に切り抜き範囲を通知し、以降はこのコンポーネントの
// 「範囲 → 512x512 の Blob」の変換だけを検証する。
const CROP_AREA = { x: 10, y: 20, width: 200, height: 200 };
vi.mock('react-easy-crop', () => ({
  default: ({
    onCropComplete,
  }: {
    onCropComplete: (a: unknown, b: typeof CROP_AREA) => void;
  }) => {
    onCropComplete(CROP_AREA, CROP_AREA);
    return <div data-testid="cropper" />;
  },
}));

import { AvatarCropper } from './AvatarCropper';

const drawImage = vi.fn();
let toBlobResult: Blob | null = new Blob(['x'], { type: 'image/webp' });
let contextAvailable = true;

beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();

  // jsdom には canvas の 2d コンテキストが無いので差し替える。
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = origCreate(tag) as HTMLElement;
    if (tag === 'canvas') {
      const c = el as HTMLCanvasElement;
      c.getContext = (() => (contextAvailable ? { drawImage } : null)) as never;
      c.toBlob = ((cb: (b: Blob | null) => void) => cb(toBlobResult)) as never;
    }
    return el;
  }) as never);

  // 画像の読み込みも jsdom では起きないので、src 設定で load を発火させる。
  class FakeImage extends EventTarget {
    set src(_v: string) {
      setTimeout(() => this.dispatchEvent(new Event('load')), 0);
    }
  }
  (globalThis as { Image: unknown }).Image = FakeImage;
});

beforeEach(() => {
  drawImage.mockClear();
  toBlobResult = new Blob(['x'], { type: 'image/webp' });
  contextAvailable = true;
});

afterEach(() => vi.clearAllMocks());

function setup(over: Partial<Parameters<typeof AvatarCropper>[0]> = {}) {
  const onCropped = vi.fn();
  const onCancel = vi.fn();
  render(
    <AvatarCropper
      imageSrc="blob:mock/1"
      open
      submitting={false}
      onCancel={onCancel}
      onCropped={onCropped}
      {...over}
    />,
  );
  return { onCropped, onCancel };
}

describe('AvatarCropper', () => {
  it('選択範囲を 512x512 に描き直して Blob で返す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onCropped } = setup();

    await user.click(screen.getByRole('button', { name: 'この範囲で保存' }));

    await waitFor(() => expect(onCropped).toHaveBeenCalledTimes(1));
    // 元画像の選択範囲 → 出力キャンバス全面 (固定 512px) へ
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      CROP_AREA.x,
      CROP_AREA.y,
      CROP_AREA.width,
      CROP_AREA.height,
      0,
      0,
      512,
      512,
    );
    expect(onCropped.mock.calls[0]![0]).toBeInstanceOf(Blob);
  });

  it('拡大率スライダーを操作できる', async () => {
    setup();
    const slider = screen.getByLabelText('拡大率') as HTMLInputElement;
    expect(slider.value).toBe('1');
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('4');
  });

  it('書き出しに失敗したらエラーを出し、コールバックは呼ばない', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    toBlobResult = null;
    const { onCropped } = setup();

    await user.click(screen.getByRole('button', { name: 'この範囲で保存' }));

    expect(await screen.findByText('画像の書き出しに失敗しました')).toBeInTheDocument();
    expect(onCropped).not.toHaveBeenCalled();
  });

  it('canvas が使えない環境でもクラッシュせずエラーを出す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    contextAvailable = false;
    const { onCropped } = setup();

    await user.click(screen.getByRole('button', { name: 'この範囲で保存' }));

    expect(await screen.findByText(/canvas 2d context/)).toBeInTheDocument();
    expect(onCropped).not.toHaveBeenCalled();
  });

  it('キャンセルで onCancel を呼ぶ', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onCancel } = setup();

    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('送信中は両方のボタンを無効化する', () => {
    setup({ submitting: true });
    expect(screen.getByRole('button', { name: /この範囲で保存/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  });
});
