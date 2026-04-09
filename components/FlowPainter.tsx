import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { BrushSettings, ActiveTool, FlowPainterHandle, ProjectionType, Layer, 
         isPaintLayer, isWindLayer, isObstacleLayer, isAdjustmentLayer, EditTarget } from '../types';

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

  // Context cache
  const ctxCacheRef = useRef<Map<HTMLCanvasElement, CanvasRenderingContext2D>>(new Map());
  const getCachedCtx = (canvas: HTMLCanvasElement, options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null => {
      let ctx = ctxCacheRef.current.get(canvas);
      if (!ctx) {
          ctx = canvas.getContext('2d', options) ?? undefined;
          if (ctx) ctxCacheRef.current.set(canvas, ctx);
      }
      return ctx ?? null;
  };

  // History
  const historyRef = useRef<Map<string, ImageData>[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const SIZE = 1024;

  const initCanvas = (width = SIZE, height = SIZE, fillStyle?: string) => {
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      const ctx = c.getContext('2d');
      if (ctx && fillStyle) { ctx.fillStyle = fillStyle; ctx.fillRect(0, 0, width, height); }
      return c;
  };

  // --- Arrow Drawing ---
  const drawArrows = useCallback(() => {
    if (!arrowCanvasRef.current || !flowMapRef.current) return;
    const ctx = arrowCanvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!showArrows) return;
    const flowCtx = flowMapRef.current.getContext('2d');
    if (!flowCtx) return;
    const imageData = flowCtx.getImageData(0, 0, SIZE, SIZE);
    const data = imageData.data;
    const step = Math.max(16, 128 - arrowDensity);
    const shaftPath = new Path2D();
    const headPath = new Path2D();
    for (let y = step / 2; y < SIZE; y += step) {
        for (let x = step / 2; x < SIZE; x += step) {
            const i = (Math.floor(y) * SIZE + Math.floor(x)) * 4;
            const r = data[i], g = data[i + 1];
            if (r === 128 && g === 128) continue;
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
  }, [showArrows, arrowDensity]);

  useEffect(() => { drawArrows(); }, [drawArrows]);

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
      const padding = Math.ceil(blurAmount * 4);
      const totalSize = SIZE + padding * 2;
      let helper = seamlessHelperRef.current;
      if (!helper || helper.width !== totalSize || helper.height !== totalSize) {
           helper = document.createElement('canvas');
           helper.width = totalSize; helper.height = totalSize;
           seamlessHelperRef.current = helper;
      }
      const hCtx = helper.getContext('2d');
      if (hCtx) {
          hCtx.clearRect(0, 0, totalSize, totalSize);
          hCtx.drawImage(sourceCanvas, padding, padding);
          hCtx.drawImage(sourceCanvas, padding - SIZE, padding);
          hCtx.drawImage(sourceCanvas, padding + SIZE, padding);
          hCtx.drawImage(sourceCanvas, padding, padding - SIZE);
          hCtx.drawImage(sourceCanvas, padding, padding + SIZE);
          hCtx.drawImage(sourceCanvas, padding - SIZE, padding - SIZE);
          hCtx.drawImage(sourceCanvas, padding + SIZE, padding - SIZE);
          hCtx.drawImage(sourceCanvas, padding - SIZE, padding + SIZE);
          hCtx.drawImage(sourceCanvas, padding + SIZE, padding + SIZE);
          targetCtx.save();
          targetCtx.filter = `blur(${blurAmount}px)`;
          targetCtx.drawImage(helper, -padding, -padding);
          targetCtx.filter = 'none';
          targetCtx.restore();
      }
  }, []);

  // --- Wind Layer Generation ---
  const generateWindData = useCallback((canvas: HTMLCanvasElement, direction: number, strength: number) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.createImageData(SIZE, SIZE);
    const data = imageData.data;
    const polarRad = (polarAngle * Math.PI) / 180;
    const windRad = (direction * Math.PI) / 180;
    const Wx = Math.sin(windRad), Wy = 0, Wz = Math.cos(windRad);
    const step = 0.05;
    const s = 15.0 * strength;

    if (projectionType === 'planar') {
        const du = Wx * step, dv = Wz * step;
        const r = Math.floor(Math.max(0, Math.min(255, 128 + (-du * s * 127))));
        const g = Math.floor(Math.max(0, Math.min(255, 128 + (-dv * s * 127))));
        for (let i = 0; i < data.length; i += 4) {
            data[i] = r; data[i + 1] = g; data[i + 2] = 255; data[i + 3] = 255;
        }
    } else {
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                const index = (y * SIZE + x) * 4;
                const u = (x + 0.5) / SIZE;
                const v = 1.0 - ((y + 0.5) / SIZE);
                let valid = true;
                let px = 0, py = 0, pz = 0;
                if (projectionType === 'polar') {
                    const uc = u - 0.5, vc = v - 0.5;
                    const r = Math.sqrt(uc*uc + vc*vc);
                    if (r > 0.5) { valid = false; }
                    else {
                        const theta = Math.atan2(uc, vc);
                        const phi = (r / 0.5) * polarRad;
                        px = Math.sin(phi) * Math.sin(theta); py = Math.cos(phi); pz = Math.sin(phi) * Math.cos(theta);
                    }
                } else {
                    const phi = (1 - v) * Math.PI;
                    const theta = u * 2 * Math.PI;
                    px = Math.sin(phi) * Math.sin(theta); py = Math.cos(phi); pz = Math.sin(phi) * Math.cos(theta);
                }
                if (!valid) { data[index] = 128; data[index+1] = 128; data[index+2] = 255; data[index+3] = 255; continue; }
                let nx = px + Wx * step, ny = py + Wy * step, nz = pz + Wz * step;
                const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                nx /= len; ny /= len; nz /= len;
                let nextU = 0, nextV = 0;
                if (projectionType === 'polar') {
                    const clampedY = Math.max(-1, Math.min(1, ny));
                    const phi = Math.acos(clampedY);
                    const theta = Math.atan2(nx, nz);
                    const r = (phi / polarRad) * 0.5;
                    nextU = 0.5 + r * Math.sin(theta);
                    nextV = 0.5 + r * Math.cos(theta);
                } else {
                    const clampedY = Math.max(-1, Math.min(1, ny));
                    const phi = Math.acos(clampedY);
                    const theta = Math.atan2(nx, nz);
                    nextV = 1.0 - (phi / Math.PI);
                    let normTheta = theta; if (normTheta < 0) normTheta += 2 * Math.PI;
                    nextU = normTheta / (2 * Math.PI);
                }
                let du = nextU - u, dv = nextV - v;
                if (projectionType === 'equirectangular') { if (du > 0.5) du -= 1.0; if (du < -0.5) du += 1.0; }
                const rr = Math.floor(Math.max(0, Math.min(255, 128 + (-du * s * 127))));
                const gg = Math.floor(Math.max(0, Math.min(255, 128 + (-dv * s * 127))));
                data[index] = rr; data[index+1] = gg; data[index+2] = 255; data[index+3] = 255;
            }
        }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [projectionType, polarAngle]);

  // --- Disturbance ---
  const applyDisturbance = useCallback((targetCtx: CanvasRenderingContext2D, obsCanvas: HTMLCanvasElement, distFactor: number) => {
    const w = SIZE, h = SIZE;
    let mapCanvas = disturbanceHelperRef.current;
    if (!mapCanvas) { mapCanvas = initCanvas(w, h); disturbanceHelperRef.current = mapCanvas; }
    const mapCtx = mapCanvas.getContext('2d');
    if (!mapCtx) return;
    mapCtx.clearRect(0, 0, w, h);
    const blurRadius = 20 + distFactor * 280;
    mapCtx.filter = `blur(${blurRadius}px)`;
    mapCtx.drawImage(obsCanvas, 0, 0);
    mapCtx.filter = 'none';
    const mapData = mapCtx.getImageData(0, 0, w, h);
    const targetData = targetCtx.getImageData(0, 0, w, h);
    const d = targetData.data, m = mapData.data;
    const sampleStep = Math.max(5, Math.floor(blurRadius * 0.2));
    const getAlpha = (tx: number, ty: number) => {
        const cx = tx < 0 ? 0 : (tx >= w ? w - 1 : tx);
        const cy = ty < 0 ? 0 : (ty >= h ? h - 1 : ty);
        return m[(cy * w + cx) * 4 + 3];
    };
    for (let i = 0; i < w * h * 4; i += 4) {
        const alpha = m[i + 3];
        if (alpha < 2) continue;
        const curR = d[i], curG = d[i + 1];
        const vx = (128 - curR) / 128, vy = (curG - 128) / 128;
        const currentSpeed = Math.hypot(vx, vy);
        if (currentSpeed < 0.01) continue;
        const idx = i / 4, x = idx % w, y = Math.floor(idx / w);
        const gx = getAlpha(x + sampleStep, y) - getAlpha(x - sampleStep, y);
        const gy = getAlpha(x, y + sampleStep) - getAlpha(x, y - sampleStep);
        const gl = Math.hypot(gx, gy);
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
        const newSpeed = Math.hypot(finalVx, finalVy);
        if (newSpeed > 0.001) {
            const finalSpeed = newSpeed + (currentSpeed - newSpeed) * splitFactor;
            finalVx = (finalVx / newSpeed) * finalSpeed;
            finalVy = (finalVy / newSpeed) * finalSpeed;
        }
        d[i] = Math.min(255, Math.max(0, 128 - finalVx * 128));
        d[i + 1] = Math.min(255, Math.max(0, 128 + finalVy * 128));
    }
    targetCtx.putImageData(targetData, 0, 0);
  }, []);

  // --- Main Rendering Pipeline ---
  const renderCompositeInternal = useCallback(() => {
    const mainCanvas = canvasRef.current;
    if (!mainCanvas) return;
    const ctx = mainCanvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (!flowMapRef.current) {
        flowMapRef.current = document.createElement('canvas');
        flowMapRef.current.width = SIZE; flowMapRef.current.height = SIZE;
    }
    const flowCtx = flowMapRef.current.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!flowCtx) return;

    // Start with neutral (128, 128, 255) = no flow, fully mobile
    flowCtx.fillStyle = 'rgb(128, 128, 255)';
    flowCtx.fillRect(0, 0, SIZE, SIZE);

    const canvasMap = layerCanvasesRef.current;
    const maskMap = maskCanvasesRef.current;

    // Track if we have any obstacles for B-channel post-processing
    let hasObstacles = false;
    let combinedObstacle: HTMLCanvasElement | null = null;
    let combinedObstacleCtx: CanvasRenderingContext2D | null = null;

    // Process layers from bottom to top (array order)
    layers.forEach(layer => {
        if (!layer.visible) return;
        const opacity = layer.opacity ?? 1;

        if (isPaintLayer(layer)) {
            // Paint layer: direct blend of hand-drawn flow, with optional blur
            const canvas = canvasMap.get(layer.id);
            if (!canvas) return;
            flowCtx.save();
            flowCtx.globalAlpha = opacity;
            if (layer.blur > 0) {
                drawBlurred(flowCtx, canvas, layer.blur);
            } else {
                flowCtx.drawImage(canvas, 0, 0);
            }
            flowCtx.restore();

        } else if (isWindLayer(layer)) {
            // Wind adjustment layer: generate wind data, apply with mask
            let windCanvas = canvasMap.get(layer.id);
            if (!windCanvas) { windCanvas = initCanvas(); canvasMap.set(layer.id, windCanvas); }
            generateWindData(windCanvas, layer.direction, layer.strength);
            
            const maskCanvas = layer.hasMask ? maskMap.get(layer.id) : null;
            
            if (maskCanvas) {
                // Apply wind only where mask is white
                // Use a temp canvas: draw wind, then source-in with mask
                let helper = blurHelperRef.current;
                if (!helper) { helper = initCanvas(); blurHelperRef.current = helper; }
                const hCtx = helper.getContext('2d');
                if (hCtx) {
                    hCtx.clearRect(0, 0, SIZE, SIZE);
                    hCtx.drawImage(windCanvas, 0, 0);
                    hCtx.globalCompositeOperation = 'destination-in';
                    hCtx.drawImage(maskCanvas, 0, 0);
                    hCtx.globalCompositeOperation = 'source-over';
                    flowCtx.save();
                    flowCtx.globalAlpha = opacity;
                    flowCtx.drawImage(helper, 0, 0);
                    flowCtx.restore();
                }
            } else {
                // No mask: apply wind everywhere
                flowCtx.save();
                flowCtx.globalAlpha = opacity;
                flowCtx.drawImage(windCanvas, 0, 0);
                flowCtx.restore();
            }

        } else if (isObstacleLayer(layer)) {
            // Obstacle adjustment layer: mask defines obstacle shape
            const maskCanvas = layer.hasMask ? maskMap.get(layer.id) : null;
            if (!maskCanvas) return; // No mask = no obstacle

            hasObstacles = true;
            
            // Collect for combined obstacle (for B-channel)
            if (!combinedObstacle) {
                combinedObstacle = initCanvas();
                combinedObstacleCtx = combinedObstacle.getContext('2d');
                if (combinedObstacleCtx) combinedObstacleCtx.clearRect(0, 0, SIZE, SIZE);
            }
            if (combinedObstacleCtx) {
                combinedObstacleCtx.save();
                combinedObstacleCtx.globalAlpha = opacity;
                combinedObstacleCtx.drawImage(maskCanvas, 0, 0);
                combinedObstacleCtx.restore();
            }

            // Apply disturbance
            if (layer.disturbanceEnabled && layer.disturbance > 0) {
                applyDisturbance(flowCtx, maskCanvas, layer.disturbance);
            }

            // Draw neutral flow color where obstacle exists
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
                flowCtx.save();
                flowCtx.globalAlpha = opacity;
                flowCtx.drawImage(helper, 0, 0);
                flowCtx.restore();
            }
        }
    });

    // Post-processing: B-channel for obstacles
    if (hasObstacles && combinedObstacle && combinedObstacleCtx) {
        const obsData = combinedObstacleCtx.getImageData(0, 0, SIZE, SIZE);
        const fData = flowCtx.getImageData(0, 0, SIZE, SIZE);
        const od = obsData.data, fd = fData.data;
        for (let i = 0; i < od.length; i += 4) {
            const obsAlpha = od[i + 3];
            if (obsAlpha > 0) {
                fd[i + 2] = Math.round(255 * (1 - obsAlpha / 255));
            }
        }
        flowCtx.putImageData(fData, 0, 0);
    }

    onTextureUpdate(flowMapRef.current);
    drawArrows();
    ctx.drawImage(flowMapRef.current, 0, 0);
    renderPendingRef.current = false;
  }, [onTextureUpdate, drawArrows, layers, drawBlurred, generateWindData, applyDisturbance]);

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
      renderComposite();
  }, [layers, renderComposite]);

  // History
  const saveHistory = useCallback(() => {
    const snapshot = new Map<string, ImageData>();
    layerCanvasesRef.current.forEach((canvas, id) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) snapshot.set(id, ctx.getImageData(0, 0, SIZE, SIZE));
    });
    // Also save masks
    maskCanvasesRef.current.forEach((canvas, id) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) snapshot.set(`mask:${id}`, ctx.getImageData(0, 0, SIZE, SIZE));
    });
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }
    historyRef.current.push(snapshot);
    historyIndexRef.current++;
    if (historyRef.current.length > 20) { historyRef.current.shift(); historyIndexRef.current--; }
  }, []);

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
    });
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, onPaintingComplete]);

  const undo = useCallback(() => { if (historyIndexRef.current > 0) { historyIndexRef.current--; loadHistory(historyIndexRef.current); } }, [loadHistory]);
  const redo = useCallback(() => { if (historyIndexRef.current < historyRef.current.length - 1) { historyIndexRef.current++; loadHistory(historyIndexRef.current); } }, [loadHistory]);

  const clearLayer = useCallback((id: string) => {
      const canvas = layerCanvasesRef.current.get(id);
      if (canvas) { const ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, SIZE, SIZE); }
      const mask = maskCanvasesRef.current.get(id);
      if (mask) { const ctx = mask.getContext('2d'); if (ctx) { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, SIZE, SIZE); } }
      renderComposite(); saveHistory();
      if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, saveHistory, onPaintingComplete]);

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
    
    // If we painted a mask, mark layer as having mask
    if (isMaskPaint && activeLayer && isAdjustmentLayer(activeLayer) && !(activeLayer as any).hasMask) {
        // This is a side effect but necessary to sync state
    }
    
    renderComposite();
  }, [activeTool, brushSettings, drawStamp, renderComposite, projectionType, activeLayerId, layers, editTarget, getTargetCanvas]);

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
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, onPaintingComplete, projectionType, activeLayerId, layers, editTarget, getTargetCanvas]);

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
