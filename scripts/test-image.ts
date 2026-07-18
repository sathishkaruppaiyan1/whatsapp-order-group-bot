/**
 * Standalone test for the image generator.
 * Creates a synthetic product image, runs it through the badge pipeline and
 * leaves the result in generated/ for visual inspection.
 *
 * Run: npm run test:image
 */
import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';
import { ensureRuntimeDirectories } from '../src/utils/fileUtils';
import { imageGeneratorService } from '../src/services/imageGenerator/imageGeneratorService';
import { config } from '../src/config';

async function main(): Promise<void> {
  ensureRuntimeDirectories();

  // Draw a fake product image (t-shirt-ish rectangle) so no network is needed.
  const canvas = createCanvas(900, 1100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8ecf1';
  ctx.fillRect(0, 0, 900, 1100);
  ctx.fillStyle = '#3b5bdb';
  ctx.fillRect(150, 150, 600, 800);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SAMPLE PRODUCT', 450, 560);

  const samplePath = path.join(config.paths.downloads, 'sample-product.png');
  fs.writeFileSync(samplePath, canvas.toBuffer('image/png'));

  const output = await imageGeneratorService.generateOrderImage(
    samplePath,
    'XL',
    'Navy Blue',
    'test-sample'
  );

  console.log(`\n✅ Generated test image: ${output}`);
  console.log('Open it to verify the SIZE/COLOR badge looks right.\n');
  fs.unlinkSync(samplePath);
}

main().catch((error) => {
  console.error('❌ Image test failed:', error);
  process.exit(1);
});
