import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { BrushSettings, ActiveTool, FlowPainterHandle, ProjectionType, Layer } from '../types';

interface FlowPainterProps {
  brushSettings: BrushSettings;
  activeTool: ActiveTool;
  bgImageUrl: string | null;
  onTextureUpdate: (canvas: HTMLCanvasElement) => void;
  windDirection?: number;
  windTrigger?: number;
  resetTrigger?: number;
  
  // Layer System
  layers: Layer[];
  activeLayerId: string;
  globalLayerVisible?: boolean; // Controls visibility of the generated wind base
  
  // Magic Wand
  magicWandThreshold?: number;
  showMaskOverlay?: boolean;
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
  windDirection = 0,
  windTrigger = 0,
  resetTrigger = 0,
  layers,
  activeLayerId,
  globalLayerVisible = true,
  magicWandThreshold = 20,
  showMaskOverlay = false,
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
  
  // Layers
  const layerGlobalRef = useRef<HTMLCanvasElement | null>(null);
  const layerCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  
  const cursorPreviewRef = useRef<HTMLDivElement | null>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const arrowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const seamlessHelperRef = useRef<HTMLCanvasElement | null>(null);
  const redOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const flowMapRef = useRef<HTMLCanvasElement | null>(null);
  const brushTipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const disturbanceHelperRef = useRef<HTMLCanvasElement | null>(null);
  const obstacleHelperRef = useRef<HTMLCanvasElement | null>(null);
  const combinedObstacleHelperRef = useRef<HTMLCanvasElement | null>(null);

  const renderPendingRef = useRef(false);

  // History Management
  // Store a Map of layerID -> ImageData
  const historyRef = useRef<Map<string, ImageData>[]>([]);
  const historyIndexRef = useRef<number>(-1);

  // Helper to init canvas
  const initCanvas = (width = 1024, height = 1024, fillStyle?: string) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      if (ctx && fillStyle) {
          ctx.fillStyle = fillStyle;
          ctx.fillRect(0, 0, width, height);
      }
      return c;
  };

  const drawArrows = useCallback(() => {
    if (!arrowCanvasRef.current || !flowMapRef.current) return;
    
    const ctx = arrowCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, arrowCanvasRef.current.width, arrowCanvasRef.current.height);

    if (!showArrows) return;

    const width = flowMapRef.current.width;
    const height = flowMapRef.current.height;
    
    // Create temp context to read data if needed, or just use flowMapRef
    const flowCtx = flowMapRef.current.getContext('2d');
    if (!flowCtx) return;

    // Get image data - this might be expensive so we do it sparingly
    const imageData = flowCtx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const step = Math.max(16, 128 - arrowDensity); // Density 16-128 -> Step large-small
    
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
    ctx.fillStyle = 'rgba(251, 191, 36, 0.6)';
    ctx.lineWidth = 1;

    for (let y = step / 2; y < height; y += step) {
        for (let x = step / 2; x < width; x += step) {
            const i = (Math.floor(y) * width + Math.floor(x)) * 4;
            const r = data[i];     // X flow: 0(left) - 255(right) ? Check shader logic
            const g = data[i + 1]; // Y flow
            
            // Decode flow: 128 is 0. <128 is negative, >128 is positive.
            // In shader/paint logic: 
            // r = 128 - vx * range  => vx = (128 - r) / range
            // g = 128 + vy * range  => vy = (g - 128) / range
            
            const vx = (128 - r) / 127.0; 
            const vy = (g - 128) / 127.0;

            const rawLen = Math.sqrt(vx*vx + vy*vy);
            if (r === 128 && g === 128) continue;

            const angle = Math.atan2(vy, vx); // Keep UV angle for drawing on 2D map
            const arrowLen = Math.min(step * 0.8, rawLen * step * 2.0);

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            
            // Draw Arrow
            ctx.beginPath();
            ctx.moveTo(-arrowLen/2, 0);
            ctx.lineTo(arrowLen/2, 0);
            ctx.stroke();

            // Arrow head
            ctx.beginPath();
            ctx.moveTo(arrowLen/2, 0);
            ctx.lineTo(arrowLen/2 - 4, -3);
            ctx.lineTo(arrowLen/2 - 4, 3);
            ctx.fill();

            ctx.restore();
        }
    }
  }, [showArrows, arrowDensity]);

  useEffect(() => {
    drawArrows();
  }, [drawArrows]); // This will trigger when arrowDensity changes because drawArrows depends on it

  // Load Reference Image for Magic Wand
  useEffect(() => {
    if (!bgImageUrl) {
        referenceCanvasRef.current = null;
        return;
    }
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = bgImageUrl;
    img.onload = () => {
        const canvas = initCanvas(1024, 1024);
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0, 1024, 1024);
            referenceCanvasRef.current = canvas;
        }
    };
  }, [bgImageUrl]);

  // Helper to blur a canvas onto a context
  const drawBlurred = useCallback((
      targetCtx: CanvasRenderingContext2D,
      sourceCanvas: HTMLCanvasElement,
      blurAmount: number
  ) => {
      if (blurAmount <= 0) {
          targetCtx.drawImage(sourceCanvas, 0, 0);
          return;
      }

      const size = 1024;
      const padding = Math.ceil(blurAmount * 4); 
      const totalSize = size + padding * 2;
      
      let helper = seamlessHelperRef.current;
      if (!helper || helper.width !== totalSize || helper.height !== totalSize) {
           helper = document.createElement('canvas');
           helper.width = totalSize;
           helper.height = totalSize;
           seamlessHelperRef.current = helper;
      }
      
      const hCtx = helper.getContext('2d');
      if (hCtx) {
          hCtx.clearRect(0, 0, totalSize, totalSize);
          
          // Draw Center
          hCtx.drawImage(sourceCanvas, padding, padding);
          
          // Edges for Seamless Tiling
          hCtx.drawImage(sourceCanvas, padding - size, padding); 
          hCtx.drawImage(sourceCanvas, padding + size, padding); 
          hCtx.drawImage(sourceCanvas, padding, padding - size); 
          hCtx.drawImage(sourceCanvas, padding, padding + size); 
          
          // Corners 
          hCtx.drawImage(sourceCanvas, padding - size, padding - size);
          hCtx.drawImage(sourceCanvas, padding + size, padding - size);
          hCtx.drawImage(sourceCanvas, padding - size, padding + size);
          hCtx.drawImage(sourceCanvas, padding + size, padding + size);
          
          targetCtx.save();
          targetCtx.filter = `blur(${blurAmount}px)`;
          targetCtx.drawImage(helper, -padding, -padding);
          targetCtx.filter = 'none';
          targetCtx.restore();
      }
  }, []);

  // --- Rendering Pipeline ---
  const renderCompositeInternal = useCallback(() => {
    const mainCanvas = canvasRef.current;
    if (!mainCanvas) return;
    
    // Ensure Global Layer
    if (!layerGlobalRef.current) {
        // Initialize with default global wind if not exists
        layerGlobalRef.current = initCanvas(1024, 1024);
        
        // Trigger a generation if it's empty (though initCanvas clears it)
        // Actually, we should probably force a wind gen if it's the very first render
        // But the useEffect for windTrigger should handle it.
        // Let's just make sure we fill it with neutral first.
        const gCtx = layerGlobalRef.current.getContext('2d');
        if (gCtx) {
            gCtx.fillStyle = 'rgb(128, 128, 0)';
            gCtx.fillRect(0, 0, 1024, 1024);
        }
    }

    const ctx = mainCanvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Prepare Flow Map Canvas (Data Only)
    if (!flowMapRef.current) {
        flowMapRef.current = document.createElement('canvas');
        flowMapRef.current.width = 1024;
        flowMapRef.current.height = 1024;
    }
    const flowCtx = flowMapRef.current.getContext('2d', { alpha: false });
    if (!flowCtx) return;

    // 1. Draw Global Layer to Flow Map (Base)
    if (layerGlobalRef.current && globalLayerVisible) {
        // No blur for global layer as requested
        flowCtx.drawImage(layerGlobalRef.current, 0, 0);
    } else {
        flowCtx.fillStyle = 'rgb(128, 128, 0)';
        flowCtx.fillRect(0, 0, 1024, 1024);
    }

    // 2. Iterate and Draw Layers
    const layersMap = layerCanvasesRef.current;
    
    // Helper to apply flow disturbance around obstacles
    const applyDisturbance = (targetCtx: CanvasRenderingContext2D, obsCanvas: HTMLCanvasElement, distFactor: number, layerBlur: number) => {
        const w = 1024;
        const h = 1024;
        
        // 1. Create Gradient Map (Blurred Obstacle)
        let mapCanvas = disturbanceHelperRef.current;
        if (!mapCanvas) {
             mapCanvas = document.createElement('canvas');
             mapCanvas.width = w;
             mapCanvas.height = h;
             disturbanceHelperRef.current = mapCanvas;
        }
        const mapCtx = mapCanvas.getContext('2d');
        if (!mapCtx) return;
        mapCtx.clearRect(0, 0, w, h);

        // Disturbance Distance (Slider) controls Blur Radius
        // Range: 20px (min) to 300px (max)
        // This decouples the disturbance field from the obstacle's visual sharpness.
        // Users can now drag the slider to extend the influence field far beyond the obstacle.
        const blurRadius = 20 + distFactor * 280; 
        
        mapCtx.filter = `blur(${blurRadius}px)`;
        mapCtx.drawImage(obsCanvas, 0, 0);
        mapCtx.filter = 'none';

        const mapData = mapCtx.getImageData(0, 0, w, h);
        const targetData = targetCtx.getImageData(0, 0, w, h);
        const d = targetData.data;
        const m = mapData.data;

        // 2. Process Pixels
        for (let i = 0; i < w * h * 4; i += 4) {
            const alpha = m[i + 3];
            if (alpha < 2) continue; // Optimization: Skip almost zero alpha
            
            // Current Flow
            const curR = d[i];
            const curG = d[i + 1];
            
            // Normalize to -1..1 (Red is inverted)
            const vx = (128 - curR) / 128;
            const vy = (curG - 128) / 128;
            
            const currentSpeed = Math.hypot(vx, vy);
            if (currentSpeed < 0.01) continue; 

            // Calculate Gradient
            const idx = i / 4;
            const x = idx % w;
            const y = Math.floor(idx / w);
            
            // Use a large sample step to get smooth gradients from the large blur
            const sampleStep = Math.max(5, Math.floor(blurRadius * 0.2));
            
            const getAlpha = (tx: number, ty: number) => {
                const cx = tx < 0 ? 0 : (tx >= w ? w - 1 : tx);
                const cy = ty < 0 ? 0 : (ty >= h ? h - 1 : ty);
                return m[(cy * w + cx) * 4 + 3];
            };
            
            const gx = getAlpha(x + sampleStep, y) - getAlpha(x - sampleStep, y);
            const gy = getAlpha(x, y + sampleStep) - getAlpha(x, y - sampleStep);
            
            const gl = Math.hypot(gx, gy);
            if (gl < 0.1) continue; 

            // Normal (pointing INTO obstacle)
            const nx = gx / gl;
            const ny = gy / gl;

            // Tangent Strategy: Align with surface
            const t1x = -ny;
            const t1y = nx;
            
            // Calculate alignment with tangent
            const tangentDot = vx * t1x + vy * t1y;
            
            // Slip Vector: Physically correct "sliding" motion
            // V_slip = V - (V . N) * N
            // This naturally goes to zero at the stagnation point (head-on collision),
            // providing a smooth transition where flow splits.
            const slipVx = vx - (vx * nx + vy * ny) * nx;
            const slipVy = vy - (vx * nx + vy * ny) * ny;
            
            // Forced Tangent Vector: Artistic "Energy Preserving" motion
            // Forces the flow to keep moving at full speed around the object.
            // This is what creates the "hard" turn but looks "active".
            const tx = tangentDot >= 0 ? t1x : -t1x;
            const ty = tangentDot >= 0 ? t1y : -t1y;
            const forcedVx = tx * currentSpeed;
            const forcedVy = ty * currentSpeed;
            
            // Blending Strategy:
            // When flow is head-on (tangentDot is near 0), we are at the "Split Point".
            // Here we should prefer the Slip Vector (which slows down) to avoid abrupt direction flips.
            // When flow is glancing (tangentDot is high), we prefer Forced Tangent to keep energy.
            
            const alignment = Math.abs(tangentDot) / currentSpeed;
            
            // Quadratic ease-in for softer split at the nose.
            // When alignment is near 0 (Head On), splitFactor is very small -> Prefer Slip (Natural Slowdown).
            // When alignment is near 1 (Side), splitFactor is 1 -> Prefer Forced Tangent (Full Speed).
            let splitFactor = alignment * alignment;

            const targetVx = slipVx + (forcedVx - slipVx) * splitFactor;
            const targetVy = slipVy + (forcedVy - slipVy) * splitFactor;

            // Influence Calculation
            // We want a strong effect that extends far out.
            const normalizedAlpha = alpha / 255;
            
            // Boost influence for low-alpha regions (edges)
            // Even faint traces of the disturbance field should trigger significant deflection.
            // Gain of 5.0 means max influence is reached at ~20% alpha.
            let influence = Math.min(1.0, normalizedAlpha * 5.0);
            
            // Smoothstep for natural falloff
            influence = influence * influence * (3 - 2 * influence);
            
            // Impact Factor for dynamic adjustment
            // (vx * nx + vy * ny) is > 0 when flowing INTO obstacle
            const impact = (vx * nx + vy * ny) / currentSpeed;
            
            // Dynamic Blend Weight
            // If flowing INTO obstacle (impact > 0), blend STRONGLY to tangent to divert.
            // If flowing ALONG/AWAY, relax slightly to allow natural flow.
            let blend = 0;
            if (impact > 0) {
                 // Head-on: Force deflection.
                 // Even at distance, if we are aiming at the rock, start turning.
                 blend = influence * (1.0 + impact * 0.5); 
            } else {
                 // Glancing/Away: Maintain tangent alignment but less aggressively.
                 blend = influence * 0.8;
            }
            
            blend = Math.min(1.0, blend);

            // Interpolate
            
            let finalVx = vx + (targetVx - vx) * blend;
            let finalVy = vy + (targetVy - vy) * blend;
            
            // Normalize Speed
            const newSpeed = Math.hypot(finalVx, finalVy);
            if (newSpeed > 0.001) {
                // Adaptive Speed Restoration
                // If we are at the nose (splitFactor ~ 0), we allow the speed to drop (natural stagnation).
                // If we are at the sides (splitFactor ~ 1), we force the speed back to original (energy conservation).
                // This prevents the "skating" artifact where arrows suddenly speed up while turning at the nose.
                
                const finalSpeed = newSpeed + (currentSpeed - newSpeed) * splitFactor;
                
                finalVx = (finalVx / newSpeed) * finalSpeed;
                finalVy = (finalVy / newSpeed) * finalSpeed;
            }

            d[i] = Math.min(255, Math.max(0, 128 - finalVx * 128));
            d[i + 1] = Math.min(255, Math.max(0, 128 + finalVy * 128));
        }
        
        targetCtx.putImageData(targetData, 0, 0);
    };

    // We'll use a temp canvas to handle obstacle compositing (source-in) if needed
    // DO NOT use seamlessHelperRef here, as drawBlurred uses it internally.
    // Create a fresh dedicated canvas for Obstacle masking.
    let obstacleHelper = obstacleHelperRef.current;
    if (!obstacleHelper) {
         obstacleHelper = document.createElement('canvas');
         obstacleHelper.width = 1024;
         obstacleHelper.height = 1024;
         obstacleHelperRef.current = obstacleHelper;
    }
    const obsHelperCtx = obstacleHelper.getContext('2d');

    // We need to collect effective obstacle canvas for the mask overlay
    // If multiple layers are obstacles, we might need to composite them for the red overlay
    // For simplicity, we'll create a temp canvas for the combined obstacle mask if needed
    let combinedObstacle: HTMLCanvasElement | null = null;
    let combinedObstacleCtx: CanvasRenderingContext2D | null = null;

    if (showMaskOverlay) {
        combinedObstacle = combinedObstacleHelperRef.current;
        if (!combinedObstacle) {
            combinedObstacle = document.createElement('canvas');
            combinedObstacle.width = 1024;
            combinedObstacle.height = 1024;
            combinedObstacleHelperRef.current = combinedObstacle;
        }
        combinedObstacleCtx = combinedObstacle.getContext('2d');
        if (combinedObstacleCtx) {
             combinedObstacleCtx.clearRect(0, 0, 1024, 1024);
        }
    }

    layers.forEach(layer => {
        if (!layer.visible) return;
        const layerCanvas = layersMap.get(layer.id);
        if (!layerCanvas) return;

        const currentOpacity = layer.opacity ?? 1;

        if (layer.isObstacle && obsHelperCtx) {
            // -- Obstacle Rendering Logic --
            // We want to draw the layer's shape, but force the color to Neutral (128, 128, 0).
            // This ensures that even if the user painted with "Flow" colors, toggling "Obstacle" makes it act like one.
            
            // 1. Clear Helper
            obsHelperCtx.clearRect(0, 0, 1024, 1024);
            
            // 2. Draw the Layer Content (Shape)
            if (layer.blur > 0) {
                // Here drawBlurred uses seamlessHelperRef.current
                // We are drawing INTO obsHelperCtx (obstacleHelper)
                // This is safe because obstacleHelper != seamlessHelperRef.current
                drawBlurred(obsHelperCtx, layerCanvas, layer.blur);
            } else {
                obsHelperCtx.drawImage(layerCanvas, 0, 0);
            }
            
            // 3. Composite "Source-In" with Obstacle Color
            obsHelperCtx.globalCompositeOperation = 'source-in';
            obsHelperCtx.fillStyle = 'rgb(128, 128, 0)';
            obsHelperCtx.fillRect(0, 0, 1024, 1024);
            obsHelperCtx.globalCompositeOperation = 'source-over'; // Reset

            // Apply Disturbance to existing flow
            if (layer.disturbanceEnabled) {
                 applyDisturbance(flowCtx, obstacleHelper, layer.disturbance ?? 0, layer.blur);
            }

            // 4. Draw result to Flow Map
            flowCtx.save();
            flowCtx.globalAlpha = currentOpacity;
            flowCtx.drawImage(obstacleHelper, 0, 0);
            flowCtx.restore();

            // 5. Add to Combined Obstacle Mask (for Red Overlay)
            if (combinedObstacleCtx) {
                 combinedObstacleCtx.save();
                 combinedObstacleCtx.globalAlpha = currentOpacity;
                 combinedObstacleCtx.drawImage(obstacleHelper, 0, 0);
                 combinedObstacleCtx.restore();
            }

        } else {
            // -- Normal Flow Rendering Logic --
            flowCtx.save();
            flowCtx.globalAlpha = currentOpacity;
            if (layer.blur > 0) {
                drawBlurred(flowCtx, layerCanvas, layer.blur);
            } else {
                flowCtx.drawImage(layerCanvas, 0, 0);
            }
            flowCtx.restore();
        }
    });

    // Update the 3D Texture
    onTextureUpdate(flowMapRef.current);
    drawArrows();

    // Render to Display Canvas
    ctx.drawImage(flowMapRef.current, 0, 0);

    // 3. Draw Red Mask Overlay
    if (showMaskOverlay && combinedObstacle) {
        if (!redOverlayRef.current) {
            redOverlayRef.current = document.createElement('canvas');
            redOverlayRef.current.width = 1024;
            redOverlayRef.current.height = 1024;
        }
        const redOverlay = redOverlayRef.current;
        const rCtx = redOverlay.getContext('2d');

        if (rCtx) {
            rCtx.clearRect(0, 0, 1024, 1024);
            rCtx.globalCompositeOperation = 'source-over';
            rCtx.drawImage(combinedObstacle, 0, 0);
            rCtx.globalCompositeOperation = 'source-in';
            rCtx.fillStyle = 'rgba(255, 0, 0, 0.6)';
            rCtx.fillRect(0, 0, 1024, 1024);
            
            ctx.drawImage(redOverlay, 0, 0);
        }
    }
    
    renderPendingRef.current = false;
  }, [onTextureUpdate, drawArrows, globalLayerVisible, showMaskOverlay, layers, drawBlurred]);

  const renderComposite = useCallback(() => {
    if (renderPendingRef.current) return;
    renderPendingRef.current = true;
    requestAnimationFrame(renderCompositeInternal);
  }, [renderCompositeInternal]);

  // Sync Layers Ref
  useEffect(() => {
      const map = layerCanvasesRef.current;
      // Add missing
      layers.forEach(layer => {
          if (!map.has(layer.id)) {
              map.set(layer.id, initCanvas(1024, 1024, 'rgba(0,0,0,0)'));
          }
      });
      // Remove deleted
      const activeIds = new Set(layers.map(l => l.id));
      for (const id of map.keys()) {
          if (!activeIds.has(id)) {
              map.delete(id);
          }
      }
      renderComposite();
  }, [layers, renderComposite]);

  const saveHistory = useCallback(() => {
    console.log('[FlowPainter] Saving history. Current Index:', historyIndexRef.current, 'Total:', historyRef.current.length);

    const snapshot = new Map<string, ImageData>();
    layerCanvasesRef.current.forEach((canvas, id) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
            snapshot.set(id, ctx.getImageData(0, 0, 1024, 1024));
        }
    });

    // If we are not at the end, truncate
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }

    historyRef.current.push(snapshot);
    historyIndexRef.current++;

    // Limit size (20 steps)
    if (historyRef.current.length > 20) {
        historyRef.current.shift();
        historyIndexRef.current--;
    }
  }, []);

  const loadHistory = useCallback((index: number) => {
    const state = historyRef.current[index];
    if (!state) return;

    // Clear all current canvases first? Or assume state covers all?
    // State might contain IDs that are no longer in `layers` prop if we undid a "Add Layer" action?
    // Actually, `layers` prop is controlled by App. `undo` here only restores CONTENT.
    // If we undid a "Layer Deletion", we rely on App to restore the layer object, 
    // but FlowPainter doesn't know about App's state.
    // LIMITATION: This local history only restores CANVAS CONTENT. It assumes the Layer IDs still exist.
    // For a robust system, App should handle history including Layer structure.
    // For now, we just restore content to matching IDs.
    
    state.forEach((data, id) => {
        const canvas = layerCanvasesRef.current.get(id);
        if (canvas) {
            canvas.getContext('2d')?.putImageData(data, 0, 0);
        }
    });
    
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, onPaintingComplete]);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        loadHistory(historyIndexRef.current);
    }
  }, [loadHistory]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current++;
        loadHistory(historyIndexRef.current);
    }
  }, [loadHistory]);

  const clearLayer = useCallback((id: string) => {
      const canvas = layerCanvasesRef.current.get(id);
      if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, 1024, 1024);
          renderComposite();
          saveHistory();
          if (onPaintingComplete) onPaintingComplete();
      }
  }, [renderComposite, saveHistory, onPaintingComplete]);

  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Zoom and Pan State
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const zoomStart = useRef<{ y: number; startScale: number } | null>(null);

  // Brush Resize State
  const isFKeyPressed = useRef(false);
  const hasResizedBrush = useRef(false);
  const fKeyAccumulatedMovement = useRef(0);
  const currentBrushSizeRef = useRef(brushSettings.size);
  const fKeyPressTime = useRef(0);

  useEffect(() => {
    currentBrushSizeRef.current = brushSettings.size;
  }, [brushSettings.size]);

  const resetView = useCallback(() => {
      setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
          const key = e.key.toLowerCase();
          if (key === 'f') {
              if (!isFKeyPressed.current) {
                  isFKeyPressed.current = true;
                  hasResizedBrush.current = false;
                  fKeyAccumulatedMovement.current = 0;
                  fKeyPressTime.current = Date.now();
              }
              return;
          }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
          const key = e.key.toLowerCase();
          if (key === 'f') {
              isFKeyPressed.current = false;
              
              const pressDuration = Date.now() - fKeyPressTime.current;
              // Only reset view if it was a quick tap (<200ms) and no resize happened
              // This prevents accidental view resets when user holds F but doesn't move mouse much
              if (!hasResizedBrush.current && pressDuration < 200) {
                  resetView();
              }
              
              hasResizedBrush.current = false;
              fKeyAccumulatedMovement.current = 0;
              return;
          }
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      return () => {
          window.removeEventListener('keydown', handleKeyDown);
          window.removeEventListener('keyup', handleKeyUp);
      };
  }, [resetView]);

  useEffect(() => {
     const handleGlobalMouseMove = (e: MouseEvent) => {
       // Always update cursor position if F is pressed to prevent jumping
       if (isFKeyPressed.current) {
         const canvas = canvasRef.current;
         if (canvas) {
           const rect = canvas.getBoundingClientRect();
           const u = (e.clientX - rect.left) / rect.width;
           const v = (e.clientY - rect.top) / rect.height;
           onCursorUpdate?.({ u, v });

           if (cursorPreviewRef.current && activeTool !== 'magic_wand') {
             if (u >= -0.1 && u <= 1.1 && v >= -0.1 && v <= 1.1) {
               cursorPreviewRef.current.style.display = 'block';
               cursorPreviewRef.current.style.left = `${u * 100}%`;
               cursorPreviewRef.current.style.top = `${v * 100}%`;
             } else {
               cursorPreviewRef.current.style.display = 'none';
             }
           }
         }
       }

       if (isFKeyPressed.current && onSetBrushSize) {
         // If Ctrl/Meta is pressed, we are likely adjusting strength (handled in App.tsx), so skip size adjustment
         if (e.ctrlKey || e.metaKey) return;

         const dx = e.movementX;
         const dy = e.movementY;
         fKeyAccumulatedMovement.current += Math.abs(dx) + Math.abs(dy);
         
         if (fKeyAccumulatedMovement.current > 10 || hasResizedBrush.current) {
           hasResizedBrush.current = true;
           const newSize = Math.max(1, Math.min(200, currentBrushSizeRef.current + dx * 0.5));
           onSetBrushSize(newSize);

           if (cursorPreviewRef.current) {
             const sizePercent = (newSize / 1024) * 100;
             cursorPreviewRef.current.style.width = `${sizePercent}%`;
             cursorPreviewRef.current.style.height = `${sizePercent}%`;
           }
         }
       }
     };

     window.addEventListener('mousemove', handleGlobalMouseMove);
     return () => window.removeEventListener('mousemove', handleGlobalMouseMove);
   }, [onSetBrushSize, activeTool, onCursorUpdate]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
      const zoomSensitivity = 0.001;
      const newScale = Math.max(0.1, Math.min(10, transform.scale - e.deltaY * zoomSensitivity));
      setTransform(prev => ({ ...prev, scale: newScale }));
  }, [transform.scale]);

  const floodFill = useCallback((u: number, v: number, threshold: number) => {
    const refCanvas = referenceCanvasRef.current;
    // Target the active layer
    const targetCanvas = layerCanvasesRef.current.get(activeLayerId);
    
    if (!refCanvas || !targetCanvas) return;
    
    const w = 1024;
    const h = 1024;
    const startX = Math.floor(u * w);
    const startY = Math.floor(v * h);
    
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
    
    const refCtx = refCanvas.getContext('2d', { willReadFrequently: true });
    const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });
    if (!refCtx || !targetCtx) return;
    
    const refData = refCtx.getImageData(0, 0, w, h);
    const targetData = targetCtx.getImageData(0, 0, w, h);
    
    const targetIdx = (startY * w + startX) * 4;
    const targetColor = {
        r: refData.data[targetIdx],
        g: refData.data[targetIdx + 1],
        b: refData.data[targetIdx + 2]
    };
    
    const stack = [targetIdx];
    const visited = new Uint8Array(w * h); 
    
    const maxDist = (threshold / 100) * 441; 
    const maxDistSq = maxDist * maxDist;

    // Check if current layer is an Obstacle Layer
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isObstacle = activeLayer?.isObstacle;

    // Fill Color
    // If obstacle layer, fill with 128,128,0,255
    // If normal layer, what to fill with? Magic wand usually selects area.
    // User context: "Magic Wand" was used to select area and mark as obstacle.
    // If we are on a Flow layer, maybe we just want to fill with current brush flow?
    // But Flood Fill usually fills with a color.
    // Given the context, Flood Fill is primarily for Obstacles.
    // I'll assume it fills with Obstacle Color (Neutral) if on Obstacle Layer,
    // Or maybe just Neutral Flow if on Flow Layer (which means "Erase Flow" effectively?).
    // Let's stick to Neutral Flow (128, 128, 0, 255) for now as it's the safest default for "Filling".
    
    const fillR = 128;
    const fillG = 128;
    const fillB = 0;
    const fillA = 255;

    while (stack.length > 0) {
        const idx = stack.pop()!;
        const pixelIndex = idx / 4;
        
        if (visited[pixelIndex]) continue;
        visited[pixelIndex] = 1;
        
        const r = refData.data[idx];
        const g = refData.data[idx + 1];
        const b = refData.data[idx + 2];
        
        const distSq = (r - targetColor.r)**2 + (g - targetColor.g)**2 + (b - targetColor.b)**2;
        
        if (distSq <= maxDistSq) {
            targetData.data[idx] = fillR;
            targetData.data[idx + 1] = fillG;
            targetData.data[idx + 2] = fillB;
            targetData.data[idx + 3] = fillA;
            
            const x = pixelIndex % w;
            const y = Math.floor(pixelIndex / w);
            
            const isWrappable = projectionType === 'equirectangular' || projectionType === 'polar';
            
            if (x > 0) {
                stack.push((idx - 4));
            } else if (isWrappable) {
                stack.push(idx + (w - 1) * 4);
            }

            if (x < w - 1) {
                stack.push((idx + 4));
            } else if (isWrappable) {
                stack.push(idx - (w - 1) * 4);
            }
            
            if (y > 0) stack.push((idx - w * 4));
            if (y < h - 1) stack.push((idx + w * 4));
        }
    }
    
    targetCtx.putImageData(targetData, 0, 0);
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, onPaintingComplete, saveHistory, projectionType, activeLayerId, layers]);

  // Initialize Layers (Effect handled above)
  
  // Initial History Save
  useEffect(() => {
      if (historyRef.current.length === 0 && layerCanvasesRef.current.size > 0) {
          saveHistory();
      }
  }, [layers, saveHistory]);

  const drawStamp = useCallback((
    targetCanvas: HTMLCanvasElement,
    x: number, 
    y: number, 
    lx: number, 
    ly: number, 
    settings: BrushSettings,
    tool: ActiveTool,
    isObstacleLayer: boolean
  ) => {
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return;

    const dist = Math.hypot(x - lx, y - ly);
    if (dist < 0.5) return;

    let r = 128, g = 128, a = 1.0;
    let compositeOp: GlobalCompositeOperation = 'source-over';

    if (tool === 'eraser') {
        compositeOp = 'destination-out';
    } else if (isObstacleLayer) {
        // If painting on obstacle layer with brush, paint neutral (obstacle) color
        r = 128; g = 128; a = 1.0; 
    } else {
        // Normal Flow Brush
        const vx = (x - lx) / dist;
        const vy = (y - ly) / dist;
        const range = 127 * settings.strength;
        r = Math.min(255, Math.max(0, Math.round(128 - vx * range)));
        g = Math.min(255, Math.max(0, Math.round(128 + vy * range)));
    }

    const radius = settings.size / 2;
    const tipSize = Math.ceil(settings.size);
    if (!brushTipCanvasRef.current) {
        brushTipCanvasRef.current = document.createElement('canvas');
    }
    const tipCanvas = brushTipCanvasRef.current;
    if (tipCanvas.width !== tipSize || tipCanvas.height !== tipSize) {
        tipCanvas.width = tipSize;
        tipCanvas.height = tipSize;
    }
    const tCtx = tipCanvas.getContext('2d');
    if (tCtx) {
        tCtx.clearRect(0, 0, tipSize, tipSize);
        const center = tipSize / 2;
        const innerRadius = radius * Math.max(0, Math.min(0.99, settings.hardness));
        const gradient = tCtx.createRadialGradient(center, center, innerRadius, center, center, radius);
        
        if (compositeOp === 'destination-out') {
            gradient.addColorStop(0, `rgba(0,0,0,1)`);
            gradient.addColorStop(1, `rgba(0,0,0,0)`);
        } else {
            gradient.addColorStop(0, `rgba(${r}, ${g}, 0, 1)`);
            gradient.addColorStop(1, `rgba(${r}, ${g}, 0, 0)`);
        }
        
        tCtx.fillStyle = gradient;
        tCtx.fillRect(0, 0, tipSize, tipSize);
    }

    ctx.globalCompositeOperation = compositeOp;
    const step = Math.max(1, settings.size * 0.1); 
    
    for (let i = 0; i <= dist; i += step) {
        const t = i / dist;
        const px = lx + (x - lx) * t;
        const py = ly + (y - ly) * t;
        ctx.drawImage(tipCanvas, px - tipSize/2, py - tipSize/2);
    }
    
    ctx.globalCompositeOperation = 'source-over';
  }, []);

  const stroke = useCallback((u: number, v: number, lu: number, lv: number) => {
    const targetCanvas = layerCanvasesRef.current.get(activeLayerId);
    if (!targetCanvas) return;
    
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isObstacleLayer = activeLayer?.isObstacle || false;

    const w = 1024;
    const h = 1024;
    
    const x = u * w;
    const y = v * h;
    const lx = lu * w;
    const ly = lv * h;

    const isWrappable = projectionType === 'equirectangular' || projectionType === 'polar';
    const dx = x - lx;
    const wrapThreshold = w * 0.5;

    if (isWrappable && Math.abs(dx) > wrapThreshold) {
        if (dx > 0) {
            drawStamp(targetCanvas, x - w, y, lx, ly, brushSettings, activeTool, isObstacleLayer);
            drawStamp(targetCanvas, x, y, lx + w, ly, brushSettings, activeTool, isObstacleLayer);
        } else {
             drawStamp(targetCanvas, x + w, y, lx, ly, brushSettings, activeTool, isObstacleLayer);
             drawStamp(targetCanvas, x, y, lx - w, ly, brushSettings, activeTool, isObstacleLayer);
        }
    } else {
        drawStamp(targetCanvas, x, y, lx, ly, brushSettings, activeTool, isObstacleLayer);
        
        if (isWrappable) {
             const radius = brushSettings.size / 2;
             if (x < radius || lx < radius) {
                 drawStamp(targetCanvas, x + w, y, lx + w, ly, brushSettings, activeTool, isObstacleLayer);
             }
             if (x > w - radius || lx > w - radius) {
                 drawStamp(targetCanvas, x - w, y, lx - w, ly, brushSettings, activeTool, isObstacleLayer);
             }
        }
    }
    
    renderComposite();
  }, [activeTool, brushSettings, drawStamp, renderComposite, projectionType, activeLayerId, layers]);

  useImperativeHandle(ref, () => ({
    stroke,
    floodFill,
    undo,
    redo,
    saveHistory,
    clearLayer,
    renderComposite,
    getCanvas: () => canvasRef.current
  }), [stroke, floodFill, undo, redo, saveHistory, clearLayer, renderComposite]);

  // Track previous triggers
  const lastWindTrigger = useRef<number | null>(null);
  const lastWindDirection = useRef<number | null>(null);
  const lastProjectionType = useRef<ProjectionType | null>(null);
  const lastPolarAngle = useRef<number | null>(null);
  const lastResetTrigger = useRef(resetTrigger);

  // Generate Wind Effect (Global Layer)
  useEffect(() => {
    const windChanged = 
        windTrigger !== lastWindTrigger.current ||
        windDirection !== lastWindDirection.current ||
        projectionType !== lastProjectionType.current ||
        polarAngle !== lastPolarAngle.current;
    
    // Force initial generation if global layer is missing content
    const isFirstRun = lastWindTrigger.current === null;

    lastWindTrigger.current = windTrigger;
    lastWindDirection.current = windDirection;
    lastProjectionType.current = projectionType;
    lastPolarAngle.current = polarAngle;

    if (!windChanged && !isFirstRun) return;
    
    // Ensure layer exists
    if (!layerGlobalRef.current) {
        layerGlobalRef.current = initCanvas(1024, 1024);
    }
    
    const ctx = layerGlobalRef.current.getContext('2d');
    if (!ctx) return;

    const width = 1024;
    const height = 1024;
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    const polarRad = (polarAngle * Math.PI) / 180;
    const windRad = (windDirection * Math.PI) / 180;
    
    const Wx = Math.sin(windRad);
    const Wy = 0;
    const Wz = Math.cos(windRad);
    const step = 0.05; 
    const strength = 15.0; 

    if (projectionType === 'planar') {
        const du = Wx * step; 
        const dv = Wz * step;
        
        const r = Math.floor(Math.max(0, Math.min(255, 128 + (-du * strength * 127))));
        const g = Math.floor(Math.max(0, Math.min(255, 128 + (-dv * strength * 127))));
        
        for (let i = 0; i < data.length; i += 4) {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = 0;
            data[i + 3] = 255;
        }
    } else {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                const u = (x + 0.5) / width;
                const v = 1.0 - ((y + 0.5) / height); 
    
                let valid = true;
                let nx = 0, ny = 0, nz = 0;
                let px = 0, py = 0, pz = 0;
    
                if (projectionType === 'polar') {
                    const uc = u - 0.5;
                    const vc = v - 0.5;
                    const r = Math.sqrt(uc*uc + vc*vc);
                    if (r > 0.5) {
                        valid = false;
                    } else {
                        const theta = Math.atan2(uc, vc);
                        const phi = (r / 0.5) * polarRad;
                        px = Math.sin(phi) * Math.sin(theta);
                        py = Math.cos(phi);
                        pz = Math.sin(phi) * Math.cos(theta);
                    }
                } else {
                    const phi = (1 - v) * Math.PI;
                    const theta = u * 2 * Math.PI;
                    px = Math.sin(phi) * Math.sin(theta);
                    py = Math.cos(phi);
                    pz = Math.sin(phi) * Math.cos(theta);
                }
    
                if (!valid) {
                    data[index] = 128;
                    data[index + 1] = 128;
                    data[index + 2] = 0;
                    data[index + 3] = 255; 
                    continue;
                }
    
                nx = px + Wx * step;
                ny = py + Wy * step;
                nz = pz + Wz * step;
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
                    let normTheta = theta;
                    if (normTheta < 0) normTheta += 2 * Math.PI;
                    nextU = normTheta / (2 * Math.PI);
                }
    
                let du = nextU - u;
                let dv = nextV - v;
    
                if (projectionType === 'equirectangular') {
                    if (du > 0.5) du -= 1.0;
                    if (du < -0.5) du += 1.0;
                }
                
                const r = Math.floor(Math.max(0, Math.min(255, 128 + (-du * strength * 127))));
                const g = Math.floor(Math.max(0, Math.min(255, 128 + (-dv * strength * 127))));
    
                data[index] = r;
                data[index + 1] = g;
                data[index + 2] = 0;
                data[index + 3] = 255;
            }
        }
    }

    ctx.putImageData(imageData, 0, 0);
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [windTrigger, windDirection, renderComposite, onPaintingComplete, projectionType, polarAngle, drawArrows]);

  // Handle Reset
  useEffect(() => {
      if (resetTrigger !== lastResetTrigger.current) {
          lastResetTrigger.current = resetTrigger;
          if (resetTrigger > 0) {
              if (layerGlobalRef.current) {
                  const ctx = layerGlobalRef.current.getContext('2d');
                  if (ctx) { ctx.fillStyle = 'rgb(128,128,0)'; ctx.fillRect(0,0,1024,1024); }
              }
              // Clear all layers
              layerCanvasesRef.current.forEach(canvas => {
                  const ctx = canvas.getContext('2d');
                  if (ctx) ctx.clearRect(0,0,1024,1024);
              });
              renderComposite();
              saveHistory();
              if (onPaintingComplete) onPaintingComplete();
          }
      }
  }, [resetTrigger, renderComposite, onPaintingComplete, saveHistory]);

  const getUV = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { u: 0, v: 0 };
    const rect = canvas.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    return { u, v };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isFKeyPressed.current) return;
    
    // Ensure we capture all pointer events (even outside canvas)
    (e.target as Element).setPointerCapture(e.pointerId);

    let isPanAction = false;
    let isZoomAction = false;
    
    if (e.ctrlKey && e.button === 1) {
        isZoomAction = true;
    } 
    else if (e.button === 1 || e.altKey) {
        isPanAction = true;
    }

    if (isZoomAction) {
        setIsZooming(true);
        zoomStart.current = { y: e.clientY, startScale: transform.scale };
        return;
    }

    if (isPanAction) {
        setIsPanning(true);
        panStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
        return;
    }

    const { u, v } = getUV(e);
    
    if (cursorPreviewRef.current && activeTool !== 'magic_wand') {
      cursorPreviewRef.current.style.display = 'block';
      cursorPreviewRef.current.style.left = `${u * 100}%`;
      cursorPreviewRef.current.style.top = `${v * 100}%`;
    }

    if (activeTool === 'magic_wand') {
        floodFill(u, v, magicWandThreshold);
        saveHistory();
        return;
    }
    setIsDrawing(true);
    stroke(u, v, u, v);
    lastPos.current = { x: u, y: v };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isFKeyPressed.current) return;
    
    const { u, v } = getUV(e);
    onCursorUpdate?.({u, v});

    if (cursorPreviewRef.current && activeTool !== 'magic_wand') {
      // Check bounds slightly loosely or just allow it to follow
      if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) {
        cursorPreviewRef.current.style.display = 'none';
      } else {
        cursorPreviewRef.current.style.display = 'block';
        cursorPreviewRef.current.style.left = `${u * 100}%`;
        cursorPreviewRef.current.style.top = `${v * 100}%`;
        cursorPreviewRef.current.style.width = `${(brushSettings.size / 1024) * 100}%`;
        cursorPreviewRef.current.style.height = `${(brushSettings.size / 1024) * 100}%`;
      }
    }

    if (isZooming && zoomStart.current) {
        const deltaY = e.clientY - zoomStart.current.y;
        const zoomSensitivity = 0.005;
        const newScale = Math.max(0.1, Math.min(10, zoomStart.current.startScale * (1 - deltaY * zoomSensitivity)));
        setTransform(prev => ({ ...prev, scale: newScale }));
        return;
    }

    if (isPanning && panStart.current) {
         const startX = panStart.current.x;
         const startY = panStart.current.y;
         setTransform(prev => ({
             ...prev,
             x: e.clientX - startX,
             y: e.clientY - startY
         }));
         return;
    }

    if (!isDrawing || !lastPos.current) return;
    stroke(u, v, lastPos.current.x, lastPos.current.y);
    lastPos.current = { x: u, y: v };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isFKeyPressed.current) return;
    
    (e.target as Element).releasePointerCapture(e.pointerId);

    if (cursorPreviewRef.current) {
      cursorPreviewRef.current.style.display = 'none';
    }
    if (isZooming) {
        setIsZooming(false);
        zoomStart.current = null;
        return;
    }

    if (isPanning) {
        setIsPanning(false);
        panStart.current = null;
        return;
    }

    if (isDrawing) {
        saveHistory();
    }
    setIsDrawing(false);
    lastPos.current = null;
    if (onPaintingComplete) onPaintingComplete();
  };

  // Sync cursor from external source
  useEffect(() => {
    if (activeTool === 'magic_wand' || !cursorPreviewRef.current) return;
    
    if (cursorUV) {
        const { u, v } = cursorUV;
        // Check bounds
        if (u >= -0.1 && u <= 1.1 && v >= -0.1 && v <= 1.1) {
             cursorPreviewRef.current.style.display = 'block';
             cursorPreviewRef.current.style.left = `${u * 100}%`;
             cursorPreviewRef.current.style.top = `${v * 100}%`;
             cursorPreviewRef.current.style.width = `${(brushSettings.size / 1024) * 100}%`;
             cursorPreviewRef.current.style.height = `${(brushSettings.size / 1024) * 100}%`;
        } else {
             cursorPreviewRef.current.style.display = 'none';
        }
    }
  }, [cursorUV, activeTool, brushSettings.size]);

  return (
    <div 
      className={`relative w-full h-full bg-neutral-900 overflow-hidden flex items-center justify-center ${className}`}
      onWheel={handleWheel}
    >
      <div 
        className="relative shadow-2xl max-w-full max-h-full aspect-square origin-center will-change-transform"
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      >
        <canvas
          ref={canvasRef}
          width={1024}
          height={1024}
          className={`block max-w-full max-h-full touch-none z-0 ${activeTool === 'magic_wand' ? 'cursor-default' : 'cursor-none'}`}
          style={{ width: 'auto', height: 'auto', imageRendering: 'pixelated' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            if (isFKeyPressed.current) return;
            onCursorUpdate?.(null);
            if (!isDrawing) {
                // Only hide cursor if not drawing (if drawing, we captured pointer, so keep showing)
                // Also check if we have external cursorUV, if so, don't hide immediately?
                // Actually, if we leave, we set shared to null.
                // So the Effect will hide it eventually.
                if (cursorPreviewRef.current) cursorPreviewRef.current.style.display = 'none';
            }
          }}
        />
        <canvas
          ref={arrowCanvasRef}
          width={1024}
          height={1024}
          className="absolute inset-0 pointer-events-none z-20"
          style={{ width: '100%', height: '100%' }}
        />
        <div 
          ref={cursorPreviewRef}
          className="absolute pointer-events-none border border-white rounded-full bg-white/10 z-30 hidden"
          style={{
            left: '0%',
            top: '0%',
            width: `${(brushSettings.size / 1024) * 100}%`,
            height: `${(brushSettings.size / 1024) * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Inner circle for strength feedback - Opacity represents strength */}
          <div 
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-opacity duration-75"
            style={{
              width: '100%',
              height: '100%',
              opacity: brushSettings.strength * 0.8
            }}
          />
        </div>
        {showReference && (
          bgImageUrl ? (
            <img 
              src={bgImageUrl} 
              alt="Guide" 
              className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none z-10"
              style={{ opacity: referenceOpacity }}
            />
          ) : (
            <div
              className="absolute inset-0 pointer-events-none select-none z-10"
              style={{
                opacity: referenceOpacity,
                backgroundColor: 'rgba(0,0,0,0.25)',
                backgroundImage:
                  'linear-gradient(45deg, rgba(255,255,255,0.12) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.12) 75%, rgba(255,255,255,0.12)), linear-gradient(45deg, rgba(255,255,255,0.12) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.12) 75%, rgba(255,255,255,0.12))',
                backgroundSize: '24px 24px',
                backgroundPosition: '0 0, 12px 12px',
              }}
            />
          )
        )}
      </div>
    </div>
  );
});

export default FlowPainter;
