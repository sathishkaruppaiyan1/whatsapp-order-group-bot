/**
 * Image generator service.
 * Takes the downloaded product/variation image and produces a high-quality
 * JPEG with a white rounded-rectangle badge showing SIZE (top) and COLOR
 * (bottom), matching the reference sample.
 *
 * Pipeline: sharp normalizes the base image -> node-canvas renders the badge
 * as a transparent PNG -> sharp composites badge onto the image -> JPEG out.
 */
import sharp from 'sharp';
import { createCanvas } from 'canvas';
import { config } from '../../config';
import { moduleLogger } from '../../utils/logger';
import { tempFilePath } from '../../utils/fileUtils';

const log = moduleLogger('ImageGenerator');

// Output canvas dimensions (square, high quality).
const IMAGE_SIZE = 1080;
const JPEG_QUALITY = 92;

// Badge styling.
const BADGE_MARGIN_BOTTOM = 48;
const BADGE_PADDING_X = 56;
const BADGE_PADDING_Y = 34;
const BADGE_RADIUS = 28;
const SIZE_FONT = 'bold 64px "DejaVu Sans", "Segoe UI", Arial, sans-serif';
const COLOR_FONT = '600 44px "DejaVu Sans", "Segoe UI", Arial, sans-serif';
const LINE_GAP = 14;

class ImageGeneratorService {
  /**
   * Generates the badged product image.
   * @param sourceImagePath local path of the downloaded image
   * @param size  size label, e.g. "XL"
   * @param color color label, e.g. "Navy Blue"
   * @returns path of the generated JPEG inside generated/
   */
  async generateOrderImage(
    sourceImagePath: string,
    size: string,
    color: string,
    namePrefix: string
  ): Promise<string> {
    const outputPath = tempFilePath(config.paths.generated, namePrefix, 'jpg');

    // 1. Normalize the base image: square canvas, white background, contain fit.
    const baseImage = await sharp(sourceImagePath)
      .resize(IMAGE_SIZE, IMAGE_SIZE, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toBuffer();

    // 2. Render the badge with node-canvas.
    const badge = this.renderBadge(size.toUpperCase(), color.toUpperCase());

    // 3. Composite badge at bottom-center and export high-quality JPEG.
    const badgeLeft = Math.round((IMAGE_SIZE - badge.width) / 2);
    const badgeTop = IMAGE_SIZE - badge.height - BADGE_MARGIN_BOTTOM;

    await sharp(baseImage)
      .composite([{ input: badge.buffer, left: badgeLeft, top: badgeTop }])
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(outputPath);

    log.info(`Image generated: ${outputPath} (size=${size}, color=${color})`);
    return outputPath;
  }

  /** Draws the white rounded-rectangle badge (SIZE on top, COLOR below) as a PNG. */
  private renderBadge(
    sizeText: string,
    colorText: string
  ): { buffer: Buffer; width: number; height: number } {
    // Measure text first to size the badge to its content.
    const probe = createCanvas(10, 10).getContext('2d');
    probe.font = SIZE_FONT;
    const sizeWidth = probe.measureText(sizeText).width;
    probe.font = COLOR_FONT;
    const colorWidth = probe.measureText(colorText).width;

    const textWidth = Math.max(sizeWidth, colorWidth);
    const maxBadgeWidth = IMAGE_SIZE - 120;
    const width = Math.min(Math.ceil(textWidth) + BADGE_PADDING_X * 2, maxBadgeWidth);
    const height = BADGE_PADDING_Y * 2 + 64 + LINE_GAP + 44;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Soft shadow behind the badge for a professional look.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;

    // White rounded rectangle.
    ctx.fillStyle = '#FFFFFF';
    this.roundedRect(ctx, 8, 8, width - 16, height - 16, BADGE_RADIUS);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Thin border for definition on light images.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 2;
    this.roundedRect(ctx, 8, 8, width - 16, height - 16, BADGE_RADIUS);
    ctx.stroke();

    // SIZE (top, large bold).
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#111111';
    ctx.font = SIZE_FONT;
    ctx.fillText(sizeText, width / 2, BADGE_PADDING_Y, width - BADGE_PADDING_X);

    // COLOR (bottom, medium weight, muted).
    ctx.fillStyle = '#444444';
    ctx.font = COLOR_FONT;
    ctx.fillText(colorText, width / 2, BADGE_PADDING_Y + 64 + LINE_GAP, width - BADGE_PADDING_X);

    return { buffer: canvas.toBuffer('image/png'), width, height };
  }

  /** Rounded-rectangle path helper. */
  private roundedRect(
    ctx: import('canvas').CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

export const imageGeneratorService = new ImageGeneratorService();
