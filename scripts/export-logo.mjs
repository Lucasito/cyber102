import { fileURLToPath } from "node:url";
import sharp from "sharp";

// sharp уже поставляется с Next.js; дополнительных зависимостей не требуется.
const source = fileURLToPath(new URL("../public/brand/logo.svg", import.meta.url));

for (const size of [512, 1024]) {
  const destination = fileURLToPath(
    new URL(`../public/brand/logo-${size}.png`, import.meta.url),
  );
  await sharp(source, { density: (72 * size) / 512 })
    .resize(size, size)
    .png()
    .toFile(destination);
  console.log(`Экспортирован logo-${size}.png (${size}×${size})`);
}
