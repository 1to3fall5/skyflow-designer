import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { BrushSettings, ActiveTool, FlowPainterHandle, ProjectionType, LayerSettings } from '../types';

interface FlowPainterProps {
  brushSettings: BrushSettings;
  activeTool: ActiveTool;
  bgImageUrl: string | null;
  onTextureUpdate: (canvas: HTMLCanvasElement) => void;
  windDirection?: number;
  windTrigger?: number;
  resetTrigger?: number;
  clearBrushTrigger?: number;
  clearGlobalTrigger?: number;
  clearObstacleTrigger?: number;
  
  // Layer Settings
  globalBlur: number;
  obstacleBlur: number;
  brushBlur: number;
  
  globalLayerVisible?: boolean;
  obstacleLayerVisible?: boolean;
  brushLayerVisible?: boolean;
  
  // Magic Wand
  magicWandThreshold?: number;
  showMaskOverlay?: boolean;
  showReference?: boolean;

  className?: string;
  onPaintingComplete?: () => void;
  onSetBrushSize?: (size: number) => void;
  projectionType?: ProjectionType;
  polarAngle?: number;
}

const FlowPainter = forwardRef<FlowPainterHandle, FlowPainterProps>(({ 
  brushSettings, 
  activeTool,
  bgImageUrl, 
  onTextureUpdate,
  windDirection = 0,
  windTrigger = 0,
  resetTrigger = 0,
  clearBrushTrigger = 0,
  clearGlobalTrigger = 0,
  clearObstacleTrigger = 0,
  globalBlur = 0,
  obstacleBlur = 0,
  brushBlur = 0,
  globalLayerVisible = true,
  obstacleLayerVisible = true,
  brushLayerVisible = true,
  magicWandThreshold = 20,
  showMaskOverlay = false,
  showReference = false,
  className,
  onPaintingComplete,
  onSetBrushSize,
  projectionType = 'equirectangular',
  polarAngle = 90
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Three Layers
  const layerGlobalRef = useRef<HTMLCanvasElement | null>(null);
  const layerObstacleRef = useRef<HTMLCanvasElement | null>(null);
  const layerBrushRef = useRef<HTMLCanvasElement | null>(null);
  const cursorPreviewRef = useRef<HTMLDivElement | null>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const seamlessHelperRef = useRef<HTMLCanvasElement | null>(null);
  const tempBrushRef = useRef<HTMLCanvasElement | null>(null);
  const tempObstRef = useRef<HTMLCanvasElement | null>(null);
  const redOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const flowMapRef = useRef<HTMLCanvasElement | null>(null);

  // History Management
  const historyRef = useRef<{ brush: ImageData; obstacle: ImageData }[]>([]);
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
      
      const hCtx = helper.getContext('2d', { willReadFrequently: true });
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
  const renderComposite = useCallback(() => {
    const mainCanvas = canvasRef.current;
    if (!mainCanvas) return;
    
    // Ensure layers exist
    if (!layerGlobalRef.current) layerGlobalRef.current = initCanvas(1024, 1024); // Start transparent, will be filled by wind logic
    if (!layerObstacleRef.current) layerObstacleRef.current = initCanvas(1024, 1024, 'rgba(0,0,0,0)'); // Transparent
    if (!layerBrushRef.current) layerBrushRef.current = initCanvas(1024, 1024, 'rgba(128,128,0,0)'); 

    const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Prepare Flow Map Canvas (Data Only)
    if (!flowMapRef.current) {
        flowMapRef.current = document.createElement('canvas');
        flowMapRef.current.width = 1024;
        flowMapRef.current.height = 1024;
    }
    const flowCtx = flowMapRef.current.getContext('2d', { willReadFrequently: true });
    if (!flowCtx) return;

    // Clear Flow Map with Neutral Flow (128, 128, 0)
    flowCtx.fillStyle = 'rgba(128, 128, 0, 1)';
    flowCtx.fillRect(0, 0, 1024, 1024);

    // 1. Draw Global Layer to Flow Map
    if (layerGlobalRef.current && globalLayerVisible) {
        drawBlurred(flowCtx, layerGlobalRef.current, globalBlur);
    }

    // 2. Draw Brush Layer to Flow Map
    if (layerBrushRef.current && brushLayerVisible) {
        // Create a temp canvas for blurred brush
        if (!tempBrushRef.current) {
            tempBrushRef.current = document.createElement('canvas');
            tempBrushRef.current.width = 1024;
            tempBrushRef.current.height = 1024;
        }
        const tempBrush = tempBrushRef.current;
        const tbCtx = tempBrush.getContext('2d', { willReadFrequently: true });
        if (tbCtx) {
             tbCtx.clearRect(0, 0, 1024, 1024);
             drawBlurred(tbCtx, layerBrushRef.current, brushBlur);
             flowCtx.drawImage(tempBrush, 0, 0);
        }
    }

    // 3. Prepare Obstacle Data (Shared for Flow Map and Red Mask)
    let tempObst: HTMLCanvasElement | null = null;
    if (layerObstacleRef.current && obstacleLayerVisible) {
         if (!tempObstRef.current) {
             tempObstRef.current = document.createElement('canvas');
             tempObstRef.current.width = 1024;
             tempObstRef.current.height = 1024;
         }
         tempObst = tempObstRef.current;
         const toCtx = tempObst.getContext('2d', { willReadFrequently: true });
         if (toCtx) {
             toCtx.clearRect(0, 0, 1024, 1024);
             drawBlurred(toCtx, layerObstacleRef.current, obstacleBlur);
         }
    }

    // 4. Apply Obstacle to Flow Map
    if (tempObst) {
         flowCtx.drawImage(tempObst, 0, 0);
    }

    // Update the 3D Texture with the CLEAN Flow Map (No Red Mask)
    onTextureUpdate(flowMapRef.current);

    // Now render to the Display Canvas (Main Canvas)
    // First, copy the Flow Map
    ctx.clearRect(0, 0, 1024, 1024);
    ctx.drawImage(flowMapRef.current, 0, 0);

    // 5. Draw Red Mask Overlay on Display Canvas Only
    if (tempObst && showMaskOverlay) {
        if (!redOverlayRef.current) {
            redOverlayRef.current = document.createElement('canvas');
            redOverlayRef.current.width = 1024;
            redOverlayRef.current.height = 1024;
        }
        const redOverlay = redOverlayRef.current;
        const rCtx = redOverlay.getContext('2d');

        if (rCtx) {
            rCtx.globalCompositeOperation = 'source-over';
            rCtx.clearRect(0, 0, 1024, 1024);
            
            // Draw the obstacle shape
            rCtx.drawImage(tempObst, 0, 0);
            
            // Tint it red
            rCtx.globalCompositeOperation = 'source-in';
            rCtx.fillStyle = 'rgba(255, 0, 0, 0.6)';
            rCtx.fillRect(0, 0, 1024, 1024);
            
            // Draw to main canvas
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(redOverlay, 0, 0);
            ctx.restore();
        }
    }
  }, [onTextureUpdate, globalBlur, obstacleBlur, brushBlur, drawBlurred, globalLayerVisible, obstacleLayerVisible, brushLayerVisible, showMaskOverlay]);

  const saveHistory = useCallback(() => {
    const brushCanvas = layerBrushRef.current;
    const obstacleCanvas = layerObstacleRef.current;
    if (!brushCanvas || !obstacleCanvas) return;

    console.log('[FlowPainter] Saving history. Current Index:', historyIndexRef.current, 'Total:', historyRef.current.length);

    const bCtx = brushCanvas.getContext('2d', { willReadFrequently: true });
    const oCtx = obstacleCanvas.getContext('2d', { willReadFrequently: true });
    if (!bCtx || !oCtx) return;

    const w = 1024, h = 1024;
    const brushData = bCtx.getImageData(0, 0, w, h);
    const obstacleData = oCtx.getImageData(0, 0, w, h);

    const newState = {
        brush: brushData,
        obstacle: obstacleData
    };

    // If we are not at the end, truncate
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }

    historyRef.current.push(newState);
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

    const brushCanvas = layerBrushRef.current;
    const obstacleCanvas = layerObstacleRef.current;
    if (!brushCanvas || !obstacleCanvas) return;

    const bCtx = brushCanvas.getContext('2d');
    const oCtx = obstacleCanvas.getContext('2d');
    if (!bCtx || !oCtx) return;

    bCtx.putImageData(state.brush, 0, 0);
    oCtx.putImageData(state.obstacle, 0, 0);
    
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, onPaintingComplete]);

  const undo = useCallback(() => {
    console.log('[FlowPainter] Undo called. Index:', historyIndexRef.current);
    if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        loadHistory(historyIndexRef.current);
    } else {
        console.log('[FlowPainter] Undo ignored: Already at start');
    }
  }, [loadHistory]);

  const redo = useCallback(() => {
    console.log('[FlowPainter] Redo called. Index:', historyIndexRef.current, 'Total:', historyRef.current.length);
    if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current++;
        loadHistory(historyIndexRef.current);
    } else {
        console.log('[FlowPainter] Redo ignored: Already at end');
    }
  }, [loadHistory]);

  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Zoom and Pan State
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isZooming, setIsZooming] = useState(false); // New state for drag zoom
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const zoomStart = useRef<{ y: number; startScale: number } | null>(null); // Track zoom drag start

  // Brush Resize State (Mirroring UEControls logic)
  const isFKeyPressed = useRef(false);
  const hasResizedBrush = useRef(false);
  const fKeyAccumulatedMovement = useRef(0);
  const currentBrushSizeRef = useRef(brushSettings.size);

  // Keep ref in sync
  useEffect(() => {
    currentBrushSizeRef.current = brushSettings.size;
  }, [brushSettings.size]);

  // Reset View
  const resetView = useCallback(() => {
      setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          // Check if target is input or textarea
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
          
          const key = e.key.toLowerCase();
          if (key === 'f') {
              if (!isFKeyPressed.current) {
                  isFKeyPressed.current = true;
                  hasResizedBrush.current = false;
                  fKeyAccumulatedMovement.current = 0;
                  // Use pointer lock if supported
                  canvasRef.current?.requestPointerLock();
              }
              return;
          }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
          const key = e.key.toLowerCase();
          if (key === 'f') {
              isFKeyPressed.current = false;
              if (document.pointerLockElement === canvasRef.current) {
                  document.exitPointerLock();
              }
              
              // Only trigger reset if we didn't resize the brush
              if (!hasResizedBrush.current) {
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

  // Handle Global Mouse Move for Brush Resize (Pointer Lock)
   useEffect(() => {
     const handleGlobalMouseMove = (e: MouseEvent) => {
       if (isFKeyPressed.current && onSetBrushSize) {
         const dx = e.movementX;
         const dy = e.movementY;
         fKeyAccumulatedMovement.current += Math.abs(dx) + Math.abs(dy);
         
         // Threshold to prevent accidental resize when just clicking F for reset
         if (fKeyAccumulatedMovement.current > 5 || hasResizedBrush.current) {
           hasResizedBrush.current = true;
           const delta = dx;
           // Adjust sensitivity and clamp (1 to 200)
           const newSize = Math.max(1, Math.min(200, currentBrushSizeRef.current + delta * 0.5));
           onSetBrushSize(newSize);

           // Update preview size in real-time
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
   }, [onSetBrushSize]);

  // Mouse Wheel Zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
      // Prevent default to stop page scroll if any
      // e.preventDefault(); // React synthetic event can't always prevent default, but we'll try
      
      const zoomSensitivity = 0.001;
      const newScale = Math.max(0.1, Math.min(10, transform.scale - e.deltaY * zoomSensitivity));
      
      setTransform(prev => ({
          ...prev,
          scale: newScale
      }));
  }, [transform.scale]);

  const floodFill = useCallback((u: number, v: number, threshold: number) => {
    const refCanvas = referenceCanvasRef.current;
    const obsCanvas = layerObstacleRef.current;
    if (!refCanvas || !obsCanvas) return;
    
    const w = 1024;
    const h = 1024;
    const startX = Math.floor(u * w);
    const startY = Math.floor(v * h);
    
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
    
    const refCtx = refCanvas.getContext('2d', { willReadFrequently: true });
    const obsCtx = obsCanvas.getContext('2d', { willReadFrequently: true });
    if (!refCtx || !obsCtx) return;
    
    const refData = refCtx.getImageData(0, 0, w, h);
    const obsData = obsCtx.getImageData(0, 0, w, h);
    
    const targetIdx = (startY * w + startX) * 4;
    const targetColor = {
        r: refData.data[targetIdx],
        g: refData.data[targetIdx + 1],
        b: refData.data[targetIdx + 2]
    };
    
    // Stack for flood fill (store pixel index, not byte index, to save space/math?)
    // Storing byte index is fine.
    const stack = [targetIdx];
    const visited = new Uint8Array(w * h); // 0 = unvisited
    
    // Threshold calculation
    // Max distance in RGB space is sqrt(255^2 * 3) approx 441.
    // Threshold 0-100.
    const maxDist = (threshold / 100) * 441; 
    const maxDistSq = maxDist * maxDist;

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
            // Mark as obstacle (128, 128, 0, 255)
            obsData.data[idx] = 128;
            obsData.data[idx + 1] = 128;
            obsData.data[idx + 2] = 0;
            obsData.data[idx + 3] = 255;
            
            const x = pixelIndex % w;
            const y = Math.floor(pixelIndex / w);
            
            // Add neighbors with wrapping support
            const isWrappable = projectionType === 'equirectangular' || projectionType === 'polar';
            
            if (x > 0) {
                stack.push((idx - 4));
            } else if (isWrappable) {
                // Wrap Left -> Right (x=0 -> x=w-1)
                // idx is at x=0. neighbor at x=w-1 is + (w-1)*4
                stack.push(idx + (w - 1) * 4);
            }

            if (x < w - 1) {
                stack.push((idx + 4));
            } else if (isWrappable) {
                // Wrap Right -> Left (x=w-1 -> x=0)
                // idx is at x=w-1. neighbor at x=0 is - (w-1)*4
                stack.push(idx - (w - 1) * 4);
            }
            
            if (y > 0) stack.push((idx - w * 4));
            if (y < h - 1) stack.push((idx + w * 4));
        }
    }
    
    obsCtx.putImageData(obsData, 0, 0);
    renderComposite();
    if (onPaintingComplete) onPaintingComplete();
  }, [renderComposite, onPaintingComplete, saveHistory, projectionType]);

  // Initialize Layers
  useEffect(() => {
    if (!layerGlobalRef.current) {
        layerGlobalRef.current = initCanvas(1024, 1024, 'rgb(128, 128, 0)');
    }
    if (!layerBrushRef.current) {
        layerBrushRef.current = initCanvas(1024, 1024, 'rgba(0,0,0,0)');
    }
    if (!layerObstacleRef.current) {
        layerObstacleRef.current = initCanvas(1024, 1024, 'rgba(0,0,0,0)');
    }
    
    // Save initial empty state
    if (historyRef.current.length === 0) {
        saveHistory();
    }

    // Initial Render
    renderComposite();
  }, [renderComposite, saveHistory]);

  const drawStamp = useCallback((
    targetCanvas: HTMLCanvasElement,
    x: number, 
    y: number, 
    lx: number, 
    ly: number, 
    settings: BrushSettings,
    tool: ActiveTool
  ) => {
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return;

    const dist = Math.hypot(x - lx, y - ly);
    if (dist < 1.0) return;

    let r = 128, g = 128, a = 1.0;
    let compositeOp: GlobalCompositeOperation = 'source-over';

    if (tool === 'obstacle') {
        // Obstacle paints "Neutral Flow" (Static)
        r = 128; g = 128; a = 1.0; 
    } else if (tool === 'obstacle_eraser') {
        // Erase obstacle = clear to transparent
        compositeOp = 'destination-out';
    } else if (tool === 'eraser') {
        // Eraser for brush layer = clear to transparent
        compositeOp = 'destination-out';
    } else if (tool === 'brush') {
        // Normal Flow Brush
        const vx = (x - lx) / dist;
        const vy = (y - ly) / dist;
        const range = 127 * settings.strength;
        r = Math.min(255, Math.max(0, Math.round(128 - vx * range)));
        g = Math.min(255, Math.max(0, Math.round(128 + vy * range)));
    }

    ctx.globalCompositeOperation = compositeOp;

    const radius = settings.size / 2;
    const step = Math.max(1, settings.size * 0.05);
    
    for (let i = 0; i < dist; i += step) {
        const t = i / dist;
        const px = lx + (x - lx) * t;
        const py = ly + (y - ly) * t;
        const innerRadius = radius * Math.max(0, Math.min(0.99, settings.hardness));
        
        const gradient = ctx.createRadialGradient(px, py, innerRadius, px, py, radius);
        
        if (compositeOp === 'destination-out') {
             gradient.addColorStop(0, `rgba(0,0,0,1)`);
             gradient.addColorStop(1, `rgba(0,0,0,0)`);
        } else {
             gradient.addColorStop(0, `rgba(${r}, ${g}, 0, 1)`);
             gradient.addColorStop(1, `rgba(${r}, ${g}, 0, 0)`);
        }
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.globalCompositeOperation = 'source-over';
  }, []);

  const stroke = useCallback((u: number, v: number, lu: number, lv: number) => {
    let targetCanvas: HTMLCanvasElement | null = null;
    
    if (activeTool === 'brush' || activeTool === 'eraser') {
        targetCanvas = layerBrushRef.current;
    } else if (activeTool === 'obstacle' || activeTool === 'obstacle_eraser') {
        targetCanvas = layerObstacleRef.current;
    }
    
    if (!targetCanvas) return;
    
    const w = 1024;
    const h = 1024;
    
    const x = u * w;
    const y = v * h;
    const lx = lu * w;
    const ly = lv * h;

    // Check for wrapping (Equirectangular and Polar wrap on U axis)
    const isWrappable = projectionType === 'equirectangular' || projectionType === 'polar';
    const dx = x - lx;
    const wrapThreshold = w * 0.5;

    if (isWrappable && Math.abs(dx) > wrapThreshold) {
        // Wrapped detected
        if (dx > 0) {
            // Jumped "Left" (e.g. 0.1 -> 0.9, dx > 0.5)
            // Effectively u moved to u - 1.0
            drawStamp(targetCanvas, x - w, y, lx, ly, brushSettings, activeTool);
            // And lu moved to lu + 1.0
            drawStamp(targetCanvas, x, y, lx + w, ly, brushSettings, activeTool);
        } else {
             // Jumped "Right" (e.g. 0.9 -> 0.1, dx < -0.5)
             // Effectively u moved to u + 1.0
             drawStamp(targetCanvas, x + w, y, lx, ly, brushSettings, activeTool);
             // And lu moved to lu - 1.0
             drawStamp(targetCanvas, x, y, lx - w, ly, brushSettings, activeTool);
        }
    } else {
        // Normal Stroke
        drawStamp(targetCanvas, x, y, lx, ly, brushSettings, activeTool);
        
        // Seamless Tiling (Draw ghost if near edge)
        if (isWrappable) {
             const radius = brushSettings.size / 2;
             
             // If painting near Left Edge, draw ghost on Right
             if (x < radius || lx < radius) {
                 drawStamp(targetCanvas, x + w, y, lx + w, ly, brushSettings, activeTool);
             }
             
             // If painting near Right Edge, draw ghost on Left
             if (x > w - radius || lx > w - radius) {
                 drawStamp(targetCanvas, x - w, y, lx - w, ly, brushSettings, activeTool);
             }
        }
    }
    
    renderComposite();
  }, [activeTool, brushSettings, drawStamp, renderComposite, projectionType]);

  useImperativeHandle(ref, () => ({
    stroke,
    floodFill,
    undo,
    redo,
    saveHistory
  }));

  // Track previous triggers to avoid re-running effects on unrelated renders
  const lastWindTrigger = useRef<number | null>(null);
  const lastWindDirection = useRef<number | null>(null);
  const lastProjectionType = useRef<ProjectionType | null>(null);
  const lastPolarAngle = useRef<number | null>(null);

  const lastClearBrushTrigger = useRef(clearBrushTrigger);
  const lastClearGlobalTrigger = useRef(clearGlobalTrigger);
  const lastClearObstacleTrigger = useRef(clearObstacleTrigger);
  const lastResetTrigger = useRef(resetTrigger);

  // Generate Wind Effect (Global Layer)
  useEffect(() => {
    // Check if relevant props actually changed
    const windChanged = 
        windTrigger !== lastWindTrigger.current ||
        windDirection !== lastWindDirection.current ||
        projectionType !== lastProjectionType.current ||
        polarAngle !== lastPolarAngle.current;
    
    // Update refs
    lastWindTrigger.current = windTrigger;
    lastWindDirection.current = windDirection;
    lastProjectionType.current = projectionType;
    lastPolarAngle.current = polarAngle;

    if (!windChanged) return;

    // Generate wind if trigger fires OR wind parameters change
    // But we only need to generate if we have a context
    if (!layerGlobalRef.current) return;
    
    // We only update if it's visible, OR if we just want to keep the layer ready?
    // Better to keep it updated even if hidden, so when toggled on it's correct.
    
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
                    data[index + 3] = 255; // Full opacity for base
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
    // Only call onPaintingComplete if this was a manual trigger, 
    // or maybe we don't need to call it for live updates to avoid spamming history/undo stacks if we had them.
    // But here it just updates version.
    if (onPaintingComplete) onPaintingComplete();
    
  }, [windTrigger, windDirection, renderComposite, onPaintingComplete, projectionType, polarAngle]);

  // Handle Clear Brush Layer
  useEffect(() => {
    if (clearBrushTrigger !== lastClearBrushTrigger.current) {
        lastClearBrushTrigger.current = clearBrushTrigger;
        if (clearBrushTrigger > 0) {
            if (layerBrushRef.current) {
                const ctx = layerBrushRef.current.getContext('2d');
                if (ctx) ctx.clearRect(0,0,1024,1024);
            }
            renderComposite();
            saveHistory();
            if (onPaintingComplete) onPaintingComplete();
        }
    }
  }, [clearBrushTrigger, renderComposite, onPaintingComplete, saveHistory]);

  // Handle Clear Global Layer
  useEffect(() => {
    if (clearGlobalTrigger !== lastClearGlobalTrigger.current) {
        lastClearGlobalTrigger.current = clearGlobalTrigger;
        if (clearGlobalTrigger > 0) {
            if (layerGlobalRef.current) {
                const ctx = layerGlobalRef.current.getContext('2d');
                // Reset to neutral flow (no movement)
                if (ctx) { ctx.fillStyle = 'rgb(128,128,0)'; ctx.fillRect(0,0,1024,1024); }
            }
            renderComposite();
            saveHistory();
            if (onPaintingComplete) onPaintingComplete();
        }
    }
  }, [clearGlobalTrigger, renderComposite, onPaintingComplete, saveHistory]);

  // Handle Clear Obstacle Layer
  useEffect(() => {
    if (clearObstacleTrigger !== lastClearObstacleTrigger.current) {
        lastClearObstacleTrigger.current = clearObstacleTrigger;
        if (clearObstacleTrigger > 0) {
            if (layerObstacleRef.current) {
                const ctx = layerObstacleRef.current.getContext('2d');
                if (ctx) ctx.clearRect(0,0,1024,1024);
            }
            renderComposite();
            saveHistory();
            if (onPaintingComplete) onPaintingComplete();
        }
    }
  }, [clearObstacleTrigger, renderComposite, onPaintingComplete, saveHistory]);

  // Handle Reset (Clear Brush and Obstacle layers, Reset Global to neutral)
  useEffect(() => {
      if (resetTrigger !== lastResetTrigger.current) {
          lastResetTrigger.current = resetTrigger;
          if (resetTrigger > 0) {
              if (layerGlobalRef.current) {
                  const ctx = layerGlobalRef.current.getContext('2d');
                  if (ctx) { ctx.fillStyle = 'rgb(128,128,0)'; ctx.fillRect(0,0,1024,1024); }
              }
              if (layerBrushRef.current) {
                  const ctx = layerBrushRef.current.getContext('2d');
                  if (ctx) ctx.clearRect(0,0,1024,1024);
              }
              if (layerObstacleRef.current) {
                  const ctx = layerObstacleRef.current.getContext('2d');
                  if (ctx) ctx.clearRect(0,0,1024,1024);
              }
              renderComposite();
              saveHistory();
              if (onPaintingComplete) onPaintingComplete();
          }
      }
  }, [resetTrigger, renderComposite, onPaintingComplete, saveHistory]);

  // Handle Blur Amount Change - Re-render
  useEffect(() => {
      renderComposite();
  }, [renderComposite]);

  const getUV = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { u: 0, v: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    const u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top) / rect.height;
    return { u, v };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (isFKeyPressed.current) return; // Skip if resizing brush
    
    // Panning Check (Middle Mouse or Alt+Left)
    let isPanAction = false;
    let isZoomAction = false;
    let clientX, clientY;
    
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        const me = e as React.MouseEvent;
        clientX = me.clientX;
        clientY = me.clientY;
        
        // Ctrl + Middle Click -> Zoom Drag
        if (me.ctrlKey && me.button === 1) {
            isZoomAction = true;
        } 
        // Middle Click OR Alt + Left Click -> Pan
        else if (me.button === 1 || me.altKey) {
            isPanAction = true;
        }
    }

    if (isZoomAction) {
        setIsZooming(true);
        zoomStart.current = { y: clientY, startScale: transform.scale };
        return;
    }

    if (isPanAction) {
        setIsPanning(true);
        panStart.current = { x: clientX - transform.x, y: clientY - transform.y };
        return;
    }

    const { u, v } = getUV(e);
    
    // Update cursor position for preview via direct DOM
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

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isFKeyPressed.current) return; // Skip if resizing brush
    
    let clientX, clientY;
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }

    const { u, v } = getUV(e);

    // Update cursor position for preview via direct DOM for performance
    if (cursorPreviewRef.current && activeTool !== 'magic_wand') {
      if (u < 0 || u > 1 || v < 0 || v > 1) {
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
        const deltaY = clientY - zoomStart.current.y;
        // Drag Down -> Zoom Out, Drag Up -> Zoom In
        // Sensitivity: 0.01 per pixel
        const zoomSensitivity = 0.005;
        const newScale = Math.max(0.1, Math.min(10, zoomStart.current.startScale * (1 - deltaY * zoomSensitivity)));
        
        setTransform(prev => ({
            ...prev,
            scale: newScale
        }));
        return;
    }

    if (isPanning && panStart.current) {
         const startX = panStart.current.x;
         const startY = panStart.current.y;
         setTransform(prev => ({
             ...prev,
             x: clientX - startX,
             y: clientY - startY
         }));
         return;
    }

    if (!isDrawing || !lastPos.current) return;
    stroke(u, v, lastPos.current.x, lastPos.current.y);
    lastPos.current = { x: u, y: v };
  };

  const handlePointerUp = () => {
    if (isFKeyPressed.current) return; // Skip if resizing brush
    
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
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={() => {
            if (isFKeyPressed.current) return;
            handlePointerUp();
            if (cursorPreviewRef.current) cursorPreviewRef.current.style.display = 'none';
          }}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        />
        {/* Brush Cursor Preview */}
        <div 
          ref={cursorPreviewRef}
          className="absolute pointer-events-none border border-white rounded-full bg-white/20 z-30 hidden"
          style={{
            left: '0%',
            top: '0%',
            width: `${(brushSettings.size / 1024) * 100}%`,
            height: `${(brushSettings.size / 1024) * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
        {bgImageUrl && showReference && (
          <img 
            src={bgImageUrl} 
            alt="Guide" 
            className="absolute inset-0 w-full h-full object-fill opacity-20 pointer-events-none select-none z-10"
          />
        )}
      </div>
      <div className="absolute top-2 left-2 bg-black/60 text-xs px-2 py-1 rounded pointer-events-none text-white/70 z-20">
        Tool: {activeTool.toUpperCase().replace('_', ' ')} | Zoom: {Math.round(transform.scale * 100)}%
      </div>
    </div>
  );
});

export default FlowPainter;