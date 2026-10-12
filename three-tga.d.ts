// three 的 examples/jsm 只发布 .js，没有配套 .d.ts，这里补一个最小声明。
// 只声明我们用得到的 parse()：它不走 three 的纹理管线，直接返回原始像素。
declare module 'three/examples/jsm/loaders/TGALoader.js' {
  export interface TgaParseResult {
    /** RGBA8, top-down — row 0 is the TOP of the image (same as ImageData). */
    data: Uint8Array;
    width: number;
    height: number;
    flipY: boolean;
    generateMipmaps: boolean;
    minFilter: number;
  }

  export class TGALoader {
    parse(buffer: ArrayBuffer): TgaParseResult;
  }
}
