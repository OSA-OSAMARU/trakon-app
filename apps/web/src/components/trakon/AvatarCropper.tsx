import { useCallback, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

/**
 * プロフィール画像のトリミング (#157)。
 *
 * 円形マスクで「どこを丸く切り出すか」を選ばせ、正方形の WebP にして返す。
 * 出力を 512×512 の固定サイズにしているので、
 *   - 表示側は CSS の rounded-full を当てるだけでよく、画像自体は正方形のまま
 *   - 元画像が 10MB でも送信サイズは数十 KB に収まる
 * サーバー側で画像処理をしない (sharp をサーバーレスのバンドルに載せない) ための分担。
 */

const OUTPUT_SIZE = 512;
const OUTPUT_TYPE = 'image/webp';
const OUTPUT_QUALITY = 0.9;

/** 切り抜き結果を 512×512 の Blob にする。 */
async function cropToBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context を取得できませんでした');

  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY),
  );
  if (!blob) throw new Error('画像の書き出しに失敗しました');
  return blob;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => reject(new Error('画像を読み込めませんでした')));
    img.src = src;
  });
}

export function AvatarCropper({
  imageSrc,
  open,
  submitting,
  onCancel,
  onCropped,
}: {
  /** 選択されたファイルの object URL */
  imageSrc: string;
  open: boolean;
  submitting: boolean;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const areaRef = useRef<Area | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    areaRef.current = areaPixels;
  }, []);

  const apply = async () => {
    const area = areaRef.current;
    if (!area) return;
    setError(null);
    try {
      onCropped(await cropToBlob(imageSrc, area));
    } catch (e) {
      setError(e instanceof Error ? e.message : '画像を処理できませんでした');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>プロフィール画像を切り抜く</DialogTitle>
          <DialogDescription>
            ドラッグで位置を、スライダーで拡大率を調整します。丸く表示される範囲が保存されます。
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted relative h-64 w-full overflow-hidden rounded-lg">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="avatar-zoom">拡大率</Label>
          <input
            id="avatar-zoom"
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="accent-primary w-full"
          />
        </div>

        {error && <p className="text-destructive text-label">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            キャンセル
          </Button>
          <Button type="button" onClick={apply} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            この範囲で保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
