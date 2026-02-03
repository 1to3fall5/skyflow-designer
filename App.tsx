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
  ArrowRightLeft
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
  const [blurAmount, setBlurAmount] = useState(0);
  
  // Versioning to force texture updates when canvas ref doesn't change but content does
  const [flowVersion, setFlowVersion] = useState(0);

  // Export Settings
  const [invertExport, setInvertExport] = useState(false);

  const [skyTextureUrl, setSkyTextureUrl] = useState<string | null>(null);
  const [flowCanvas, setFlowCanvas] = useState<HTMLCanvasElement | null>(null);
  const [previewSpeed, setPreviewSpeed] = useState(0.2);
  const [previewDistortion, setPreviewDistortion] = useState(0.1);
  

  const containerRef = useRef<HTMLDivElement>(null);
  const flowPainterRef = useRef<FlowPainterHandle>(null);

  const handleApplyWind = () => {
      if (confirm("这将覆盖您当前绘制的流动。是否继续？")) {
          setWindTrigger(prev => prev + 1);
      }
  };

  const handleResetCanvas = () => {
      if (confirm("清空绘制的流动层？")) {
          setResetTrigger(prev => prev + 1);
      }
  };

  // Callback when FlowPainter finishes expensive operations like Wind or Reset
  const handlePaintingComplete = useCallback(() => {
      setFlowVersion(prev => prev + 1);
  }, []);

  // Bridge for 3D painting to use the FlowPainter logic
  const handle3DPaint = useCallback((u: number, v: number, lu: number, lv: number) => {
    if (flowPainterRef.current) {
      flowPainterRef.current.stroke(u, v, lu, lv);
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

    if (invertExport) {
        const imageData = ctx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
        const data = imageData.data;
        
        // Invert R and G channels (Flow vectors)
        // 0 -> 255, 255 -> 0, 128 -> 127
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];     // R (U)
            data[i + 1] = 255 - data[i + 1]; // G (V)
            // B and A remain untouched
        }
        
        ctx.putImageData(imageData, 0, 0);
    }

    const link = document.createElement('a');
    link.download = invertExport ? 'flowmap_inverted.png' : 'flowmap.png';
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
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();

      switch (key) {
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
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

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:text-white transition-colors">
              <input 
                type="checkbox" 
                checked={invertExport}
                onChange={(e) => setInvertExport(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
              />
              <span title="反转流动方向（R 和 G 通道），用于需要相反向量的引擎">反转</span>
            </label>
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
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
          
          {/* Section: Global Flow Operations */}
          <section className="space-y-3">
             <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Compass className="w-4 h-4" /> 流动操作
            </h2>
            <div className="space-y-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>全局方向</span>
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
                
                <button 
                    onClick={handleApplyWind}
                    className="w-full bg-teal-700 hover:bg-teal-600 text-teal-100 py-2 rounded text-xs font-medium transition-colors mb-2"
                >
                    应用全局风向
                </button>

                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1"><Droplets className="w-3 h-3" /> 全局模糊（非破坏性）</span>
                      <span>{blurAmount}px</span>
                    </div>
                    <input 
                      type="range" min="0" max="32"
                      value={blurAmount}
                      onChange={(e) => setBlurAmount(Number(e.target.value))}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                </div>

                <div className="pt-2">
                    <button 
                        onClick={handleResetCanvas}
                        className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 py-1.5 rounded text-xs font-medium transition-colors"
                    >
                        清空贴图
                    </button>
                </div>
            </div>
          </section>

          <hr className="border-slate-700" />

          {/* Section: Paint Tools */}
          <section className="space-y-4">
             <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Palette className="w-4 h-4" /> 绘制工具
                </h2>
             </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">参考图叠加</span>
              <button 
                onClick={() => setShowReference(!showReference)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showReference ? 'bg-indigo-600' : 'bg-slate-700'}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${showReference ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>

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
            </div>
          </section>

          <hr className="border-slate-700" />

          {/* Section: Preview Settings */}
          <section className="space-y-4">
             <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Eye className="w-4 h-4" /> 预览设置
            </h2>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>动画速度</span>
                  <span>{previewSpeed.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0" max="2" step="0.05"
                  value={previewSpeed}
                  onChange={(e) => setPreviewSpeed(Number(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>扭曲程度</span>
                  <span>{previewDistortion.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0" max="0.5" step="0.01"
                  value={previewDistortion}
                  onChange={(e) => setPreviewDistortion(Number(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
              </div>

            </div>
            
            <div className="bg-slate-900/50 p-3 rounded text-xs text-slate-400 leading-relaxed border border-slate-700">
              <strong className="text-slate-300">快捷键：</strong>
              <ul className="mt-1 space-y-1">
                <li><span className="text-sky-400 font-bold">B</span> - 画笔模式</li>
                <li><span className="text-sky-400 font-bold">E</span> - 橡皮擦模式</li>
                <li><span className="text-sky-400 font-bold">V</span> - 切换箭头显示</li>
              </ul>
            </div>
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
              bgImageUrl={showReference ? skyTextureUrl : null} 
              onTextureUpdate={handleTextureUpdate}
              windDirection={windDirection}
              windTrigger={windTrigger}
              resetTrigger={resetTrigger}
              blurAmount={blurAmount}
              onPaintingComplete={handlePaintingComplete}
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
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-2">
               <div className="flex bg-slate-800/90 backdrop-blur rounded-full p-1 border border-slate-700 shadow-xl">
                <button 
                    onClick={() => setShowArrows(!showArrows)}
                    className={`p-2 rounded-full transition-colors ${showArrows ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                    title={showArrows ? '隐藏箭头' : '显示箭头'}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
                <div className="w-px bg-slate-700 my-1 mx-1"></div>
                <button 
                    onClick={() => setShowFlowMap(!showFlowMap)}
                    className={`p-2 rounded-full transition-colors ${showFlowMap ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                    title={showFlowMap ? '隐藏流动贴图' : '显示流动贴图'}
                >
                  <Layers className="w-4 h-4" />
                </button>
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
              projectionType={projectionType}
              polarAngle={polarAngle}
              showFlowMap={showFlowMap}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;