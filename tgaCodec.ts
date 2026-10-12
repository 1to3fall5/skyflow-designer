// TGA codec. Browsers can neither decode nor encode TGA natively.
//
// Decoding leans on three's TGALoader (already a dependency) — but it only ships
// a loader, no writer, so encoding is hand-rolled below.
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';

const BPP = 3;                 // we always write 24-bit RGB
const IMG_TYPE_RLE_RGB = 10;   // run-length encoded true-colour

/**
 * Decode a .tga File into an object URL for a PNG, so the rest of the app can
 * treat it like any other image (reference layer, 3D sky texture).
 */
export const decodeTgaToUrl = async (file: File): Promise<string> => {
  const result = new TGALoader().parse(await file.arrayBuffer());
  const canvas = document.createElement('canvas');
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建解码画布');
  // parse() normalises the origin bit, so data is already top-down RGBA,
  // matching ImageData's layout — no flip needed here.
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0
  );
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG 转换失败')), 'image/png');
  });
  return URL.createObjectURL(blob);
};

const buildHeader = (width: number, height: number): Uint8Array => {
  const h = new Uint8Array(18);
  h[0] = 0;                      // id length
  h[1] = 0;                      // colour map type: none
  h[2] = IMG_TYPE_RLE_RGB;       // RLE true-colour
  h[8] = h[9] = 0;               // x origin
  h[10] = h[11] = 0;             // y origin
  h[12] = width & 0xff;  h[13] = (width >> 8) & 0xff;    // width  (little endian)
  h[14] = height & 0xff; h[15] = (height >> 8) & 0xff;   // height (little endian)
  h[16] = 24;                    // pixel depth
  h[17] = 0x00;                  // origin: bottom-left, 0 alpha bits
  return h;
};

const samePixel = (row: Uint8Array, a: number, b: number): boolean => {
  const ia = a * BPP, ib = b * BPP;
  return row[ia] === row[ib] && row[ia + 1] === row[ib + 1] && row[ia + 2] === row[ib + 2];
};

// TGA RLE: packet header's top bit selects RLE vs raw, low 7 bits are count-1.
const rleEncodeRow = (row: Uint8Array, out: number[]): void => {
  const count = row.length / BPP;
  let i = 0;
  while (i < count) {
    let run = 1;
    while (i + run < count && run < 128 && samePixel(row, i, i + run)) run++;

    if (run > 1) {
      out.push(0x80 | (run - 1));                       // RLE packet
      for (let c = 0; c < BPP; c++) out.push(row[i * BPP + c]);
      i += run;
    } else {
      let raw = 1;
      while (i + raw < count && raw < 128 && !samePixel(row, i + raw - 1, i + raw)) raw++;
      out.push(raw - 1);                                 // raw packet
      for (let k = 0; k < raw; k++) {
        for (let c = 0; c < BPP; c++) out.push(row[(i + k) * BPP + c]);
      }
      i += raw;
    }
  }
};

/**
 * Encode a canvas as a 24-bit RLE TGA, bottom-up (canonical TGA origin).
 * Flow maps are mostly flat neutral pixels, so RLE shrinks them a lot.
 */
export const encodeCanvasToTga = (canvas: HTMLCanvasElement): Blob => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法读取导出画布');
  const w = canvas.width, h = canvas.height;
  const src = ctx.getImageData(0, 0, w, h).data;

  // File row 0 is the BOTTOM image row, and channels are stored BGR.
  const rowBytes = w * BPP;
  const packets: number[] = [];
  const row = new Uint8Array(rowBytes);
  for (let y = 0; y < h; y++) {
    const sRow = (h - 1 - y) * w * 4;
    for (let x = 0; x < w; x++) {
      const s = sRow + x * 4, d = x * BPP;
      row[d] = src[s + 2];        // B
      row[d + 1] = src[s + 1];    // G
      row[d + 2] = src[s];        // R
    }
    rleEncodeRow(row, packets);
  }

  const header = buildHeader(w, h);
  const out = new Uint8Array(header.length + packets.length);
  out.set(header, 0);
  out.set(packets, header.length);
  return new Blob([out], { type: 'image/x-tga' });
};
