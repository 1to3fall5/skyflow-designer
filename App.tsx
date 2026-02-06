import React, { useState, useCallback, useEffect, useRef } from 'react';
import { 
  Palette, 
  Wind, 
  Download, 
  Image as ImageIcon, 
  Eraser, 
  Eye,
  Compass,
  Droplets,
  Globe,
  Columns,
  Layers,
  ArrowRightLeft,
  Wand2,
  Trash2,
  RefreshCw
} from 'lucide-react';
import FlowPainter from './components/FlowPainter';
import PreviewScene from './components/PreviewScene';
import { BrushSettings, ViewMode, ActiveTool, FlowPainterHandle, ProjectionType } from './types';

const App: React.FC = () => {
  // State
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 20,
    strength: 0.5,
    hardness: 0.8,
    isEraser: false,
  });
  
  const [activeTool, setActiveTool] = useState<ActiveTool>('brush');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [showArrows, setShowArrows] = useState(true); 
  const [showFlowMap, setShowFlowMap] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [projectionType, setProjectionType] = useState<ProjectionType>('equirectangular');
  const [polarAngle, setPolarAngle] = useState(90);
  
  // Global Wind / Flow Ops State
  const [windDirection, setWindDirection] = useState(45); // Default 45 to show movement
  const [windTrigger, setWindTrigger] = useState(0);
  const [resetTrigger, setResetTrigger] = useState(0);

  // Triggers for clearing layers
  const [clearBrushTrigger, setClearBrushTrigger] = useState(0);
  const [clearGlobalTrigger, setClearGlobalTrigger] = useState(0);
  const [clearObstacleTrigger, setClearObstacleTrigger] = useState(0);
  
  // Layer Settings
  const [globalBlur, setGlobalBlur] = useState(0);
  const [obstacleBlur, setObstacleBlur] = useState(0);
  const [brushBlur, setBrushBlur] = useState(0);
  
  // Layer Visibility
  const [globalLayerVisible, setGlobalLayerVisible] = useState(true);
  const [obstacleLayerVisible, setObstacleLayerVisible] = useState(true);
  const [brushLayerVisible, setBrushLayerVisible] = useState(true);
  
  // Magic Wand Settings
  const [magicWandThreshold, setMagicWandThreshold] = useState(20);
  const [showMaskOverlay, setShowMaskOverlay] = useState(false);
  
  // Versioning to force texture updates when canvas ref doesn't change but content does
  const [flowVersion, setFlowVersion] = useState(0);

  // Export Settings
  // Based on user feedback: "invertX=true" was 180 degrees off.
  // Current state (-x, y) rotated 180 deg is (x, -y).
  // So we default to invertX=false, invertY=true.
  const [invertX, setInvertX] = useState(false);
  const [invertY, setInvertY] = useState(true);

  const [skyTextureUrl, setSkyTextureUrl] = useState<string | null>(null);
  const [flowCanvas, setFlowCanvas] = useState<HTMLCanvasElement | null>(null);
  const [previewSpeed, setPreviewSpeed] = useState(0.2);
  const [previewDistortion, setPreviewDistortion] = useState(0.1);
  const [arrowDensity, setArrowDensity] = useState(48);
  

  const containerRef = useRef<HTMLDivElement>(null);
  const flowPainterRef = useRef<FlowPainterHandle>(null);
  const isRightMouseDown = useRef(false);

  const handleClearBrush = () => {
      setClearBrushTrigger(prev => prev + 1);
  };

  const handleClearGlobal = () => {
      setClearGlobalTrigger(prev => prev + 1);
  };

  const handleRegenerateGlobal = () => {
      setWindTrigger(prev => prev + 1);
  };

  const handleClearObstacle = () => {
      setClearObstacleTrigger(prev => prev + 1);
  };

  // Callback when FlowPainter finishes expensive operations like Wind or Reset
  const handlePaintingComplete = useCallback(() => {
      setFlowVersion(prev => prev + 1);
  }, []);

  // Bridge for 3D painting to use the FlowPainter logic
  const handle3DPaint = useCallback((u: number, v: number, lu: number, lv: number) => {
    if (flowPainterRef.current) {
      if (activeTool === 'magic_wand') {
         flowPainterRef.current.floodFill(u, v, magicWandThreshold);
      } else {
         flowPainterRef.current.stroke(u, v, lu, lv);
      }
    }
  }, [activeTool, magicWandThreshold]);

  const handle3DPaintEnd = useCallback(() => {
    if (flowPainterRef.current) {
        flowPainterRef.current.saveHistory();
    }
  }, []);

  // Handlers
  const handleTextureUpdate = useCallback((canvas: HTMLCanvasElement) => {
    setFlowCanvas(canvas); 
  }, []);

  const handleExport = () => {
    if (!flowCanvas) return;
    
    // Create a temporary canvas for export processing
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = flowCanvas.width;
    exportCanvas.height = flowCanvas.height;
    const ctx = exportCanvas.getContext('2d');
    
    if (!ctx) {
        alert("无法创建导出画布");
        return;
    }

    // Draw the current flow map
    ctx.drawImage(flowCanvas, 0, 0);

    if (invertX || invertY) {
        const imageData = ctx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
        const data = imageData.data;
        
        // Invert channels based on settings
        // 0 -> 255, 255 -> 0, 128 -> 127
        for (let i = 0; i < data.length; i += 4) {
            if (invertX) data[i] = 255 - data[i];     // R (U)
            if (invertY) data[i + 1] = 255 - data[i + 1]; // G (V)
            // B and A remain untouched
        }
        
        ctx.putImageData(imageData, 0, 0);
    }

    const link = document.createElement('a');
    link.download = `flowmap_x${invertX?'inv':''}_y${invertY?'inv':''}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setSkyTextureUrl(url);
    }
  };

  // Focus container on mount
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
        if (e.button === 2) isRightMouseDown.current = true;
    };
    const handleMouseUp = (e: MouseEvent) => {
        if (e.button === 2) isRightMouseDown.current = false;
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // If right mouse button is held (e.g. for camera movement), ignore tool shortcuts
      if (isRightMouseDown.current) return;

      const key = e.key.toLowerCase();

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        console.log('[App] Undo/Redo triggered');
        if (e.shiftKey) {
          flowPainterRef.current?.redo();
        } else {
          flowPainterRef.current?.undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        console.log('[App] Redo triggered (Ctrl+Y)');
        flowPainterRef.current?.redo();
        return;
      }

      switch (key) {
        case '1':
            setViewMode('2d');
            break;
        case '2':
            setViewMode('split');
            break;
        case '3':
            setViewMode('3d');
            break;
        case 'b': // Brush
          setActiveTool('brush');
          setBrushSettings(prev => ({ ...prev, isEraser: false }));
          break;
        case 'e': // Eraser
          setActiveTool('eraser');
          setBrushSettings(prev => ({ ...prev, isEraser: true }));
          break;
        case 'v': // Toggle Arrows
          setShowArrows(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeTool]);

  return (
    <div 
      ref={containerRef}
      tabIndex={0}
      className="flex flex-col h-screen bg-slate-900 text-slate-100 outline-none"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700 shadow-lg z-10">
        <div className="flex items-center gap-3">
          <Wind className="w-6 h-6 text-sky-400" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
            SkyFlow 设计器
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-700 rounded-lg p-1">
             <button 
              onClick={() => setViewMode('2d')}
              className={`p-2 rounded ${viewMode === '2d' ? 'bg-slate-600 shadow' : 'hover:bg-slate-600/50'}`}
              title="仅 2D 绘制"
            >
              <Palette className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('split')}
              className={`p-2 rounded ${viewMode === 'split' ? 'bg-slate-600 shadow' : 'hover:bg-slate-600/50'}`}
              title="分屏视图"
            >
              <Columns className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('3d')}
              className={`p-2 rounded ${viewMode === '3d' ? 'bg-slate-600 shadow' : 'hover:bg-slate-600/50'}`}
              title="仅 3D 预览"
            >
              <Globe className="w-4 h-4" />
            </button>
          </div>
          
          <div className="h-6 w-px bg-slate-700 mx-2"></div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-slate-700/50 px-3 py-1.5 rounded-lg border border-slate-600">
              <span className="text-xs text-slate-400 font-medium">导出设置:</span>
              <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer hover:text-white transition-colors">
                <input 
                  type="checkbox" 
                  checked={invertX}
                  onChange={(e) => setInvertX(e.target.checked)}
                  className="w-3.5 h-3.5 rounded bg-slate-600 border-slate-500 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800"
                />
                <span title="反转红色通道 (X轴)">反转X</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer hover:text-white transition-colors">
                <input 
                  type="checkbox" 
                  checked={invertY}
                  onChange={(e) => setInvertY(e.target.checked)}
                  className="w-3.5 h-3.5 rounded bg-slate-600 border-slate-500 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800"
                />
                <span title="反转绿色通道 (Y轴)">反转Y</span>
              </label>
            </div>

            <button 
              onClick={handleExport}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20"
            >
              <Download className="w-4 h-4" />
              导出贴图
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar Controls */}
        <aside className="w-80 bg-slate-800 border-r border-slate-700 overflow-y-auto p-4 flex flex-col gap-6 z-10 shadow-xl">
          
          {/* Section: Texture Generation */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> 天空贴图
            </h2>
            
            <div className="relative">
              <input 
                  type="file" 
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 py-3 rounded-lg border border-slate-600 text-center transition-colors flex flex-col items-center justify-center gap-1">
                <span className="text-sm font-medium text-sky-400">选择图片文件</span>
                <span className="text-xs text-slate-500">支持 JPG, PNG</span>
              </div>
            </div>

            {/* Projection Toggle */}
            <div className="bg-slate-900/50 p-2 rounded-lg border border-slate-700 space-y-3">
               <div className="flex text-xs font-medium">
                   <button 
                    onClick={() => setProjectionType('equirectangular')}
                    className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 transition-all ${projectionType === 'equirectangular' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                   >
                     <Globe className="w-3 h-3" /> 球面
                   </button>
                   <button 
                    onClick={() => setProjectionType('polar')}
                    className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 transition-all ${projectionType === 'polar' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                   >
                     <div className="w-3 h-3 rounded-full border-2 border-current"></div> 极坐标
                   </button>
                   <button 
                    onClick={() => setProjectionType('planar')}
                    className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 transition-all ${projectionType === 'planar' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                   >
                     <div className="w-3 h-3 border border-current"></div> 平面
                   </button>
               </div>
               
               {projectionType === 'polar' && (
                   <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>地平线角度</span>
                        <span>{polarAngle}°</span>
                      </div>
                      <input 
                        type="range" min="45" max="180" 
                        value={polarAngle}
                        onChange={(e) => setPolarAngle(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        title="调整极坐标贴图覆盖球面的范围。90° = 半球，180° = 全球。"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 px-0.5">
                          <span>半球</span>
                          <span>全球</span>
                      </div>
                   </div>
               )}
            </div>
          </section>

          <hr className="border-slate-700" />
          
          {/* Section: Layer 1 - Global Flow */}
          <section className="space-y-3">
             <div className="flex items-center justify-between">
               <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Compass className="w-4 h-4" /> 全局方向
               </h2>
               <div className="flex items-center gap-2">
                   <button 
                       onClick={handleRegenerateGlobal}
                       className="text-slate-500 hover:text-indigo-500 transition-colors"
                       title="重新生成全局方向"
                   >
                       <RefreshCw className="w-4 h-4" />
                   </button>
                   <button 
                       onClick={handleClearGlobal}
                       className="text-slate-500 hover:text-rose-500 transition-colors"
                       title="重置全局方向层"
                   >
                       <Trash2 className="w-4 h-4" />
                   </button>
                   <button 
                     onClick={() => setGlobalLayerVisible(!globalLayerVisible)}
                     className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${globalLayerVisible ? 'bg-indigo-600' : 'bg-slate-700'}`}
                     title={globalLayerVisible ? "隐藏图层" : "显示图层"}
                   >
                     <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${globalLayerVisible ? 'translate-x-5' : 'translate-x-1'}`} />
                   </button>
               </div>
             </div>
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${globalLayerVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="space-y-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>方向角度</span>
                  <span>{windDirection}°</span>
                </div>
                <div className="flex gap-2 items-center">
                    <input 
                      type="range" min="0" max="360"
                      value={windDirection}
                      onChange={(e) => setWindDirection(Number(e.target.value))}
                      className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-teal-500"
                    />
                </div>
                
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1"><Droplets className="w-3 h-3" /> 全局模糊</span>
                      <span>{globalBlur}px</span>
                    </div>
                    <input 
                      type="range" min="0" max="32"
                      value={globalBlur}
                      onChange={(e) => setGlobalBlur(Number(e.target.value))}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                </div>
              </div>
            </div>
          </div>
          </section>

          <hr className="border-slate-700" />

          {/* Section: Layer 2 - Obstacles */}
          <section className="space-y-3">
             <div className="flex items-center justify-between">
               <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Eraser className="w-4 h-4" /> 障碍物 (遮罩)
               </h2>
               <div className="flex items-center gap-2">
                   <button 
                       onClick={handleClearObstacle}
                       className="text-slate-500 hover:text-rose-500 transition-colors"
                       title="清空障碍物层"
                   >
                       <Trash2 className="w-4 h-4" />
                   </button>
                   <button 
                     onClick={() => setObstacleLayerVisible(!obstacleLayerVisible)}
                     className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${obstacleLayerVisible ? 'bg-indigo-600' : 'bg-slate-700'}`}
                     title={obstacleLayerVisible ? "隐藏图层" : "显示图层"}
                   >
                     <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${obstacleLayerVisible ? 'translate-x-5' : 'translate-x-1'}`} />
                   </button>
               </div>
             </div>
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${obstacleLayerVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="space-y-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setActiveTool('obstacle');
                      setBrushSettings(p => ({ ...p, isEraser: false }));
                    }}
                    className={`flex-1 py-2 text-sm rounded-md border flex items-center justify-center gap-2 ${activeTool === 'obstacle' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                  >
                     绘制障碍
                  </button>
                  <button
                    onClick={() => {
                      setActiveTool('obstacle_eraser');
                      setBrushSettings(p => ({ ...p, isEraser: true }));
                    }}
                    className={`flex-1 py-2 text-sm rounded-md border flex items-center justify-center gap-2 ${activeTool === 'obstacle_eraser' ? 'bg-amber-800 border-amber-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                  >
                     擦除障碍
                  </button>
                  <button
                    onClick={() => {
                      setActiveTool('magic_wand');
                      setBrushSettings(p => ({ ...p, isEraser: false }));
                    }}
                    className={`flex-1 py-2 text-sm rounded-md border flex items-center justify-center gap-2 ${activeTool === 'magic_wand' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                    title="魔棒工具 (快速选择障碍物)"
                  >
                     <Wand2 className="w-3 h-3" />
                  </button>
                </div>

                {activeTool === 'magic_wand' && (
                  <div className="space-y-2 pt-1 border-t border-slate-700/50">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>魔棒容差</span>
                      <span>{magicWandThreshold}</span>
                    </div>
                    <input 
                      type="range" min="0" max="100"
                      value={magicWandThreshold}
                      onChange={(e) => setMagicWandThreshold(Number(e.target.value))}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                   <span className="text-xs text-slate-400">显示红色遮罩</span>
                   <button 
                     onClick={() => {
                       console.log('[App] Toggling Red Mask to:', !showMaskOverlay);
                       setShowMaskOverlay(!showMaskOverlay);
                     }}
                     className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${showMaskOverlay ? 'bg-red-600' : 'bg-slate-700'}`}
                   >
                     <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform ${showMaskOverlay ? 'translate-x-4' : 'translate-x-1'}`} />
                   </button>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1"><Droplets className="w-3 h-3" /> 障碍物边缘模糊</span>
                      <span>{obstacleBlur}px</span>
                    </div>
                    <input 
                      type="range" min="0" max="32"
                      value={obstacleBlur}
                      onChange={(e) => setObstacleBlur(Number(e.target.value))}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                </div>
              </div>
            </div>
          </div>
          </section>

          <hr className="border-slate-700" />
          
          {/* Section: Layer 3 - Free Brush (Moved to Top) */}
          <section className="space-y-3">
             <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Palette className="w-4 h-4" /> 自由笔刷
                </h2>
                <div className="flex items-center gap-2">
                     <button 
                         onClick={handleClearBrush}
                         className="text-slate-500 hover:text-rose-500 transition-colors"
                         title="清空自由笔刷层"
                     >
                         <Trash2 className="w-4 h-4" />
                     </button>
                     <button 
                         onClick={() => setBrushLayerVisible(!brushLayerVisible)}
                         className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${brushLayerVisible ? 'bg-indigo-600' : 'bg-slate-700'}`}
                         title={brushLayerVisible ? "隐藏图层" : "显示图层"}
                     >
                         <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${brushLayerVisible ? 'translate-x-5' : 'translate-x-1'}`} />
                     </button>
                </div>
             </div>
            
            {brushLayerVisible && (
            <div className="space-y-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setActiveTool('brush');
                      setBrushSettings(p => ({ ...p, isEraser: false }));
                    }}
                    className={`flex-1 py-2 text-sm rounded-md border ${activeTool === 'brush' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                    title="Shortcut: B"
                  >
                    画笔 <span className="text-xs opacity-50 ml-1">(B)</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveTool('eraser');
                      setBrushSettings(p => ({ ...p, isEraser: true }));
                    }}
                    className={`flex-1 py-2 text-sm rounded-md border flex items-center justify-center gap-2 ${activeTool === 'eraser' ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                    title="Shortcut: E"
                  >
                    <Eraser className="w-3 h-3" /> <span className="text-xs opacity-50 ml-1">(E)</span>
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>画笔大小</span>
                      <span>{brushSettings.size}px</span>
                    </div>
                    <input 
                      type="range" min="1" max="100" 
                      value={brushSettings.size}
                      onChange={(e) => setBrushSettings({...brushSettings, size: Number(e.target.value)})}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>硬度</span>
                      <span>{Math.round(brushSettings.hardness * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.05"
                      value={brushSettings.hardness}
                      onChange={(e) => setBrushSettings({...brushSettings, hardness: Number(e.target.value)})}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>流动强度</span>
                      <span>{Math.round(brushSettings.strength * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0.1" max="1" step="0.1"
                      value={brushSettings.strength}
                      onChange={(e) => setBrushSettings({...brushSettings, strength: Number(e.target.value)})}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                   <div className="space-y-2 pt-2 border-t border-slate-700/50">
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span className="flex items-center gap-1"><Droplets className="w-3 h-3" /> 笔刷层模糊</span>
                          <span>{brushBlur}px</span>
                        </div>
                        <input 
                          type="range" min="0" max="32"
                          value={brushBlur}
                          onChange={(e) => setBrushBlur(Number(e.target.value))}
                          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                    </div>
                </div>
            </div>
            )}
          </section>
        </aside>

        {/* Main Canvas Area */}
        <div className="flex-1 relative bg-neutral-950 flex overflow-hidden">
          {/* 2D View */}
          <div 
            className={`
              relative transition-all duration-300 ease-in-out border-r border-slate-800
              ${viewMode === '2d' ? 'w-full' : viewMode === '3d' ? 'w-0 hidden' : 'w-1/2'}
            `}
          >
            <FlowPainter 
              ref={flowPainterRef}
              activeTool={activeTool}
              brushSettings={brushSettings} 
              bgImageUrl={skyTextureUrl} 
              showReference={showReference}
              onTextureUpdate={handleTextureUpdate}
              windDirection={windDirection}
              windTrigger={windTrigger}
              clearBrushTrigger={clearBrushTrigger}
              clearGlobalTrigger={clearGlobalTrigger}
              clearObstacleTrigger={clearObstacleTrigger}
              globalBlur={globalBlur}
              obstacleBlur={obstacleBlur}
              brushBlur={brushBlur}
              globalLayerVisible={globalLayerVisible}
              obstacleLayerVisible={obstacleLayerVisible}
              brushLayerVisible={brushLayerVisible}
              magicWandThreshold={magicWandThreshold}
              showMaskOverlay={showMaskOverlay}
              onPaintingComplete={handlePaintingComplete}
              onSetBrushSize={(size) => setBrushSettings(prev => ({ ...prev, size }))}
              projectionType={projectionType}
              polarAngle={polarAngle}
            />
          </div>

          {/* 3D View */}
          <div 
            className={`
              relative transition-all duration-300 ease-in-out
              ${viewMode === '3d' ? 'w-full' : viewMode === '2d' ? 'w-0 hidden' : 'w-1/2'}
            `}
          >
            {/* 3D Toolbar Overlay */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 flex flex-row items-center gap-3">
               {/* Buttons */}
               <div className="flex bg-slate-900/60 backdrop-blur-md p-2 rounded-xl border border-white/10 shadow-xl h-12 items-center">
                <button 
                    onClick={() => setShowArrows(!showArrows)}
                    className={`p-2 rounded-lg transition-colors ${showArrows ? 'bg-indigo-500/80 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
                    title={showArrows ? '隐藏箭头' : '显示箭头'}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
                <div className="w-px h-6 bg-white/10 mx-2"></div>
                <button 
                    onClick={() => setShowFlowMap(!showFlowMap)}
                    className={`p-2 rounded-lg transition-colors ${showFlowMap ? 'bg-indigo-500/80 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
                    title={showFlowMap ? '隐藏流动贴图' : '显示流动贴图'}
                >
                  <Layers className="w-4 h-4" />
                </button>
               </div>

               {/* Preview Settings Sliders */}
               <div className="flex flex-row items-center bg-slate-900/60 backdrop-blur-md p-2 rounded-xl border border-white/10 shadow-2xl transition-all duration-300 h-12">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-300 font-medium uppercase tracking-wider whitespace-nowrap">动画速度</span>
                        <input 
                        type="range" min="0" max="2" step="0.05"
                        value={previewSpeed}
                        onChange={(e) => setPreviewSpeed(Number(e.target.value))}
                        className="w-24 h-1 bg-slate-700/50 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-colors"
                        />
                        <span className="text-[10px] text-indigo-300 font-mono min-w-[3ch] text-right">{previewSpeed.toFixed(2)}</span>
                    </div>
                    
                    <div className="w-px h-4 bg-white/10"></div>
                    
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-300 font-medium uppercase tracking-wider whitespace-nowrap">扭曲程度</span>
                        <input 
                        type="range" min="0" max="0.5" step="0.01"
                        value={previewDistortion}
                        onChange={(e) => setPreviewDistortion(Number(e.target.value))}
                        className="w-24 h-1 bg-slate-700/50 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-colors"
                        />
                        <span className="text-[10px] text-indigo-300 font-mono min-w-[3ch] text-right">{previewDistortion.toFixed(2)}</span>
                    </div>

                    <div className="w-px h-4 bg-white/10"></div>

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-300 font-medium uppercase tracking-wider whitespace-nowrap">箭头密度</span>
                        <input 
                        type="range" min="16" max="128" step="4"
                        value={arrowDensity}
                        onChange={(e) => setArrowDensity(Number(e.target.value))}
                        className="w-24 h-1 bg-slate-700/50 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-colors"
                        />
                        <span className="text-[10px] text-indigo-300 font-mono min-w-[3ch] text-right">{arrowDensity}</span>
                    </div>
                  </div>
               </div>
            </div>

            {/* Controls Help Overlay */}
            <div className="absolute top-4 left-4 z-10 bg-slate-800/60 backdrop-blur-sm p-3 rounded-lg border border-slate-700/50 shadow-xl text-xs text-slate-300 pointer-events-none select-none">
              <div className="space-y-3">
                <div>
                  <strong className="text-slate-400 block mb-1">快捷键</strong>
                  <ul className="space-y-1 text-slate-400">
                    <li className="flex items-center justify-between gap-4"><span>画笔模式</span> <span className="text-sky-400 font-bold bg-slate-700/50 px-1.5 rounded">B</span></li>
                    <li className="flex items-center justify-between gap-4"><span>橡皮擦</span> <span className="text-rose-400 font-bold bg-slate-700/50 px-1.5 rounded">E</span></li>
                    <li className="flex items-center justify-between gap-4"><span>显示箭头</span> <span className="text-indigo-400 font-bold bg-slate-700/50 px-1.5 rounded">V</span></li>
                    <li className="flex items-center justify-between gap-4 pt-1 border-t border-slate-700/30 mt-1"><span>2D视图</span> <span className="text-slate-200 font-bold bg-slate-700/50 px-1.5 rounded">1</span></li>
                    <li className="flex items-center justify-between gap-4"><span>分屏视图</span> <span className="text-slate-200 font-bold bg-slate-700/50 px-1.5 rounded">2</span></li>
                    <li className="flex items-center justify-between gap-4"><span>3D视图</span> <span className="text-slate-200 font-bold bg-slate-700/50 px-1.5 rounded">3</span></li>
                  </ul>
                </div>
                <div className="h-px bg-slate-700/50"></div>
                <div>
                  <strong className="text-slate-400 block mb-1">鼠标操作</strong>
                  <ul className="space-y-1 text-slate-400">
                    <li className="flex items-center justify-between gap-4"><span>绘制</span> <span className="text-slate-200">左键拖拽</span></li>
                    <li className="flex items-center justify-between gap-4"><span>旋转视图</span> <span className="text-slate-200">中键拖拽</span></li>
                    <li className="flex items-center justify-between gap-4"><span>缩放</span> <span className="text-slate-200">滚轮</span></li>
                  </ul>
                </div>
              </div>
            </div>

            <PreviewScene 
              skyTextureUrl={skyTextureUrl}
              flowCanvas={flowCanvas}
              speed={previewSpeed}
              distortion={previewDistortion}
              brushSettings={brushSettings}
              isPaintMode={showArrows}
              activeTool={activeTool}
              flowVersion={flowVersion}
              onPaint={handle3DPaint}
              onPaintEnd={handle3DPaintEnd}
              projectionType={projectionType}
              polarAngle={polarAngle}
              arrowDensity={arrowDensity}
          showFlowMap={showFlowMap}
          onSetBrushSize={(size) => setBrushSettings(prev => ({ ...prev, size }))}
        />
      </div>
        </div>
      </main>
    </div>
  );
};

export default App;