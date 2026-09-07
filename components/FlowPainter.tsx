import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { BrushSettings, ActiveTool, FlowPainterHandle, ProjectionType, Layer, 
         isPaintLayer, isWindLayer, isObstacleLayer, isAdjustmentLayer, EditTarget } from '../types';

// acos is the hottest remaining transcendental when generating wind fields;
// a 4096-entry LUT is far beyond what 8-bit flow values need.
const ACOS_LUT_N = 4096;
const ACOS_LUT = new Float32Array(ACOS_LUT_N + 1);
for (let i = 0; i <= ACOS_LUT_N; i++) ACOS_LUT[i] = Math.acos((i / ACOS_LUT_N) * 2 - 1);
const fastAcos = (x: number) => {
  const t = (x + 1) * 0.5 * ACOS_LUT_N;
  return ACOS_LUT[t < 0 ? 0 : (t > ACOS_LUT_N ? ACOS_LUT_N : t | 0)];
};

interface FlowPainterProps {
  brushSettings: BrushSettings;
  activeTool: ActiveTool;
  bgImageUrl: string | null;
  onTextureUpdate: (canvas: HTMLCanvasElement) => void;
  
  layers: Layer[];
  activeLayerId: string;
  editTarget: EditTarget;
  
  magicWandThreshold?: number;
  showReference?: boolean;
  referenceOpacity?: number;
  showArrows?: boolean;
  arrowDensity?: number;

  className?: string;
  onPaintingComplete?: () => void;
  onSetBrushSize?: (size: number) => void;
  projectionType?: ProjectionType;
  polarAngle?: number;
  cursorUV?: {u: number, v: number} | null;
  onCursorUpdate?: (uv: {u: number, v: number} | null) => void;
}

const FlowPainter = forwardRef<FlowPainterHandle, FlowPainterProps>(({ 
  brushSettings, 
  activeTool,
  bgImageUrl, 
  onTextureUpdate,
  layers,
  activeLayerId,
  editTarget,
  magicWandThreshold = 20,
  showReference = false,
  referenceOpacity = 0.2,
  showArrows = true,
  arrowDensity = 48,
  className,
  onPaintingComplete,
  onSetBrushSize,
  projectionType = 'equirectangular',
  polarAngle = 90,
  cursorUV,
  onCursorUpdate
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Canvas storage: each layer has a content canvas, adjustment layers also have a mask canvas
  const layerCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const maskCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  
  const cursorPreviewRef = useRef<HTMLDivElement | null>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const arrowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const seamlessHelperRef = useRef<HTMLCanvasElement | null>(null);
  const flowMapRef = useRef<HTMLCanvasElement | null>(null);
  const brushTipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastBrushTipKey = useRef<string>('');
  const disturbanceHelperRef = useRef<HTMLCanvasElement | null>(null);
  const blurHelperRef = useRef<HTMLCanvasElement | null>(null);

  const renderPendingRef = useRef(false);

  // --- Cascading composite cache ---
  // renderComposite used to rebuild every layer from scratch on every pointer
  // move: wind trig over 1M pixels, full-resolution blurs, disturbance passes...
  // Slot i now caches the composited result of layers 0..i; its key folds in the
  // previous slot's key so an edit only invalidates that layer and the ones above.
  const compositeCacheRef = useRef<HTMLCanvasElement[]>([]);
  const compositeKeyRef = useRef<string[]>([]);
  const finalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const finalKeyRef = useRef<string>('');
  const combinedObstacleRef = useRef<HTMLCanvasElement | null>(null);
  const combinedObstacleKeyRef = useRef<string>('');
  // Bumped whenever a layer's pixels change (brush stroke, mask edit, fill, undo)
  const contentVersionRef = useRef<Map<string, number>>(new Map());
  const arrowKeyRef = useRef<string>('');
  const arrowSampleRef = useRef<HTMLCanvasElement | null>(null);
  const windGenRef = useRef<HTMLCanvasElement | null>(null);

  // Context cache
  const ctxCacheRef = useRef<Map<HTMLCanvasElement, CanvasRenderingContext2D>>(new Map());
  const getCachedCtx = useCallback((canvas: HTMLCanvasElement, options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null => {
      let ctx = ctxCacheRef.current.get(canvas);
      if (!ctx) {
          ctx = canvas.getContext('2d', options) ?? undefined;
          if (ctx) ctxCacheRef.current.set(canvas, ctx);
      }
      return ctx ?? null;
  }, []);

  // Marks a layer's pixels (or its mask) as dirty so the composite cache drops it.
  const bumpContentVersion = useCallback((key: string) => {
      contentVersionRef.current.set(key, (contentVersionRef.current.get(key) ?? 0) + 1);
  }, []);

  // History
  const historyRef = useRef<Map<string, ImageData>[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const SIZE = 1024;
  const ARROW_SAMPLE = 128;

  const initCanvas = (width = SIZE, height = SIZE, fillStyle?: string) => {
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      const ctx = c.getContext('2d');
      if (ctx && fillStyle) { ctx.fillStyle = fillStyle; ctx.fillRect(0, 0, width, height); }
      return c;
  };

  // --- Arrow Drawing ---
  const drawArrows = useCallback((flowKey: string) => {
    if (!arrowCanvasRef.current) return;
    const ctx = getCachedCtx(arrowCanvasRef.current);
    if (!ctx) return;
    // Nothing changed since the last composite — skip the whole pass.
    if (arrowKeyRef.current === flowKey) return;
    arrowKeyRef.current = flowKey;
    ctx.clearRect(0, 0, SIZE, SIZE);

    const flowCanvas = finalCanvasRef.current;
    if (!showArrows || !flowCanvas) return;

    // Downsample before reading: 128² instead of 1024² is ~64x less pixel traffic
    // and the arrow field is far coarser than that anyway.
    let sample = arrowSampleRef.current;
    if (!sample) {
        sample = document.createElement('canvas');
        sample.width = ARROW_SAMPLE; sample.height = ARROW_SAMPLE;
        arrowSampleRef.current = sample;
    }
    const sCtx = sample.getContext('2d', { willReadFrequently: true });
    if (!sCtx) return;
    sCtx.clearRect(0, 0, ARROW_SAMPLE, ARROW_SAMPLE);
    sCtx.drawImage(flowCanvas, 0, 0, ARROW_SAMPLE, ARROW_SAMPLE);
    const data = sCtx.getImageData(0, 0, ARROW_SAMPLE, ARROW_SAMPLE).data;

    const scale = SIZE / ARROW_SAMPLE;
    const step = Math.max(16, 128 - arrowDensity);
    const sStep = step / scale;
    const shaftPath = new Path2D();
    const headPath = new Path2D();
    for (let sy = sStep / 2; sy < ARROW_SAMPLE; sy += sStep) {
        for (let sx = sStep / 2; sx < ARROW_SAMPLE; sx += sStep) {
            const i = (Math.floor(sy) * ARROW_SAMPLE + Math.floor(sx)) * 4;
            const r = data[i], g = data[i + 1];
            if (r === 128 && g === 128) continue;
            const x = sx * scale, y = sy * scale;
            const vx = (128 - r) / 127.0, vy = (g - 128) / 127.0;
            const rawLen = Math.sqrt(vx*vx + vy*vy);
            const angle = Math.atan2(vy, vx);
            const arrowLen = Math.min(step * 0.8, rawLen * step * 2.0);
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const halfLen = arrowLen / 2;
            shaftPath.moveTo(x + (-halfLen) * cos, y + (-halfLen) * sin);
            shaftPath.lineTo(x + halfLen * cos, y + halfLen * sin);
            headPath.moveTo(x + halfLen * cos, y + halfLen * sin);
            headPath.lineTo(x + (halfLen - 4) * cos - (-3) * sin, y + (halfLen - 4) * sin + (-3) * cos);
            headPath.lineTo(x + (halfLen - 4) * cos - 3 * sin, y + (halfLen - 4) * sin + 3 * cos);
            headPath.closePath();
        }
    }
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
    ctx.fillStyle = 'rgba(251, 191, 36, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke(shaftPath);
    ctx.fill(headPath);
  }, [showArrows, arrowDensity, getCachedCtx]);

  useEffect(() => { arrowKeyRef.current = ''; drawArrows(finalKeyRef.current); }, [drawArrows]);

  // Load Reference Image
  useEffect(() => {
    if (!bgImageUrl) { referenceCanvasRef.current = null; return; }
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = bgImageUrl;
    img.onload = () => {
        const canvas = initCanvas(SIZE, SIZE);
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.drawImage(img, 0, 0, SIZE, SIZE); referenceCanvasRef.current = canvas; }
    };
  }, [bgImageUrl]);

  // Seamless blur helper
  const drawBlurred = useCallback((targetCtx: CanvasRenderingContext2D, sourceCanvas: HTMLCanvasElement, blurAmount: number) => {
      if (blurAmount <= 0) { targetCtx.drawImage(sourceCanvas, 0, 0); return; }
      // A full-resolution canvas blur costs radius x pixels, so blur(64) on 1024²
      // is brutal. Downscale first, blur with a proportionally smaller radius, then
      // scale back up — visually equivalent for a blur this soft, ~an order of
      // magnitude cheaper.
      const ds = Math.max(1, Math.min(4, Math.ceil(blurAmount / 8)));
      const radius = blurAmount / ds;
      const low = SIZE / ds;
      const padding = Math.ceil(radius * 3);
      const total = low + padding * 2;
      let helper = seamlessHelperRef.current;
      if (!helper) { helper = document.createElement('canvas'); seamlessHelperRef.current = helper; }
      if (helper.width !== total || helper.height !== total) { helper.width = total; helper.height = total; }
      const hCtx = helper.getContext('2d');
      if (!hCtx) { targetCtx.drawImage(sourceCanvas, 0, 0); return; }
      hCtx.clearRect(0, 0, total, total);
      // 3x3 tiling keeps the blur seamless across the equirect wrap
      for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
              hCtx.drawImage(sourceCanvas, padding + ox * low, padding + oy * low, low, low);
          }
      }
      targetCtx.save();
      targetCtx.filter = `blur(${radius}px)`;
      targetCtx.drawImage(helper, 0, 0, total, total, -padding * ds, -padding * ds, total * ds, total * ds);
      targetCtx.filter = 'none';
      targetCtx.restore();
  }, []);

  // --- Wind Layer Generation ---
  // Generated at half resolution (the field is very smooth) with the per-row /
  // per-column trig hoisted out of the inner loop, then upscaled.
  const WIND_RES = 512;

  const generateWindData = useCallback((canvas: HTMLCanvasElement, direction: number, strength: number) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const windRad = (direction * Math.PI) / 180;
    const Wx = Math.sin(windRad), Wy = 0, Wz = Math.cos(windRad);
    const step = 0.05;
    const s = 15.0 * strength;

    if (projectionType === 'planar') {
        const du = Wx * step, dv = Wz * step;
        const r = Math.max(0, Math.min(255, Math.round(128 + (-du * s * 127))));
        const g = Math.max(0, Math.min(255, Math.round(128 + (-dv * s * 127))));
        ctx.fillStyle = `rgb(${r},${g},255)`;
        ctx.fillRect(0, 0, SIZE, SIZE);
        return;
    }

    const R = WIND_RES;
    let gen = windGenRef.current;
    if (!gen) { gen = document.createElement('canvas'); gen.width = R; gen.height = R; windGenRef.current = gen; }
    const gCtx = gen.getContext('2d');
    if (!gCtx) return;
    const imageData = gCtx.createImageData(R, R);
    const data = imageData.data;
    const polarRad = (polarAngle * Math.PI) / 180;

    if (projectionType === 'polar') {
        for (let y = 0; y < R; y++) {
            for (let x = 0; x < R; x++) {
                const index = (y * R + x) * 4;
                const u = (x + 0.5) / R, v = 1.0 - ((y + 0.5) / R);
                const uc = u - 0.5, vc = v - 0.5;
                const rad = Math.sqrt(uc * uc + vc * vc);
                if (rad > 0.5) {
                    data[index] = 128; data[index+1] = 128; data[index+2] = 255; data[index+3] = 255;
                    continue;
                }
                const theta = Math.atan2(uc, vc);
                const phi = (rad / 0.5) * polarRad;
                const px = Math.sin(phi) * Math.sin(theta), py = Math.cos(phi), pz = Math.sin(phi) * Math.cos(theta);
                let nx = px + Wx * step, ny = py + Wy * step, nz = pz + Wz * step;
                const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                nx /= len; ny /= len; nz /= len;
                const nTheta = Math.atan2(nx, nz);
                const nr = (fastAcos(Math.max(-1, Math.min(1, ny))) / polarRad) * 0.5;
                const du = (0.5 + nr * Math.sin(nTheta)) - u;
                const dv = (0.5 + nr * Math.cos(nTheta)) - v;
                data[index]   = Math.max(0, Math.min(255, Math.round(128 + (-du * s * 127))));
                data[index+1] = Math.max(0, Math.min(255, Math.round(128 + (-dv * s * 127))));
                data[index+2] = 255; data[index+3] = 255;
            }
        }
    } else {
        // phi depends only on the row and theta only on the column: 2K trig calls
        // instead of 2 per pixel.
        const sinPhi = new Float32Array(R), cosPhi = new Float32Array(R);
        const vRow = new Float32Array(R);
        for (let y = 0; y < R; y++) {
            const phi = ((y + 0.5) / R) * Math.PI;
            sinPhi[y] = Math.sin(phi); cosPhi[y] = Math.cos(phi);
            vRow[y] = 1.0 - ((y + 0.5) / R);
        }
        const sinTheta = new Float32Array(R), cosTheta = new Float32Array(R);
        const uCol = new Float32Array(R);
        for (let x = 0; x < R; x++) {
            const th = ((x + 0.5) / R) * 2 * Math.PI;
            sinTheta[x] = Math.sin(th); cosTheta[x] = Math.cos(th);
            uCol[x] = (x + 0.5) / R;
        }
        for (let y = 0; y < R; y++) {
            const sp = sinPhi[y], cp = cosPhi[y], v = vRow[y];
            const rowBase = y * R;
            for (let x = 0; x < R; x++) {
                const index = (rowBase + x) * 4;
                const px = sp * sinTheta[x], py = cp, pz = sp * cosTheta[x];
                let nx = px + Wx * step, ny = py + Wy * step, nz = pz + Wz * step;
                const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                nx /= len; ny /= len; nz /= len;
                const nextV = 1.0 - (fastAcos(Math.max(-1, Math.min(1, ny))) / Math.PI);
                let normTheta = Math.atan2(nx, nz);
                if (normTheta < 0) normTheta += 2 * Math.PI;
                let du = (normTheta / (2 * Math.PI)) - uCol[x];
                const dv = nextV - v;
                if (du > 0.5) du -= 1.0; else if (du < -0.5) du += 1.0;
                data[index]   = Math.max(0, Math.min(255, Math.round(128 + (-du * s * 127))));
                data[index+1] = Math.max(0, Math.min(255, Math.round(128 + (-dv * s * 127))));
                data[index+2] = 255; data[index+3] = 255;
            }
        }
    }
    gCtx.putImageData(imageData, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(gen, 0, 0, SIZE, SIZE);
  }, [projectionType, polarAngle]);

  // --- Disturbance ---
  const applyDisturbance = useCallback((targetCtx: CanvasRenderingContext2D, obsCanvas: HTMLCanvasElement, distFactor: number) => {
    const w = SIZE, h = SIZE;
    // blur() up to 300px over a full 1024² buffer is the slowest op in the whole
    // app. Run it on a half-size map instead and sample that from the loop.
    const DS = 2;
    const lw = w / DS, lh = h / DS;
    let mapCanvas = disturbanceHelperRef.current;
    if (!mapCanvas) {
        mapCanvas = document.createElement('canvas');
        mapCanvas.width = lw; mapCanvas.height = lh;
        disturbanceHelperRef.current = mapCanvas;
    }
    const mapCtx = mapCanvas.getContext('2d', { willReadFrequently: true });
    if (!mapCtx) return;
    mapCtx.clearRect(0, 0, lw, lh);
    const blurRadius = (20 + distFactor * 280) / DS;
    mapCtx.filter = `blur(${blurRadius}px)`;
    mapCtx.drawImage(obsCanvas, 0, 0, lw, lh);
    mapCtx.filter = 'none';
    const m = mapCtx.getImageData(0, 0, lw, lh).data;
    const targetData = targetCtx.getImageData(0, 0, w, h);
    const d = targetData.data;
    // Same gradient span as the old full-res version, just in low-res pixels.
    const sampleStep = Math.max(2, Math.floor(blurRadius * 0.2));
    const getAlpha = (tx: number, ty: number) => {
        const cx = tx < 0 ? 0 : (tx >= lw ? lw - 1 : tx);
        const cy = ty < 0 ? 0 : (ty >= lh ? lh - 1 : ty);
        return m[(cy * lw + cx) * 4 + 3];
    };
    for (let y = 0; y < h; y++) {
      const ly = (y / DS) | 0;
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        const i = (rowBase + x) * 4;
        const lx = (x / DS) | 0;
        const alpha = m[(ly * lw + lx) * 4 + 3];
        if (alpha < 2) continue;
        const curR = d[i], curG = d[i + 1];
        const vx = (128 - curR) / 128, vy = (curG - 128) / 128;
        const currentSpeed = Math.sqrt(vx * vx + vy * vy);
        if (currentSpeed < 0.01) continue;
        const gx = getAlpha(lx + sampleStep, ly) - getAlpha(lx - sampleStep, ly);
        const gy = getAlpha(lx, ly + sampleStep) - getAlpha(lx, ly - sampleStep);
        const gl = Math.sqrt(gx * gx + gy * gy);
        if (gl < 0.1) continue;
        const nx = gx / gl, ny = gy / gl;
        const t1x = -ny, t1y = nx;
        const tangentDot = vx * t1x + vy * t1y;
        const slipVx = vx - (vx * nx + vy * ny) * nx;
        const slipVy = vy - (vx * nx + vy * ny) * ny;
        const tx = tangentDot >= 0 ? t1x : -t1x, ty = tangentDot >= 0 ? t1y : -t1y;
        const forcedVx = tx * currentSpeed, forcedVy = ty * currentSpeed;
        const alignment = Math.abs(tangentDot) / currentSpeed;
        const splitFactor = alignment * alignment;
        const targetVx = slipVx + (forcedVx - slipVx) * splitFactor;
        const targetVy = slipVy + (forcedVy - slipVy) * splitFactor;
        const normalizedAlpha = alpha / 255;
        let influence = Math.min(1.0, normalizedAlpha * 5.0);
        influence = influence * influence * (3 - 2 * influence);
        const impact = (vx * nx + vy * ny) / currentSpeed;
        let blend = impact > 0 ? influence * (1.0 + impact * 0.5) : influence * 0.8;
        blend = Math.min(1.0, blend);
        let finalVx = vx + (targetVx - vx) * blend;
        let finalVy = vy + (targetVy - vy) * blend;
        const newSpeed = Math.sqrt(finalVx * finalVx + finalVy * finalVy);
        if (newSpeed > 0.001) {
            const finalSpeed = newSpeed + (currentSpeed - newSpeed) * splitFactor;
            finalVx = (finalVx / newSpeed) * finalSpeed;
            finalVy = (finalVy / newSpeed) * finalSpeed;
        }
        d[i] = Math.min(255, Math.max(0, 128 - finalVx * 128));
        d[i + 1] = Math.min(255, Math.max(0, 128 + finalVy * 128));
      }
    }
    targetCtx.putImageData(targetData, 0, 0);
  }, []);

  // --- Main Rendering Pipeline ---
  const getSlot = (index: number): HTMLCanvasElement => {
      let c = compositeCacheRef.current[index];
      if (!c) {
          c = document.createElement('canvas');
          c.width = SIZE; c.height = SIZE;
          compositeCacheRef.current[index] = c;
      }
      return c;
  };

  // Signature of the composited result of layers 0..i. It folds in the previous
  // slot's key, so editing layer i invalidates i and everything stacked above it
  // while everything below stays cached.
  const layerSignature = (layer: Layer, prevKey: string): string => {
      const ver = contentVersionRef.current.get(layer.id) ?? 0;
      const maskVer = contentVersionRef.current.get(`mask:${layer.id}`) ?? 0;
      if (!layer.visible) return `${prevKey}|${layer.id}:off`;
      const op = layer.opacity.toFixed(3);
      if (isWindLayer(layer)) return `${prevKey}|${layer.id}:w${layer.direction},${layer.strength},m${maskVer},o${op},b${layer.blur}`;
      if (isObstacleLayer(layer)) return `${prevKey}|${layer.id}:om${maskVer},d${layer.disturbanceEnabled ? layer.disturbance : -1},o${op},b${layer.blur}`;
      return `${prevKey}|${layer.id}:p${ver},o${op},b${layer.blur}`;
  };

  const renderCompositeInternal = useCallback(() => {
    // Cleared up front: an early return below would otherwise leave the
    // "already scheduled" flag stuck and freeze all further compositing.
    renderPendingRef.current = false;
    const mainCanvas = canvasRef.current;
    if (!mainCanvas) return;
    const ctx = getCachedCtx(mainCanvas, { alpha: false });
    if (!ctx) return;

    const canvasMap = layerCanvasesRef.current;
    const maskMap = maskCanvasesRef.current;

    let prevCanvas: HTMLCanvasElement | null = null;
    let prevKey = 'base';

    // Process layers bottom to top, reusing cached slots where nothing changed
    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const sig = layerSignature(layer, prevKey);
        if (compositeKeyRef.current[i] === sig && compositeCacheRef.current[i]) {
            prevCanvas = compositeCacheRef.current[i];
            prevKey = sig;
            continue;
        }

        const dst = getSlot(i);
        const dctx = dst.getContext('2d');
        if (!dctx) continue;
        dctx.globalCompositeOperation = 'source-over';
        dctx.globalAlpha = 1;
        dctx.filter = 'none';
        dctx.clearRect(0, 0, SIZE, SIZE);
        if (prevCanvas) dctx.drawImage(prevCanvas, 0, 0);
        else { dctx.fillStyle = 'rgb(128, 128, 255)'; dctx.fillRect(0, 0, SIZE, SIZE); }

        if (layer.visible) {
            const opacity = layer.opacity ?? 1;

            if (isPaintLayer(layer)) {
                const canvas = canvasMap.get(layer.id);
                if (canvas) {
                    dctx.save();
                    dctx.globalAlpha = opacity;
                    if (layer.blur > 0) drawBlurred(dctx, canvas, layer.blur);
                    else dctx.drawImage(canvas, 0, 0);
                    dctx.restore();
                }

            } else if (isWindLayer(layer)) {
                let windCanvas = canvasMap.get(layer.id);
                if (!windCanvas) { windCanvas = initCanvas(); canvasMap.set(layer.id, windCanvas); }
                generateWindData(windCanvas, layer.direction, layer.strength);

                // A mask counts as painted as soon as anything was drawn into it,
                // even if the layer flag hasn't been flipped yet.
                const maskVer = contentVersionRef.current.get(`mask:${layer.id}`) ?? 0;
                const maskCanvas = maskVer > 0 ? maskMap.get(layer.id) : null;

                if (maskCanvas) {
                    let helper = blurHelperRef.current;
                    if (!helper) { helper = initCanvas(); blurHelperRef.current = helper; }
                    const hCtx = helper.getContext('2d');
                    if (hCtx) {
                        hCtx.clearRect(0, 0, SIZE, SIZE);
                        hCtx.drawImage(windCanvas, 0, 0);
                        hCtx.globalCompositeOperation = 'destination-in';
                        hCtx.drawImage(maskCanvas, 0, 0);
                        hCtx.globalCompositeOperation = 'source-over';
                        dctx.save();
                        dctx.globalAlpha = opacity;
                        dctx.drawImage(helper, 0, 0);
                        dctx.restore();
                    }
                } else {
                    dctx.save();
                    dctx.globalAlpha = opacity;
                    dctx.drawImage(windCanvas, 0, 0);
                    dctx.restore();
                }

            } else if (isObstacleLayer(layer)) {
                const maskVer = contentVersionRef.current.get(`mask:${layer.id}`) ?? 0;
                const maskCanvas = maskVer > 0 ? maskMap.get(layer.id) : null;
                if (maskCanvas) {
                    if (layer.disturbanceEnabled && layer.disturbance > 0) {
                        applyDisturbance(dctx, maskCanvas, layer.disturbance);
                    }
                    let helper = blurHelperRef.current;
                    if (!helper) { helper = initCanvas(); blurHelperRef.current = helper; }
                    const hCtx = helper.getContext('2d');
                    if (hCtx) {
                        hCtx.clearRect(0, 0, SIZE, SIZE);
                        hCtx.fillStyle = 'rgb(128, 128, 255)';
                        hCtx.fillRect(0, 0, SIZE, SIZE);
                        hCtx.globalCompositeOperation = 'destination-in';
                        hCtx.drawImage(maskCanvas, 0, 0);
                        hCtx.globalCompositeOperation = 'source-over';
                        dctx.save();
                        dctx.globalAlpha = opacity;
                        dctx.drawImage(helper, 0, 0);
                        dctx.restore();
                    }
                }
            }
        }

        compositeCacheRef.current[i] = dst;
        compositeKeyRef.current[i] = sig;
        prevCanvas = dst;
        prevKey = sig;
    }

    // Obstacle masks drive the B channel (mobility). They are independent of the
    // compositing chain, so they get their own cache key.
    const obstacleLayers = layers.filter(l =>
        l.visible && isObstacleLayer(l) && (contentVersionRef.current.get(`mask:${l.id}`) ?? 0) > 0);
    const hasObstacles = obstacleLayers.length > 0;
    const obsKey = obstacleLayers.map(l =>
        `${l.id}:${contentVersionRef.current.get(`mask:${l.id}`)}:${l.opacity.toFixed(3)}`).join(',');

    const finalKey = `${prevKey}|B:${hasObstacles ? obsKey : ''}`;
    let finalCanvas = finalCanvasRef.current;
    if (!finalCanvas) {
        finalCanvas = document.createElement('canvas');
        finalCanvas.width = SIZE; finalCanvas.height = SIZE;
        finalCanvasRef.current = finalCanvas;
    }

    if (finalKeyRef.current !== finalKey) {
        const fCtx = finalCanvas.getContext('2d');
        if (!fCtx) return;
        fCtx.globalCompositeOperation = 'source-over';
        fCtx.globalAlpha = 1;
        fCtx.filter = 'none';
        fCtx.clearRect(0, 0, SIZE, SIZE);
        if (prevCanvas) fCtx.drawImage(prevCanvas, 0, 0);
        else { fCtx.fillStyle = 'rgb(128, 128, 255)'; fCtx.fillRect(0, 0, SIZE, SIZE); }

        if (hasObstacles) {
            let obs = combinedObstacleRef.current;
            if (!obs) {
                obs = document.createElement('canvas');
                obs.width = SIZE; obs.height = SIZE;
                combinedObstacleRef.current = obs;
            }
            if (combinedObstacleKeyRef.current !== obsKey) {
                const oCtx = obs.getContext('2d');
                if (oCtx) {
                    oCtx.clearRect(0, 0, SIZE, SIZE);
                    obstacleLayers.forEach(l => {
                        const m = maskMap.get(l.id);
                        if (!m) return;
                        oCtx.save();
                        oCtx.globalAlpha = l.opacity;
                        oCtx.drawImage(m, 0, 0);
                        oCtx.restore();
                    });
                    combinedObstacleKeyRef.current = obsKey;
                }
            }
            const oCtx = obs.getContext('2d', { willReadFrequently: true });
            if (oCtx) {
                const od = oCtx.getImageData(0, 0, SIZE, SIZE).data;
                const fd = fCtx.getImageData(0, 0, SIZE, SIZE);
                const d = fd.data;
                for (let i = 0; i < od.length; i += 4) {
                    const a = od[i + 3];
                    if (a > 0) d[i + 2] = 255 - a;
                }
                fCtx.putImageData(fd, 0, 0);
            }
        }
        finalKeyRef.current = finalKey;
    }

    flowMapRef.current = finalCanvas;
    ctx.drawImage(finalCanvas, 0, 0);
    onTextureUpdate(finalCanvas);
    drawArrows(finalKey);
  }, [onTextureUpdate, drawArrows, layers, drawBlurred, generateWindData, applyDisturbance, getCachedCtx]);

  const renderComposite = useCallback(() => {
    if (renderPendingRef.current) return;
    renderPendingRef.current = true;
    requestAnimationFrame(renderCompositeInternal);
  }, [renderCompositeInternal]);

  // Sync layer canvases
  useEffect(() => {
      const map = layerCanvasesRef.current;
      const masks = maskCanvasesRef.current;
      layers.forEach(layer => {
          if (isPaintLayer(layer)) {
              if (!map.has(layer.id)) map.set(layer.id, initCanvas(SIZE, SIZE, 'rgba(0,0,0,0)'));
          } else {
              // Adjustment layers: content canvas for generated data, mask canvas for painted mask
              if (!map.has(layer.id)) map.set(layer.id, initCanvas(SIZE, SIZE));
              if (isAdjustmentLayer(layer) && (layer as any).hasMask && !masks.has(layer.id)) {
                  masks.set(layer.id, initCanvas(SIZE, SIZE, 'rgba(255,255,255,1)')); // Default white mask
              }
          }
      });
      const activeIds = new Set(layers.map(l => l.id));
      for (const id of map.keys()) { if (!activeIds.has(id)) map.delete(id); }
      for (const id of masks.keys()) { if (!activeIds.has(id)) masks.delete(id); }
      if (compositeCacheRef.current.length > layers.length) {
          compositeCacheRef.current.length = layers.length;
          compositeKeyRef.current.length = layers.length;
      }
      renderComposite();
  }, [layers, renderComposite]);

  // History
  // Only the active layer can change between two snapshots. Storing every layer
  // cost ~4MB per layer per step, which adds up to hundreds of MB in no time.
  const saveHistory = useCallback(() => {
    const snapshot = new Map<string, ImageData>();
    const id = activeLayerId;
    const content = layerCanvasesRef.current.get(id);
    if (content) {
        const ctx = content.getContext('2d');
        if (ctx) snapshot.set(id, ctx.getImageData(0, 0, SIZE, SIZE));
    }
    const mask = maskCanvasesRef.current.get(id);
    if (mask) {
        const ctx = mask.getContext('2d');
        if (ctx) snapshot.set(`mask:${id}`, ctx.getImageData(0, 0, SIZE, SIZE));
    }
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }
    historyRef.current.push(snapshot);
    historyIndexRef.current++;
    if (historyRef.current.length > 20) { historyRef.current.shift(); historyIndexRef.current--; }
  }, [activeLayerId]);

  const loadHistory = useCallback((index: number) => {
    const state = historyRef.current[index];
    if (!state) return;
    state.forEach((data, id) => {
        if (id.startsWith('mask:')) {
            const realId = id.slice(5);
            const canvas = maskCanvasesRef.current.get(realId);
            if (canvas) canvas.getContext('2d')?.putImageData(data, 0, 0);
        } else {
            const canvas = layerCanvasesRef.current.get(id);
            if (canvas) canvas.getContext('2d')?.putImageData(data, 0, 0);
        }
        bumpContentVersion(id);
    });
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, onPaintingComplete, bumpContentVersion]);

  const undo = useCallback(() => { if (historyIndexRef.current > 0) { historyIndexRef.current--; loadHistory(historyIndexRef.current); } }, [loadHistory]);
  const redo = useCallback(() => { if (historyIndexRef.current < historyRef.current.length - 1) { historyIndexRef.current++; loadHistory(historyIndexRef.current); } }, [loadHistory]);

  const clearLayer = useCallback((id: string) => {
      const canvas = layerCanvasesRef.current.get(id);
      if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) { ctx.clearRect(0, 0, SIZE, SIZE); bumpContentVersion(id); }
      }
      const mask = maskCanvasesRef.current.get(id);
      if (mask) {
          const ctx = mask.getContext('2d');
          if (ctx) { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, SIZE, SIZE); bumpContentVersion(`mask:${id}`); }
      }
      renderComposite(); saveHistory();
      if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, saveHistory, onPaintingComplete, bumpContentVersion]);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const zoomStart = useRef<{ y: number; startScale: number } | null>(null);

  // Brush resize
  const isFKeyPressed = useRef(false);
  const hasResizedBrush = useRef(false);
  const fKeyAccumulatedMovement = useRef(0);
  const currentBrushSizeRef = useRef(brushSettings.size);
  const fKeyPressTime = useRef(0);
  useEffect(() => { currentBrushSizeRef.current = brushSettings.size; }, [brushSettings.size]);

  const resetView = useCallback(() => { setTransform({ x: 0, y: 0, scale: 1 }); }, []);

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
          if (e.key.toLowerCase() === 'f' && !isFKeyPressed.current) {
              isFKeyPressed.current = true; hasResizedBrush.current = false;
              fKeyAccumulatedMovement.current = 0; fKeyPressTime.current = Date.now();
          }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
          if (e.key.toLowerCase() === 'f') {
              isFKeyPressed.current = false;
              if (!hasResizedBrush.current && Date.now() - fKeyPressTime.current < 200) resetView();
              hasResizedBrush.current = false; fKeyAccumulatedMovement.current = 0;
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [resetView]);

  useEffect(() => {
     const handleGlobalMouseMove = (e: MouseEvent) => {
       if (isFKeyPressed.current && onSetBrushSize) {
         if (e.ctrlKey || e.metaKey) return;
         fKeyAccumulatedMovement.current += Math.abs(e.movementX) + Math.abs(e.movementY);
         if (fKeyAccumulatedMovement.current > 10 || hasResizedBrush.current) {
           hasResizedBrush.current = true;
           onSetBrushSize(Math.max(1, Math.min(200, currentBrushSizeRef.current + e.movementX * 0.5)));
         }
       }
     };
     window.addEventListener('mousemove', handleGlobalMouseMove);
     return () => window.removeEventListener('mousemove', handleGlobalMouseMove);
   }, [onSetBrushSize]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
      const newScale = Math.max(0.1, Math.min(10, transform.scale - e.deltaY * 0.001));
      setTransform(prev => ({ ...prev, scale: newScale }));
  }, [transform.scale]);

  // Get the target canvas for the current active layer + edit target
  const getTargetCanvas = useCallback(() => {
      const activeLayer = layers.find(l => l.id === activeLayerId);
      if (!activeLayer) return null;
      
      if (isPaintLayer(activeLayer)) {
          return layerCanvasesRef.current.get(activeLayerId) ?? null;
      }
      
      // Adjustment layer
      if (editTarget === 'mask') {
          // Ensure mask exists
          if (!maskCanvasesRef.current.has(activeLayerId)) {
              maskCanvasesRef.current.set(activeLayerId, initCanvas(SIZE, SIZE, 'rgba(255,255,255,1)'));
              // Mark layer as having mask
              // (We can't update state from here, but we'll handle it)
          }
          return maskCanvasesRef.current.get(activeLayerId) ?? null;
      }
      
      return null; // Content mode on adjustment layer = no painting (just params)
  }, [activeLayerId, editTarget, layers]);

  // Drawing
  const drawStamp = useCallback((
    targetCanvas: HTMLCanvasElement, x: number, y: number, lx: number, ly: number,
    settings: BrushSettings, tool: ActiveTool, isMaskPaint: boolean
  ) => {
    const ctx = getCachedCtx(targetCanvas);
    if (!ctx) return;
    const dist = Math.hypot(x - lx, y - ly);
    if (dist < 0.5) return;

    let r = 128, g = 128;
    let compositeOp: GlobalCompositeOperation = 'source-over';

    if (tool === 'eraser') {
        compositeOp = 'destination-out';
    } else if (isMaskPaint) {
        // Painting mask: white = effect active
        r = 255; g = 255;
    } else {
        // Normal flow brush
        const vx = (x - lx) / dist, vy = (y - ly) / dist;
        const range = 127 * settings.strength;
        r = Math.min(255, Math.max(0, Math.round(128 - vx * range)));
        g = Math.min(255, Math.max(0, Math.round(128 + vy * range)));
    }

    const radius = settings.size / 2;
    const tipSize = Math.ceil(settings.size);
    const b = isMaskPaint ? 255 : 255;
    const tipKey = `${tipSize}_${r}_${g}_${b}_${settings.hardness}_${compositeOp}`;
    
    if (!brushTipCanvasRef.current) brushTipCanvasRef.current = document.createElement('canvas');
    const tipCanvas = brushTipCanvasRef.current;
    
    if (tipCanvas.width !== tipSize || tipCanvas.height !== tipSize || lastBrushTipKey.current !== tipKey) {
        tipCanvas.width = tipSize; tipCanvas.height = tipSize;
        lastBrushTipKey.current = tipKey;
        const tCtx = tipCanvas.getContext('2d');
        if (tCtx) {
            tCtx.clearRect(0, 0, tipSize, tipSize);
            const center = tipSize / 2;
            const innerRadius = radius * Math.max(0, Math.min(0.99, settings.hardness));
            const gradient = tCtx.createRadialGradient(center, center, innerRadius, center, center, radius);
            if (compositeOp === 'destination-out') {
                gradient.addColorStop(0, `rgba(0,0,0,1)`);
                gradient.addColorStop(1, `rgba(0,0,0,0)`);
            } else if (isMaskPaint) {
                gradient.addColorStop(0, `rgba(255,255,255,1)`);
                gradient.addColorStop(1, `rgba(255,255,255,0)`);
            } else {
                gradient.addColorStop(0, `rgba(${r}, ${g}, 255, 1)`);
                gradient.addColorStop(1, `rgba(${r}, ${g}, 255, 0)`);
            }
            tCtx.fillStyle = gradient;
            tCtx.fillRect(0, 0, tipSize, tipSize);
        }
    }

    ctx.globalCompositeOperation = compositeOp;
    const step = Math.max(1, settings.size * 0.1);
    for (let i = 0; i <= dist; i += step) {
        const t = i / dist;
        ctx.drawImage(tipCanvas, lx + (x - lx) * t - tipSize/2, ly + (y - ly) * t - tipSize/2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }, []);

  const stroke = useCallback((u: number, v: number, lu: number, lv: number) => {
    const targetCanvas = getTargetCanvas();
    if (!targetCanvas) return;

    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isMaskPaint = !!activeLayer && isAdjustmentLayer(activeLayer) && editTarget === 'mask';

    const x = u * SIZE, y = v * SIZE, lx = lu * SIZE, ly = lv * SIZE;
    const isWrappable = projectionType === 'equirectangular' || projectionType === 'polar';
    const dx = x - lx;

    if (isWrappable && Math.abs(dx) > SIZE * 0.5) {
        if (dx > 0) {
            drawStamp(targetCanvas, x - SIZE, y, lx, ly, brushSettings, activeTool, isMaskPaint);
            drawStamp(targetCanvas, x, y, lx + SIZE, ly, brushSettings, activeTool, isMaskPaint);
        } else {
            drawStamp(targetCanvas, x + SIZE, y, lx, ly, brushSettings, activeTool, isMaskPaint);
            drawStamp(targetCanvas, x, y, lx - SIZE, ly, brushSettings, activeTool, isMaskPaint);
        }
    } else {
        drawStamp(targetCanvas, x, y, lx, ly, brushSettings, activeTool, isMaskPaint);
        if (isWrappable) {
            const radius = brushSettings.size / 2;
            if (x < radius || lx < radius) drawStamp(targetCanvas, x + SIZE, y, lx + SIZE, ly, brushSettings, activeTool, isMaskPaint);
            if (x > SIZE - radius || lx > SIZE - radius) drawStamp(targetCanvas, x - SIZE, y, lx - SIZE, ly, brushSettings, activeTool, isMaskPaint);
        }
    }
    
    // Drop the cached composite for whichever buffer was just painted
    bumpContentVersion(isMaskPaint ? `mask:${activeLayerId}` : activeLayerId);

    renderComposite();
  }, [activeTool, brushSettings, drawStamp, renderComposite, projectionType, activeLayerId, layers, editTarget, getTargetCanvas, bumpContentVersion]);

  const floodFill = useCallback((u: number, v: number, threshold: number) => {
    const targetCanvas = getTargetCanvas();
    const refCanvas = referenceCanvasRef.current;
    if (!refCanvas || !targetCanvas) return;
    const w = SIZE, h = SIZE;
    const startX = Math.floor(u * w), startY = Math.floor(v * h);
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
    const refCtx = refCanvas.getContext('2d', { willReadFrequently: true });
    const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });
    if (!refCtx || !targetCtx) return;
    const refData = refCtx.getImageData(0, 0, w, h);
    const targetData = targetCtx.getImageData(0, 0, w, h);
    const targetIdx = (startY * w + startX) * 4;
    const targetColor = { r: refData.data[targetIdx], g: refData.data[targetIdx + 1], b: refData.data[targetIdx + 2] };
    const stack = [targetIdx];
    const visited = new Uint8Array(w * h);
    const maxDist = (threshold / 100) * 441;
    const maxDistSq = maxDist * maxDist;
    
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isMaskPaint = !!activeLayer && isAdjustmentLayer(activeLayer) && editTarget === 'mask';
    const fillR = isMaskPaint ? 255 : 128;
    const fillG = isMaskPaint ? 255 : 128;
    const fillB = isMaskPaint ? 255 : 255;
    
    while (stack.length > 0) {
        const idx = stack.pop()!;
        const pixelIndex = idx / 4;
        if (visited[pixelIndex]) continue;
        visited[pixelIndex] = 1;
        const r = refData.data[idx], g = refData.data[idx + 1], b = refData.data[idx + 2];
        const distSq = (r - targetColor.r)**2 + (g - targetColor.g)**2 + (b - targetColor.b)**2;
        if (distSq <= maxDistSq) {
            targetData.data[idx] = fillR; targetData.data[idx + 1] = fillG;
            targetData.data[idx + 2] = fillB; targetData.data[idx + 3] = 255;
            const x = pixelIndex % w, y = Math.floor(pixelIndex / w);
            const isWrappable = projectionType === 'equirectangular' || projectionType === 'polar';
            if (x > 0) stack.push(idx - 4); else if (isWrappable) stack.push(idx + (w - 1) * 4);
            if (x < w - 1) stack.push(idx + 4); else if (isWrappable) stack.push(idx - (w - 1) * 4);
            if (y > 0) stack.push(idx - w * 4);
            if (y < h - 1) stack.push(idx + w * 4);
        }
    }
    targetCtx.putImageData(targetData, 0, 0);
    bumpContentVersion(isMaskPaint ? `mask:${activeLayerId}` : activeLayerId);
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, onPaintingComplete, projectionType, activeLayerId, layers, editTarget, getTargetCanvas, bumpContentVersion]);

  useEffect(() => {
      if (historyRef.current.length === 0 && layerCanvasesRef.current.size > 0) saveHistory();
  }, [layers, saveHistory]);

  useImperativeHandle(ref, () => ({
    stroke, floodFill, undo, redo, saveHistory, clearLayer, renderComposite,
    getCanvas: () => canvasRef.current
  }), [stroke, floodFill, undo, redo, saveHistory, clearLayer, renderComposite]);

  const getUV = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { u: 0, v: 0 };
    const rect = canvas.getBoundingClientRect();
    return { u: (e.clientX - rect.left) / rect.width, v: (e.clientY - rect.top) / rect.height };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isFKeyPressed.current) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.ctrlKey && e.button === 1) { setIsZooming(true); zoomStart.current = { y: e.clientY, startScale: transform.scale }; return; }
    if (e.button === 1 || e.altKey) { setIsPanning(true); panStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y }; return; }
    const { u, v } = getUV(e);
    if (activeTool === 'magic_wand') { floodFill(u, v, magicWandThreshold); saveHistory(); return; }
    setIsDrawing(true);
    stroke(u, v, u, v);
    lastPos.current = { x: u, y: v };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isFKeyPressed.current) return;
    const { u, v } = getUV(e);
    onCursorUpdate?.({u, v});
    if (cursorPreviewRef.current && activeTool !== 'magic_wand') {
      if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) cursorPreviewRef.current.style.display = 'none';
      else {
        cursorPreviewRef.current.style.display = 'block';
        cursorPreviewRef.current.style.left = `${u * 100}%`;
        cursorPreviewRef.current.style.top = `${v * 100}%`;
        cursorPreviewRef.current.style.width = `${(brushSettings.size / SIZE) * 100}%`;
        cursorPreviewRef.current.style.height = `${(brushSettings.size / SIZE) * 100}%`;
      }
    }
    if (isZooming && zoomStart.current) {
        setTransform(prev => ({ ...prev, scale: Math.max(0.1, Math.min(10, zoomStart.current!.startScale * (1 - (e.clientY - zoomStart.current!.y) * 0.005))) }));
        return;
    }
    if (isPanning && panStart.current) {
        setTransform(prev => ({ ...prev, x: e.clientX - panStart.current!.x, y: e.clientY - panStart.current!.y }));
        return;
    }
    if (!isDrawing || !lastPos.current) return;
    stroke(u, v, lastPos.current.x, lastPos.current.y);
    lastPos.current = { x: u, y: v };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isFKeyPressed.current) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (cursorPreviewRef.current) cursorPreviewRef.current.style.display = 'none';
    if (isZooming) { setIsZooming(false); zoomStart.current = null; return; }
    if (isPanning) { setIsPanning(false); panStart.current = null; return; }
    if (isDrawing) saveHistory();
    setIsDrawing(false); lastPos.current = null;
    if (onPaintingComplete) onPaintingComplete();
  };

  return (
    <div className={`relative w-full h-full bg-neutral-900 overflow-hidden flex items-center justify-center ${className}`} onWheel={handleWheel}>
      <div className="relative shadow-2xl max-w-full max-h-full aspect-square origin-center will-change-transform"
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
        <canvas ref={canvasRef} width={SIZE} height={SIZE}
          className={`block max-w-full max-h-full touch-none z-0 ${activeTool === 'magic_wand' ? 'cursor-default' : 'cursor-none'}`}
          style={{ width: 'auto', height: 'auto', imageRendering: 'pixelated' }}
          onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
          onPointerLeave={() => { if (isFKeyPressed.current) return; onCursorUpdate?.(null); if (!isDrawing && cursorPreviewRef.current) cursorPreviewRef.current.style.display = 'none'; }}
        />
        <canvas ref={arrowCanvasRef} width={SIZE} height={SIZE}
          className="absolute inset-0 pointer-events-none z-20" style={{ width: '100%', height: '100%' }} />
        <div ref={cursorPreviewRef}
          className="absolute pointer-events-none border border-white rounded-full bg-white/10 z-30 hidden"
          style={{ left: '0%', top: '0%', width: `${(brushSettings.size / SIZE) * 100}%`, height: `${(brushSettings.size / SIZE) * 100}%`, transform: 'translate(-50%, -50%)' }}>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-opacity duration-75"
            style={{ width: '100%', height: '100%', opacity: brushSettings.strength * 0.8 }} />
        </div>
        {showReference && bgImageUrl && (
          <img src={bgImageUrl} alt="Guide" className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none z-10"
            style={{ opacity: referenceOpacity }} />
        )}
      </div>
    </div>
  );
});

export default FlowPainter;
