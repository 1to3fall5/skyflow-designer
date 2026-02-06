import React, { useState, useCallback, useEffect, useRef } from 'react';
import { 
  Palette, 
  Wind, 
  Download, 
  Image as ImageIcon, 
  Eraser, 
  Eye,
  EyeOff,
  Compass,
  Droplets,
  Globe,
  Columns,
  Layers,
  ArrowRightLeft,
  Wand2,
  Trash2,
  RefreshCw,
  Pencil,
  Plus,
  Minus,
  Shield,
  ShieldOff,
  ArrowUp,
  ArrowDown,
  GripVertical
} from 'lucide-react';
import FlowPainter from './components/FlowPainter';
import PreviewScene from './components/PreviewScene';
import { BrushSettings, ViewMode, ActiveTool, FlowPainterHandle, ProjectionType, Layer } from './types';

  import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';

const SortableLayerItem = ({ 
    layer, 
    activeLayerId, 
    setActiveLayerId, 
    updateLayer, 
    removeLayer 
}: {
    layer: Layer,
    activeLayerId: string,
    setActiveLayerId: (id: string) => void,
    updateLayer: (id: string, updates: Partial<Layer>) => void,
    removeLayer: (id: string) => void
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: layer.id });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 1,
        opacity: isDragging ? 0.5 : 1
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            className={`group rounded-xl border transition-colors duration-200 mb-2 ${
                activeLayerId === layer.id 
                ? 'p-3 bg-[#212124] border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.15)] ring-1 ring-indigo-500/30' 
                : 'px-3 py-2 bg-[#1f1f23] border-[#2d2d33] hover:border-[#3d3d45]'
            }`}
            onClick={() => setActiveLayerId(layer.id)}
        >
            <div className="flex items-center gap-3">
                <div 
                    {...attributes} 
                    {...listeners}
                    className="text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing"
                >
                    <GripVertical className="w-4 h-4" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-200 truncate select-none">{layer.name}</div>
                </div>

                <div className="flex items-center gap-1">
                    <button
                    onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { isObstacle: !layer.isObstacle }); }}
                    className={`p-1.5 rounded-md transition-colors ${layer.isObstacle ? 'bg-rose-500/20 text-rose-400' : 'text-slate-600 hover:text-slate-400 hover:bg-[#2d2d33]'}`}
                    title={layer.isObstacle ? "障碍物图层 (点击切换)" : "设为障碍物 (点击切换)"}
                    >
                        {layer.isObstacle ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                    </button>

                    <button
                    onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                    className={`p-1.5 rounded-md transition-colors ${layer.visible ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-400'}`}
                    title={layer.visible ? "隐藏图层" : "显示图层"}
                    >
                        {layer.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                </div>
            </div>
            
            {/* Layer Settings (Blur) */}
            <div className={`space-y-2 overflow-hidden transition-all duration-200 ${activeLayerId === layer.id ? 'mt-3 max-h-20 opacity-100' : 'mt-0 max-h-0 opacity-0'}`}>
            <div className="h-px bg-[#2d2d33] w-full"></div>
            <div className="flex items-center gap-3 pt-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">模糊</span>
                <input 
                    type="range" min="0" max="32"
                    value={layer.blur}
                    onChange={(e) => updateLayer(layer.id, { blur: Number(e.target.value) })}
                    className="flex-1 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    onPointerDown={(e) => e.stopPropagation()} // Prevent drag start on slider
                />
                <span className="text-[10px] font-mono text-indigo-400 w-6 text-right">{layer.blur}</span>
            </div>
            </div>
        </div>
    );
};

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
  const [globalLayerVisible, setGlobalLayerVisible] = useState(true);

  // Layer System State
  const [layers, setLayers] = useState<Layer[]>([
    { id: 'layer-1', name: 'Layer 1', visible: true, isObstacle: false, blur: 0, opacity: 1 }
  ]);
  const [activeLayerId, setActiveLayerId] = useState('layer-1');

  // Magic Wand Settings
  const [magicWandThreshold, setMagicWandThreshold] = useState(20);
  const [showMaskOverlay, setShowMaskOverlay] = useState(false);
  
  // Versioning to force texture updates when canvas ref doesn't change but content does
  const [flowVersion, setFlowVersion] = useState(0);

  // Export Settings
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

  const handleRegenerateGlobal = () => {
      setWindTrigger(prev => prev + 1);
  };

  const handleClearGlobal = () => {
      // We use resetTrigger for global clear in FlowPainter for now, or we can assume clearing Global Layer
      // is just resetting it to neutral. FlowPainter handles this via windTrigger if we reset params?
      // Actually, FlowPainter had a clearGlobalTrigger. I removed it.
      // But we can use `windTrigger` to regenerate.
      // Or we can add a specific clear function.
      // For now, let's just regenerate which effectively clears/resets the base wind.
      setWindTrigger(prev => prev + 1);
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
        activationConstraint: {
            distance: 5, // Require slight movement to start drag
        },
    }),
    useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const {active, over} = event;
    
    if (over && active.id !== over.id) {
      setLayers((items) => {
          // items is in Render Order (Bottom -> Top)
          // We need to simulate the reordering on the REVERSED list (Visual Order: Top -> Bottom)
          const visualList = [...items].reverse();
          
          const oldIndex = visualList.findIndex(item => item.id === active.id);
          const newIndex = visualList.findIndex(item => item.id === over.id);
          
          const newVisualList = arrayMove(visualList, oldIndex, newIndex);
          
          // Reverse back to get Render Order
          return newVisualList.reverse();
      });
    }
  };

  // Handlers
  const handleTextureUpdate = useCallback((canvas: HTMLCanvasElement) => {
    setFlowCanvas(prev => prev === canvas ? prev : canvas); 
    setFlowVersion(v => v + 1);
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
        
        for (let i = 0; i < data.length; i += 4) {
            if (invertX) data[i] = 255 - data[i];     // R (U)
            if (invertY) data[i + 1] = 255 - data[i + 1]; // G (V)
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

  // Layer Management
  const addLayer = () => {
      const newId = `layer-${Date.now()}`;
      const newLayer: Layer = {
          id: newId,
          name: `Layer ${layers.length + 1}`,
          visible: true,
          isObstacle: false,
          blur: 0,
          opacity: 1
      };
      setLayers(prev => [...prev, newLayer]);
      // setActiveLayerId(newId); // Don't auto-activate new layers
  };

  const removeLayer = (id: string) => {
      if (layers.length <= 1) return; // Prevent deleting last layer
      const newLayers = layers.filter(l => l.id !== id);
      setLayers(newLayers);
      if (activeLayerId === id) {
          setActiveLayerId(newLayers[newLayers.length - 1].id);
      }
      // Also clear content in FlowPainter
      flowPainterRef.current?.clearLayer(id);
  };

  const updateLayer = (id: string, updates: Partial<Layer>) => {
      setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
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

      if (isRightMouseDown.current) return;

      const key = e.key.toLowerCase();

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          flowPainterRef.current?.redo();
        } else {
          flowPainterRef.current?.undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
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

  const Switch = ({ checked, onChange, color = 'bg-indigo-600' }: { checked: boolean, onChange: (val: boolean) => void, color?: string }) => (
     <button 
       onClick={() => onChange(!checked)}
       className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 focus:outline-none hover:brightness-110 active:scale-95 ${checked ? color : 'bg-[#2d2d33]'}`}
     >
       <span 
         className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ease-in-out ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} 
       />
     </button>
   );

  return (
    <div 
      ref={containerRef}
      tabIndex={0}
      className="flex flex-col h-screen bg-[#0f0f12] text-slate-100 outline-none font-sans"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#16161a] border-b border-[#252529] z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Wind className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white">
            SkyFlow <span className="text-indigo-400">Designer</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-[#1f1f23] rounded-lg p-1 border border-[#2d2d33]">
             <button 
              onClick={() => setViewMode('2d')}
              className={`p-2 rounded-md transition-all ${viewMode === '2d' ? 'bg-[#2d2d33] text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-[#252529]'}`}
              title="仅 2D 绘制"
            >
              <Palette className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('split')}
              className={`p-2 rounded-md transition-all ${viewMode === 'split' ? 'bg-[#2d2d33] text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-[#252529]'}`}
              title="分屏视图"
            >
              <Columns className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('3d')}
              className={`p-2 rounded-md transition-all ${viewMode === '3d' ? 'bg-[#2d2d33] text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-[#252529]'}`}
              title="仅 3D 预览"
            >
              <Globe className="w-4 h-4" />
            </button>
          </div>
          
          <div className="h-6 w-px bg-[#2d2d33] mx-1"></div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 bg-[#1f1f23] px-3 py-1.5 rounded-lg border border-[#2d2d33]">
              <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">导出:</span>
              <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer hover:text-white transition-colors">
                <input 
                  type="checkbox" 
                  checked={invertX}
                  onChange={(e) => setInvertX(e.target.checked)}
                  className="w-3.5 h-3.5 rounded bg-[#2d2d33] border-[#3d3d45] text-indigo-500 focus:ring-indigo-500 focus:ring-offset-[#16161a]"
                />
                <span title="反转红色通道 (X轴)">R</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer hover:text-white transition-colors">
                <input 
                  type="checkbox" 
                  checked={invertY}
                  onChange={(e) => setInvertY(e.target.checked)}
                  className="w-3.5 h-3.5 rounded bg-[#2d2d33] border-[#3d3d45] text-indigo-500 focus:ring-indigo-500 focus:ring-offset-[#16161a]"
                />
                <span title="反转绿色通道 (Y轴)">G</span>
              </label>
            </div>

            <button 
              onClick={handleExport}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
            >
              <Download className="w-4 h-4" />
              导出
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar Controls */}
        <aside className="w-[320px] bg-[#18181b] border-r border-[#252529] overflow-y-auto p-5 flex flex-col gap-6 z-10 custom-scrollbar">
          
          {/* Section: Texture Generation */}
          <section className="space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 relative pl-3">
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3.5 bg-indigo-500 rounded-full"></span>
              1. 图片源
            </h2>
            
            <div className="relative group">
              <input 
                  type="file" 
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="w-full aspect-[16/9] bg-[#212124] hover:bg-[#252529] text-slate-400 rounded-xl border-2 border-dashed border-[#323238] group-hover:border-indigo-500/50 transition-all flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 bg-[#2d2d33] rounded-lg flex items-center justify-center group-hover:bg-indigo-500/10 transition-colors">
                    <ImageIcon className="w-5 h-5 text-slate-500 group-hover:text-indigo-400" />
                </div>
                <div className="text-center">
                    <p className="text-xs font-medium text-slate-300">点击 / 拖拽 / <span className="bg-[#2d2d33] px-1 rounded text-[10px]">Ctrl+V</span></p>
                    <p className="text-[10px] text-slate-500 mt-1">上传图片 (支持 PNG/TGA)</p>
                </div>
              </div>
            </div>

            {/* Projection Toggle */}
            <div className="bg-[#1f1f23] p-1.5 rounded-xl border border-[#2d2d33] space-y-3">
               <div className="flex p-1 gap-1">
                   <button 
                    onClick={() => setProjectionType('equirectangular')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${projectionType === 'equirectangular' ? 'bg-[#2d2d33] text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                   >
                     <Globe className="w-3.5 h-3.5" /> 球面
                   </button>
                   <button 
                    onClick={() => setProjectionType('polar')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${projectionType === 'polar' ? 'bg-[#2d2d33] text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                   >
                     <div className="w-3.5 h-3.5 rounded-full border-2 border-current"></div> 极坐标
                   </button>
                   <button 
                    onClick={() => setProjectionType('planar')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${projectionType === 'planar' ? 'bg-[#2d2d33] text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                   >
                     <div className="w-3.5 h-3.5 border-2 border-current"></div> 平面
                   </button>
               </div>
               
               {projectionType === 'polar' && (
                   <div className="px-3 pb-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">地平线角度</span>
                        <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">{polarAngle}°</span>
                      </div>
                      <input 
                        type="range" min="45" max="180" 
                        value={polarAngle}
                        onChange={(e) => setPolarAngle(Number(e.target.value))}
                        className="w-full h-1 bg-[#2d2d33] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                   </div>
               )}
            </div>
          </section>

          {/* Section: Layer 1 - Global Flow */}
          <section className="flex flex-col">
             <div className="flex items-center justify-between relative pl-3">
               <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3.5 bg-indigo-500 rounded-full"></span>
               <h2 className="text-sm font-bold text-white flex items-center gap-2">
                2. 全局风向 (背景)
               </h2>
               <div className="flex items-center gap-2">
                   <Switch 
                     checked={globalLayerVisible}
                     onChange={setGlobalLayerVisible}
                   />
               </div>
             </div>
            <div className={`transition-all duration-300 overflow-hidden ${globalLayerVisible ? 'max-h-[500px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
              <div className="space-y-4 p-4 bg-[#212124] rounded-xl border border-[#2d2d33]">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">方向角度</span>
                    <span className="text-xs font-mono text-indigo-400">{windDirection}°</span>
                  </div>
                  <input 
                    type="range" min="0" max="360"
                    value={windDirection}
                    onChange={(e) => setWindDirection(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Section: Layers Panel */}
          <section className="flex flex-col flex-1 min-h-0">
             <div className="flex items-center justify-between relative pl-3 mb-4">
               <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3.5 bg-indigo-500 rounded-full"></span>
               <h2 className="text-sm font-bold text-white flex items-center gap-2">
                3. 图层管理
               </h2>
               <div className="flex items-center gap-1">
                   <button 
                       onClick={() => removeLayer(activeLayerId)}
                       className="p-1.5 bg-[#2d2d33] text-slate-400 hover:text-white hover:bg-rose-600 rounded-md transition-all"
                       title="删除当前图层"
                   >
                       <Minus className="w-3.5 h-3.5" />
                   </button>
                   <button 
                       onClick={addLayer}
                       className="p-1.5 bg-[#2d2d33] text-indigo-400 hover:text-white hover:bg-indigo-600 rounded-md transition-all"
                       title="新建图层"
                   >
                       <Plus className="w-3.5 h-3.5" />
                   </button>
               </div>
             </div>
             
             <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                 {/* Dnd Context for Layer Reordering */}
                 <DndContext 
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                 >
                    {/* 
                        We need to provide the list in the visual order (Top to Bottom).
                        Our `layers` state is Bottom to Top (Render Order).
                        So we reverse it for the UI.
                        
                        Wait, if we just reverse in the map, dnd-kit might get confused if we don't sync the indices.
                        Actually, dnd-kit relies on IDs.
                        
                        BUT: If we use `arrayMove` on the original `layers` array based on IDs,
                        and the UI displays `layers.slice().reverse()`,
                        
                        Example:
                        Layers (Render Order): [A, B, C]  (C is Top)
                        UI (Visual Order): [C, B, A]
                        
                        User drags C to below B.
                        Target Visual Order: [B, C, A]
                        Target Render Order: [A, C, B]
                        
                        If I use dnd-kit on the `layers` array directly (Render Order),
                        I should probably just render them in that order in the UI but using flex-col-reverse?
                        No, that messes up scrolling sometimes.
                        
                        Let's just use a derived variable for the SortableContext items.
                        We will sort the ACTUAL `layers` array (Render Order) but Display them Reversed?
                        No, Drag and Drop expects the DOM order to match the items order.
                        
                        So, we MUST pass the REVERSED array to SortableContext.
                        And in onDragEnd, we take the result (which is a reordered Reversed array),
                        and Reverse it BACK to get the new Render Order.
                    */}
                    <SortableContext 
                        items={[...layers].reverse()}
                        strategy={verticalListSortingStrategy}
                    >
                        {[...layers].reverse().map((layer) => (
                            <SortableLayerItem 
                                key={layer.id} 
                                layer={layer}
                                activeLayerId={activeLayerId}
                                setActiveLayerId={setActiveLayerId}
                                updateLayer={updateLayer}
                                removeLayer={removeLayer}
                            />
                        ))}
                    </SortableContext>
                 </DndContext>
             </div>
          </section>

          {/* Section: Tool Settings */}
          <section className="flex flex-col mt-4">
             <div className="flex items-center justify-between relative pl-3 mb-4">
               <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3.5 bg-indigo-500 rounded-full"></span>
               <h2 className="text-sm font-bold text-white flex items-center gap-2">
                4. 工具设置
               </h2>
             </div>

             <div className="space-y-4 p-4 bg-[#212124] rounded-xl border border-[#2d2d33]">
                <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        setActiveTool('brush');
                        setBrushSettings(prev => ({ ...prev, isEraser: false }));
                      }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTool === 'brush' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-[#323238] text-slate-400 hover:text-slate-200 border border-[#3d3d45]'}`}
                    >
                      <Pencil className="w-3.5 h-3.5" /> 画笔
                    </button>
                    <button 
                      onClick={() => {
                        setActiveTool('eraser');
                        setBrushSettings(prev => ({ ...prev, isEraser: true }));
                      }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTool === 'eraser' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-[#323238] text-slate-400 hover:text-slate-200 border border-[#3d3d45]'}`}
                    >
                      <Eraser className="w-3.5 h-3.5" /> 擦除
                    </button>
                    <button 
                      onClick={() => setActiveTool('magic_wand')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTool === 'magic_wand' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-[#323238] text-slate-400 hover:text-slate-200 border border-[#3d3d45]'}`}
                    >
                      <Wand2 className="w-3.5 h-3.5" /> 选取
                    </button>
                  </div>

                  {activeTool !== 'magic_wand' ? (
                      <div className="space-y-4">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">画笔大小</span>
                            <span className="text-xs font-mono text-indigo-400">{brushSettings.size.toFixed(0)}px</span>
                            </div>
                            <input 
                            type="range" min="1" max="200"
                            value={brushSettings.size}
                            onChange={(e) => setBrushSettings(prev => ({ ...prev, size: Number(e.target.value) }))}
                            className="w-full h-1.5 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">流动强度</span>
                            <span className="text-xs font-mono text-indigo-400">{(brushSettings.strength * 100).toFixed(0)}%</span>
                            </div>
                            <input 
                            type="range" min="0" max="1" step="0.01"
                            value={brushSettings.strength}
                            onChange={(e) => setBrushSettings(prev => ({ ...prev, strength: Number(e.target.value) }))}
                            className="w-full h-1.5 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                        </div>
                      </div>
                  ) : (
                      <div className="space-y-4">
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">选取阈值</span>
                            <span className="text-xs font-mono text-indigo-400">{magicWandThreshold}</span>
                          </div>
                          <input 
                            type="range" min="1" max="100"
                            value={magicWandThreshold}
                            onChange={(e) => setMagicWandThreshold(Number(e.target.value))}
                            className="w-full h-1.5 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          />
                        </div>

                        <div className="flex items-center justify-between bg-[#2d2d33]/30 p-2.5 rounded-lg border border-[#323238]">
                          <span className="text-xs font-medium text-slate-300">显示遮罩预览</span>
                          <Switch 
                            checked={showMaskOverlay}
                            onChange={setShowMaskOverlay}
                            color="bg-rose-500"
                          />
                        </div>
                      </div>
                  )}
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
              bgImageUrl={skyTextureUrl} 
              showReference={showReference}
              onTextureUpdate={handleTextureUpdate}
              windDirection={windDirection}
              windTrigger={windTrigger}
              resetTrigger={resetTrigger}
              
              layers={layers}
              activeLayerId={activeLayerId}
              globalLayerVisible={globalLayerVisible}

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
               <div className="flex bg-[#18181b]/80 backdrop-blur-md p-2 rounded-xl border border-[#2d2d33] shadow-xl h-12 items-center">
                <button 
                    onClick={() => setShowArrows(!showArrows)}
                    className={`p-2 rounded-lg transition-colors ${showArrows ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-[#252529]'}`}
                    title={showArrows ? '隐藏箭头' : '显示箭头'}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
                <div className="w-px h-6 bg-[#2d2d33] mx-2"></div>
                <button 
                    onClick={() => setShowFlowMap(!showFlowMap)}
                    className={`p-2 rounded-lg transition-colors ${showFlowMap ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-[#252529]'}`}
                    title={showFlowMap ? '隐藏流动贴图' : '显示流动贴图'}
                >
                  <Layers className="w-4 h-4" />
                </button>
               </div>

               {/* Preview Settings Sliders */}
               <div className="flex flex-row items-center bg-[#18181b]/80 backdrop-blur-md p-2 rounded-xl border border-[#2d2d33] shadow-2xl transition-all duration-300 h-12">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider whitespace-nowrap">动画速度</span>
                        <input 
                        type="range" min="0" max="2" step="0.05"
                        value={previewSpeed}
                        onChange={(e) => setPreviewSpeed(Number(e.target.value))}
                        className="w-24 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <span className="text-[10px] text-indigo-400 font-mono min-w-[3ch] text-right">{previewSpeed.toFixed(2)}</span>
                    </div>
                    
                    <div className="w-px h-4 bg-[#2d2d33]"></div>
                    
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider whitespace-nowrap">扭曲程度</span>
                        <input 
                        type="range" min="0" max="0.5" step="0.01"
                        value={previewDistortion}
                        onChange={(e) => setPreviewDistortion(Number(e.target.value))}
                        className="w-24 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <span className="text-[10px] text-indigo-400 font-mono min-w-[3ch] text-right">{previewDistortion.toFixed(2)}</span>
                    </div>

                    <div className="w-px h-4 bg-[#2d2d33]"></div>

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider whitespace-nowrap">箭头密度</span>
                        <input 
                        type="range" min="16" max="128" step="4"
                        value={arrowDensity}
                        onChange={(e) => setArrowDensity(Number(e.target.value))}
                        className="w-24 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <span className="text-[10px] text-indigo-400 font-mono min-w-[3ch] text-right">{arrowDensity}</span>
                    </div>
                  </div>
               </div>
            </div>

            {/* Controls Help Overlay */}
            <div className="absolute top-4 left-4 z-10 bg-[#18181b]/80 backdrop-blur-sm p-4 rounded-xl border border-[#2d2d33] shadow-xl text-xs text-slate-300 pointer-events-none select-none">
              <div className="space-y-4">
                <div>
                  <strong className="text-slate-400 block mb-2 uppercase tracking-wider text-[10px] font-bold">快捷键</strong>
                  <ul className="space-y-1.5 text-slate-400">
                    <li className="flex items-center justify-between gap-6"><span>画笔模式</span> <span className="text-indigo-400 font-bold bg-[#323238] px-1.5 py-0.5 rounded text-[10px]">B</span></li>
                    <li className="flex items-center justify-between gap-6"><span>橡皮擦</span> <span className="text-rose-400 font-bold bg-[#323238] px-1.5 py-0.5 rounded text-[10px]">E</span></li>
                    <li className="flex items-center justify-between gap-6"><span>显示箭头</span> <span className="text-indigo-400 font-bold bg-[#323238] px-1.5 py-0.5 rounded text-[10px]">V</span></li>
                    <li className="flex items-center justify-between gap-6 pt-1.5 border-t border-[#2d2d33] mt-1.5"><span>2D视图</span> <span className="text-slate-300 font-bold bg-[#323238] px-1.5 py-0.5 rounded text-[10px]">1</span></li>
                    <li className="flex items-center justify-between gap-6"><span>分屏视图</span> <span className="text-slate-300 font-bold bg-[#323238] px-1.5 py-0.5 rounded text-[10px]">2</span></li>
                    <li className="flex items-center justify-between gap-6"><span>3D视图</span> <span className="text-slate-300 font-bold bg-[#323238] px-1.5 py-0.5 rounded text-[10px]">3</span></li>
                  </ul>
                </div>
                <div className="h-px bg-[#2d2d33]"></div>
                <div>
                  <strong className="text-slate-400 block mb-2 uppercase tracking-wider text-[10px] font-bold">鼠标操作</strong>
                  <ul className="space-y-1.5 text-slate-400">
                    <li className="flex items-center justify-between gap-6"><span>绘制</span> <span className="text-slate-300">左键拖拽</span></li>
                    <li className="flex items-center justify-between gap-6"><span>旋转视图</span> <span className="text-slate-300">中键拖拽</span></li>
                    <li className="flex items-center justify-between gap-6"><span>缩放</span> <span className="text-slate-300">滚轮</span></li>
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
