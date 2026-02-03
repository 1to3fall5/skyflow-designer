import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { BrushSettings, ActiveTool, FlowPainterHandle, ProjectionType } from '../types';

interface FlowPainterProps {
  brushSettings: BrushSettings;
  activeTool: ActiveTool;
  bgImageUrl: string | null;
  onTextureUpdate: (canvas: HTMLCanvasElement) => void;
  windDirection?: number;
  windTrigger?: number;
  resetTrigger?: number;
  blurAmount?: number;
  className?: string;
  onPaintingComplete?: () => void;
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
  blurAmount = 0,
  className,
  onPaintingComplete,
  projectionType = 'equirectangular',
  polarAngle = 90
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rasterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const seamlessHelperRef = useRef<HTMLCanvasElement | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // --- Rendering Pipeline ---
  
  const renderComposite = useCallback(() => {
    const mainCanvas = canvasRef.current;
    const rasterCanvas = rasterCanvasRef.current;
    if (!mainCanvas || !rasterCanvas) return;

    const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.globalCompositeOperation = 'copy'; // Ensure we replace content
    
    if (blurAmount > 0) {
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
            hCtx.drawImage(rasterCanvas, padding, padding);
            
            // Edges (Left, Right, Top, Bottom)
            hCtx.drawImage(rasterCanvas, padding - size, padding); 
            hCtx.drawImage(rasterCanvas, padding + size, padding); 
            hCtx.drawImage(rasterCanvas, padding, padding - size); 
            hCtx.drawImage(rasterCanvas, padding, padding + size); 
            
            // Corners 
            hCtx.drawImage(rasterCanvas, padding - size, padding - size);
            hCtx.drawImage(rasterCanvas, padding + size, padding - size);
            hCtx.drawImage(rasterCanvas, padding - size, padding + size);
            hCtx.drawImage(rasterCanvas, padding + size, padding + size);
            
            ctx.save();
            ctx.filter = `blur(${blurAmount}px)`;
            ctx.drawImage(helper, -padding, -padding);
            ctx.restore();
        }
    } else {
        ctx.drawImage(rasterCanvas, 0, 0);
    }
    
    ctx.globalCompositeOperation = 'source-over'; // Reset
    onTextureUpdate(mainCanvas);
  }, [onTextureUpdate, blurAmount]);

  // Initialize Raster Canvas
  useEffect(() => {
    if (!rasterCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = 1024;
        c.height = 1024;
        const ctx = c.getContext('2d');
        if (ctx) {
            // Fill with neutral flow (no movement)
            ctx.fillStyle = 'rgb(128, 128, 0)';
            ctx.fillRect(0, 0, 1024, 1024);
        }
        rasterCanvasRef.current = c;
        // Trigger initial render
        setTimeout(() => renderComposite(), 100);
    }
  }, [renderComposite]);

  const drawStamp = useCallback((
    ctx: CanvasRenderingContext2D, 
    x: number, 
    y: number, 
    lx: number, 
    ly: number, 
    settings: BrushSettings
  ) => {
    const dist = Math.hypot(x - lx, y - ly);
    if (dist < 1.0) return;

    let r, g;

    if (settings.isEraser) {
      r = 128;
      g = 128;
    } else {
      const vx = (x - lx) / dist;
      const vy = (y - ly) / dist;
      const range = 127 * settings.strength;
      
      r = Math.min(255, Math.max(0, Math.round(128 - vx * range)));
      g = Math.min(255, Math.max(0, Math.round(128 + vy * range)));
    }

    const radius = settings.size / 2;
    const step = Math.max(1, settings.size * 0.05);
    
    for (let i = 0; i < dist; i += step) {
        const t = i / dist;
        const px = lx + (x - lx) * t;
        const py = ly + (y - ly) * t;
        const innerRadius = radius * Math.max(0, Math.min(0.99, settings.hardness));
        
        const gradient = ctx.createRadialGradient(px, py, innerRadius, px, py, radius);
        gradient.addColorStop(0, `rgba(${r}, ${g}, 0, 1)`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, 0, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
    }
  }, []);

  const stroke = useCallback((u: number, v: number, lu: number, lv: number) => {
    const ctx = rasterCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    const w = 1024;
    const h = 1024;
    
    const x = u * w;
    const y = v * h;
    const lx = lu * w;
    const ly = lv * h;
    
    drawStamp(ctx, x, y, lx, ly, brushSettings);
    renderComposite();
  }, [brushSettings, drawStamp, renderComposite]);

  useImperativeHandle(ref, () => ({
    stroke
  }));

  // Generate Wind Effect
  useEffect(() => {
    if (windTrigger > 0 && rasterCanvasRef.current) {
        const ctx = rasterCanvasRef.current.getContext('2d');
        if (!ctx) return;

        const width = 1024;
        const height = 1024;
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        const polarRad = (polarAngle * Math.PI) / 180;
        const windRad = (windDirection * Math.PI) / 180;
        
        // Wind vector (World Space, Y-up)
        const Wx = Math.sin(windRad);
        const Wy = 0;
        const Wz = Math.cos(windRad);
        
        // Use a noticeable step and strength
        const step = 0.05; 
        const strength = 15.0; 

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                
                const u = (x + 0.5) / width;
                const v = 1.0 - ((y + 0.5) / height); 

                let valid = true;
                let nx = 0, ny = 0, nz = 0;

                // 1. Map UV to 3D Point
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
                    data[index + 3] = 0;
                    continue;
                }

                // 2. Advect
                nx = px + Wx * step;
                ny = py + Wy * step;
                nz = pz + Wz * step;
                const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                nx /= len; ny /= len; nz /= len;

                // 3. Map Back to UV
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
                
                // Encode
                const r = Math.floor(Math.max(0, Math.min(255, 128 + (-du * strength * 127))));
                const g = Math.floor(Math.max(0, Math.min(255, 128 + (-dv * strength * 127))));

                data[index] = r;
                data[index + 1] = g;
                data[index + 2] = 0;
                data[index + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        renderComposite();
        if (onPaintingComplete) onPaintingComplete();
    }
  }, [windTrigger, windDirection, renderComposite, onPaintingComplete, projectionType, polarAngle]);

  // Handle Reset
  useEffect(() => {
      if (resetTrigger > 0 && rasterCanvasRef.current) {
          const ctx = rasterCanvasRef.current.getContext('2d');
          if (ctx) {
            ctx.fillStyle = 'rgb(128, 128, 0)';
            ctx.fillRect(0, 0, 1024, 1024);
            renderComposite();
            if (onPaintingComplete) onPaintingComplete();
          }
      }
  }, [resetTrigger, renderComposite, onPaintingComplete]);

  // Handle Blur Amount Change
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
    const { u, v } = getUV(e);
    setIsDrawing(true);
    stroke(u, v, u, v);
    lastPos.current = { x: u, y: v };
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !lastPos.current) return;
    const { u, v } = getUV(e);
    stroke(u, v, lastPos.current.x, lastPos.current.y);
    lastPos.current = { x: u, y: v };
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    lastPos.current = null;
    if (onPaintingComplete) onPaintingComplete();
  };

  return (
    <div className={`relative w-full h-full bg-neutral-900 overflow-hidden flex items-center justify-center ${className}`}>
      <div className="relative shadow-2xl max-w-full max-h-full aspect-square">
        <canvas
          ref={canvasRef}
          width={1024}
          height={1024}
          className={`block max-w-full max-h-full touch-none z-0 cursor-crosshair`}
          style={{ width: 'auto', height: 'auto', imageRendering: 'pixelated' }}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        />
        
        {bgImageUrl && (
          <img 
            src={bgImageUrl} 
            alt="Guide" 
            className="absolute inset-0 w-full h-full object-fill opacity-20 pointer-events-none select-none z-10"
          />
        )}
      </div>
      
      <div className="absolute top-2 left-2 bg-black/60 text-xs px-2 py-1 rounded pointer-events-none text-white/70 z-20">
        Tool: {activeTool.toUpperCase()} 
      </div>
    </div>
  );
});

export default FlowPainter;