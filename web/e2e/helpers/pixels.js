// Read what the browser actually painted.
//
// Deriving a backdrop from CSS has now been wrong twice on this screen. First
// by stopping at the nearest non-transparent background — which for a chip on
// the unscheduled strip reported white, a colour nothing renders. Then, after
// that was fixed by compositing rgba layers, by ignoring background-image: the
// glassy theme paints radial gradients on <body>, so a composite of
// backgroundColor alone is again a colour that is not on screen. Opacity,
// backdrop-filter and transforms would each break it too.
//
// So this samples the rendered pixels instead. A screenshot is the one source
// that cannot disagree with the screen. PNG decoding is done here with node's
// built-in zlib rather than a dependency, since Playwright hands us a buffer.

import zlib from "node:zlib";

function decodePng(buffer) {
  let pos = 8; // skip the signature
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    pos += 12 + length; // length + type + data + crc
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  // Undo the per-scanline filters (PNG spec 9.2). Each line is preceded by a
  // filter byte and is reconstructed from the line above and the pixel left.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;      // left
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;                   // up
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/**
 * The colour an element's area is actually painted, as [r, g, b].
 * Text occupies a minority of a label's box, so the modal pixel is its
 * backdrop — whatever produced it: a gradient, a stack of translucent layers,
 * a backdrop-filter, or a plain fill.
 */
export async function paintedBackdrop(locator) {
  const { width, height, channels, data } = decodePng(await locator.screenshot());
  const counts = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width * channels + x * channels;
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let best = 0, bestCount = -1;
  for (const [key, n] of counts) if (n > bestCount) { best = key; bestCount = n; }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

const channelLuminance = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

export const luminance = ([r, g, b]) =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);

/** Full precision — a threshold applies to the real ratio, not a rounded one. */
export function contrastRatio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const parseRgb = (s) => {
  const m = String(s).match(/[0-9.]+/g);
  return m ? m.slice(0, 3).map(Number) : null;
};
