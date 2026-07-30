const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SVG = path.join(ASSETS, 'icon.svg');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function generateIco(sizes) {
  const pngs = await Promise.all(
    sizes.map(s => sharp(SVG).resize(s, s).png().toBuffer())
  );

  const count = sizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const dirs = [];
  const data = [];

  for (let i = 0; i < count; i++) {
    const s = sizes[i];
    const png = pngs[i];
    const dir = Buffer.alloc(16);
    dir.writeUInt8(s >= 256 ? 0 : s, 0);
    dir.writeUInt8(s >= 256 ? 0 : s, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    data.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirs, ...data]);
}

async function main() {
  console.log('Generating icons from SVG...');

  const ico = await generateIco(SIZES);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico);
  console.log('  -> icon.ico (Windows)');

  const png256 = await sharp(SVG).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), png256);
  console.log('  -> icon.png (Linux, 256x256)');

  const png1024 = await sharp(SVG).resize(1024, 1024).png().toBuffer();
  fs.writeFileSync(path.join(ASSETS, 'icon-mac.png'), png1024);
  console.log('  -> icon-mac.png (macOS source, 1024x1024)');

  console.log('Done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
