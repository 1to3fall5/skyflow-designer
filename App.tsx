  import React, { useState, useCallback, useEffect, useRef } from 'react';
  import { 
    Palette, 
    Wind, 
    Download, 
    Image as ImageIcon, 
    Eraser, 
    Eye,
    EyeOff,
    Globe,
    Columns,
    Layers,
    Wand2,
    Pencil,
    Plus,
    Minus,
    GripVertical,
    Play,
    Move,
    HelpCircle,
    Shield,
    ChevronDown,
    Paintbrush
  } from 'lucide-react';
  import FlowPainter from './components/FlowPainter';
  import PreviewScene from './components/PreviewScene';
  import { 
    BrushSettings, ViewMode, ActiveTool, FlowPainterHandle, ProjectionType, 
    Layer, PaintLayer, WindLayer, ObstacleLayer,
    isPaintLayer, isWindLayer, isObstacleLayer, isAdjustmentLayer,
    EditTarget
  } from './types';

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

  // Layer type colors and icons
  const LAYER_TYPE_CONFIG = {
    paint: { color: 'emerald', icon: Paintbrush, label: '流向' },
    wind: { color: 'violet', icon: Wind, label: '风向' },
    obstacle: { color: 'rose', icon: Shield, label: '障碍物' },
  } as const;

  const SortableLayerItem = ({ 
      layer, 
      activeLayerId, 
      editTarget,
      setActiveLayerId,
      setEditTarget,
      updateLayer, 
      removeLayer 
  }: {
      layer: Layer,
      activeLayerId: string,
      editTarget: EditTarget,
      setActiveLayerId: (id: string) => void,
      setEditTarget: (target: EditTarget) => void,
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

      const isActive = activeLayerId === layer.id;
      const config = LAYER_TYPE_CONFIG[layer.type];
      const IconComponent = config.icon;
      const isAdj = isAdjustmentLayer(layer);

      const colorClasses: Record<string, { bg: string, text: string, border: string, ring: string, badge: string }> = {
          emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500', ring: 'ring-emerald-500/30', badge: 'bg-emerald-500/20' },
          violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500', ring: 'ring-violet-500/30', badge: 'bg-violet-500/20' },
          rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500', ring: 'ring-rose-500/30', badge: 'bg-rose-500/20' },
          sky: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500', ring: 'ring-sky-500/30', badge: 'bg-sky-500/20' },
      };
      const cc = colorClasses[config.color];

      return (
          <div 
              ref={setNodeRef} 
              style={style} 
              className={`group rounded-xl border transition-colors duration-200 mb-1.5 ${
                  isActive 
                  ? `p-3 bg-[#212124] ${cc.border} shadow-[0_0_15px_rgba(99,102,241,0.1)] ring-1 ${cc.ring}` 
                  : `px-3 py-2 bg-[#1f1f23] border-[#2d2d33] hover:border-[#3d3d45] ${isAdj ? 'border-dashed' : ''}`
              }`}
              onClick={() => { 
                  setActiveLayerId(layer.id);
                  if (isPaintLayer(layer)) setEditTarget('content');
              }}
          >
              <div className="flex items-center gap-2">
                  <div 
                      {...attributes} 
                      {...listeners}
                      className="text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing"
                  >
                      <GripVertical className="w-3.5 h-3.5" />
                  </div>

                  {/* Type badge */}
                  <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${cc.badge}`}>
                      <IconComponent className={`w-3 h-3 ${cc.text}`} />
                      <span className={`text-[9px] font-bold uppercase ${cc.text}`}>{config.label}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-slate-300 truncate select-none">{layer.name}</div>
                  </div>

                  <div className="flex items-center gap-1">
                      {/* Mask edit toggle for adjustment layers */}
                      {isAdj && isActive && (
                          <div className="flex bg-[#2a2a30] rounded-md p-0.5 mr-1">
                              <button
                                  onClick={(e) => { e.stopPropagation(); setEditTarget('content'); }}
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${editTarget === 'content' ? `${cc.badge} ${cc.text}` : 'text-slate-500 hover:text-slate-400'}`}
                                  title="编辑参数"
                              >
                                  参数
                              </button>
                              <button
                                  onClick={(e) => { 
                                      e.stopPropagation(); 
                                      setEditTarget('mask'); 
                                      updateLayer(layer.id, { hasMask: true } as any);
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${editTarget === 'mask' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-400'}`}
                                  title="编辑遮罩"
                              >
                                  遮罩
                              </button>
                          </div>
                      )}

                      <button
                          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                          className={`p-1 rounded-md transition-colors ${layer.visible ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-400'}`}
                      >
                          {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                  </div>
              </div>
          </div>
      );
  };

  // Properties panel for all layer types
  const PropertiesPanel = ({ 
      layer, 
      updateLayer 
  }: { 
      layer: Layer, 
      updateLayer: (id: string, updates: Partial<Layer>) => void 
  }) => {
      const config = LAYER_TYPE_CONFIG[layer.type];

      return (
          <div className="bg-[#1a1a1f] rounded-xl border border-[#2d2d33] p-4 space-y-3">
              <div className="flex items-center gap-2">
                  <config.icon className={`w-4 h-4 ${
                      layer.type === 'paint' ? 'text-emerald-400' :
                      layer.type === 'wind' ? 'text-violet-400' : 'text-rose-400'
                  }`} />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{config.label} 属性</span>
              </div>

              {/* Wind-specific */}
              {isWindLayer(layer) && (
                  <>
                      <div className="flex items-center gap-3">
                          <span className="text-[10px] text-slate-500 font-bold uppercase w-10">方向</span>
                          <input type="range" min="0" max="360" value={layer.direction}
                              onChange={(e) => updateLayer(layer.id, { direction: Number(e.target.value) } as Partial<WindLayer>)}
                              className="flex-1 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-violet-500"
                              onPointerDown={(e) => e.stopPropagation()} />
                          <span className="text-[10px] font-mono text-violet-400 w-8 text-right">{layer.direction}°</span>
                      </div>
                      <div className="flex items-center gap-3">
                          <span className="text-[10px] text-slate-500 font-bold uppercase w-10">强度</span>
                          <input type="range" min="0" max="1" step="0.01" value={layer.strength}
                              onChange={(e) => updateLayer(layer.id, { strength: Number(e.target.value) } as Partial<WindLayer>)}
                              className="flex-1 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-violet-500"
                              onPointerDown={(e) => e.stopPropagation()} />
                          <span className="text-[10px] font-mono text-violet-400 w-8 text-right">{Math.round(layer.strength * 100)}%</span>
                      </div>
                  </>
              )}

              {/* Obstacle-specific */}
              {isObstacleLayer(layer) && (
                  <>
                      <div className="flex items-center gap-3">
                          <span className="text-[10px] text-slate-500 font-bold uppercase w-10">扰动</span>
                          <button onClick={() => updateLayer(layer.id, { disturbanceEnabled: !layer.disturbanceEnabled } as Partial<ObstacleLayer>)}
                              className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${
                                  layer.disturbanceEnabled ? 'bg-rose-500/20 text-rose-400' : 'bg-[#2d2d33] text-slate-500'
                              }`}>
                              {layer.disturbanceEnabled ? '已启用' : '已关闭'}
                          </button>
                      </div>
                      {layer.disturbanceEnabled && (
                          <div className="flex items-center gap-3">
                              <span className="text-[10px] text-slate-500 font-bold uppercase w-10">范围</span>
                              <input type="range" min="0" max="1" step="0.05" value={layer.disturbance}
                                  onChange={(e) => updateLayer(layer.id, { disturbance: Number(e.target.value) } as Partial<ObstacleLayer>)}
                                  className="flex-1 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-rose-500"
                                  onPointerDown={(e) => e.stopPropagation()} />
                              <span className="text-[10px] font-mono text-rose-400 w-8 text-right">{Math.round(layer.disturbance * 100)}%</span>
                          </div>
                      )}
                  </>
              )}

              {/* Common properties: blur + opacity */}
              <div className="space-y-2 pt-1 border-t border-[#2d2d33]">
                  <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 font-bold uppercase w-10">模糊</span>
                      <input type="range" min="0" max="64" value={layer.blur}
                          onChange={(e) => updateLayer(layer.id, { blur: Number(e.target.value) })}
                          className="flex-1 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          onPointerDown={(e) => e.stopPropagation()} />
                      <span className="text-[10px] font-mono text-indigo-400 w-8 text-right">{layer.blur}</span>
                  </div>
                  <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 font-bold uppercase w-10">透明度</span>
                      <input type="range" min="0" max="1" step="0.01" value={layer.opacity}
                          onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) })}
                          className="flex-1 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          onPointerDown={(e) => e.stopPropagation()} />
                      <span className="text-[10px] font-mono text-indigo-400 w-8 text-right">{Math.round(layer.opacity * 100)}%</span>
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
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [showReference, setShowReference] = useState(false);
    const [referenceOpacity, setReferenceOpacity] = useState(0.2);
    const [projectionType, setProjectionType] = useState<ProjectionType>('equirectangular');
    const [polarAngle, setPolarAngle] = useState(90);

    // Layer System - New unified model
    const [layers, setLayers] = useState<Layer[]>([
      { id: 'wind-default', name: '全局风向', type: 'wind', visible: true, opacity: 1, blur: 0, direction: 45, strength: 0.5, hasMask: false } as WindLayer,
      { id: 'layer-1', name: '流向 1', type: 'paint', visible: true, opacity: 1, blur: 0 } as PaintLayer,
    ]);
    const [activeLayerId, setActiveLayerId] = useState('layer-1');
    const [editTarget, setEditTarget] = useState<EditTarget>('content');

    // Shared Cursor State
    const [sharedCursorUV, setSharedCursorUV] = useState<{u: number, v: number} | null>(null);

    // Magic Wand Settings
    const [magicWandThreshold, setMagicWandThreshold] = useState(20);
    
    // Versioning
    const [flowVersion, setFlowVersion] = useState(0);

    // Export Settings
    const [invertX, setInvertX] = useState(false);
    const [invertY, setInvertY] = useState(true);

    const [skyTextureUrl, setSkyTextureUrl] = useState<string | null>(null);
    const [flowCanvas, setFlowCanvas] = useState<HTMLCanvasElement | null>(null);
    const [previewSpeed, setPreviewSpeed] = useState(0.2);
    const [previewDistortion, setPreviewDistortion] = useState(0.1);
    const [arrowDensity, setArrowDensity] = useState(48);
    const [isAnimating, setIsAnimating] = useState(true);
    const [flowMapOpacity, setFlowMapOpacity] = useState(0.6);

    // Add Adjustment Layer dropdown
    const [showAddMenu, setShowAddMenu] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const flowPainterRef = useRef<FlowPainterHandle>(null);
    const isRightMouseDown = useRef(false);

    // Get active layer
    const activeLayer = layers.find(l => l.id === activeLayerId);

    // Callback when FlowPainter finishes expensive operations
    const handlePaintingComplete = useCallback(() => {
        setFlowVersion(prev => prev + 1);
    }, []);

    // Bridge for 3D painting
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
          activationConstraint: { distance: 5 },
      }),
      useSensor(KeyboardSensor, {
          coordinateGetter: sortableKeyboardCoordinates,
      })
    );

    const handleDragEnd = (event: DragEndEvent) => {
      const {active, over} = event;
      if (over && active.id !== over.id) {
        setLayers((items) => {
            const visualList = [...items].reverse();
            const oldIndex = visualList.findIndex(item => item.id === active.id);
            const newIndex = visualList.findIndex(item => item.id === over.id);
            const newVisualList = arrayMove(visualList, oldIndex, newIndex);
            return newVisualList.reverse();
        });
      }
    };

    const handleTextureUpdate = useCallback((canvas: HTMLCanvasElement) => {
      setFlowCanvas(prev => prev === canvas ? prev : canvas); 
      setFlowVersion(v => v + 1);
    }, []);

    const handleExport = () => {
      if (!flowCanvas) return;
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = flowCanvas.width;
      exportCanvas.height = flowCanvas.height;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) { alert("无法创建导出画布"); return; }
      ctx.drawImage(flowCanvas, 0, 0);
      if (invertX || invertY) {
          const imageData = ctx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
              if (invertX) data[i] = 255 - data[i];
              if (invertY) data[i + 1] = 255 - data[i + 1];
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
      if (file) setSkyTextureUrl(URL.createObjectURL(file));
    };

    // Layer Management
    const addPaintLayer = () => {
        const count = layers.filter(l => l.type === 'paint').length;
        const newLayer: PaintLayer = {
            id: `paint-${Date.now()}`, name: `流向 ${count + 1}`, type: 'paint', visible: true, opacity: 1, blur: 0
        };
        setLayers(prev => [...prev, newLayer]);
        setActiveLayerId(newLayer.id);
        setEditTarget('content');
    };

    const addAdjustmentLayer = (type: 'wind' | 'obstacle') => {
        const config = LAYER_TYPE_CONFIG[type];
        let newLayer: Layer;
        const id = `${type}-${Date.now()}`;
        switch (type) {
            case 'wind':
                newLayer = { id, name: config.label, type: 'wind', visible: true, opacity: 1, blur: 0, direction: 45, strength: 0.5, hasMask: false } as WindLayer;
                break;
            case 'obstacle':
                newLayer = { id, name: config.label, type: 'obstacle', visible: true, opacity: 1, blur: 0, disturbanceEnabled: true, disturbance: 0.5, hasMask: false } as ObstacleLayer;
                break;
        }
        setLayers(prev => [...prev, newLayer]);
        setActiveLayerId(newLayer.id);
        setEditTarget('content');
        setShowAddMenu(false);
    };

    const removeLayer = (id: string) => {
        if (layers.length <= 1) return;
        const newLayers = layers.filter(l => l.id !== id);
        setLayers(newLayers);
        if (activeLayerId === id) {
            setActiveLayerId(newLayers[newLayers.length - 1].id);
        }
        flowPainterRef.current?.clearLayer(id);
    };

    const updateLayer = (id: string, updates: Partial<Layer>) => {
        setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
    };

    // Focus container on mount
    useEffect(() => {
      if (containerRef.current) containerRef.current.focus();
    }, []);

    // Brush Adjustment Logic
    const isAdjustingBrushStrength = useRef(false);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === '?' || e.key === '/') {
          if (!(document.activeElement instanceof HTMLInputElement) && 
              !(document.activeElement instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            setShowShortcuts(prev => !prev);
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          isAdjustingBrushStrength.current = true;
        }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() === 'f' || e.key === 'Control' || e.key === 'Meta') {
          isAdjustingBrushStrength.current = false;
        }
      };
      const handleMouseMove = (e: MouseEvent) => {
        if (isAdjustingBrushStrength.current) {
          const delta = e.movementX;
          setBrushSettings(prev => ({
            ...prev, strength: Math.min(Math.max(prev.strength + delta * 0.005, 0.01), 1.0)
          }));
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('mousemove', handleMouseMove);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('mousemove', handleMouseMove);
      };
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
      const handleMouseDown = (e: MouseEvent) => { if (e.button === 2) isRightMouseDown.current = true; };
      const handleMouseUp = (e: MouseEvent) => { if (e.button === 2) isRightMouseDown.current = false; };
      
      const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        if (isRightMouseDown.current) return;
        const key = e.key.toLowerCase();

        if ((e.ctrlKey || e.metaKey) && key === 'z') {
          e.preventDefault();
          if (e.shiftKey) flowPainterRef.current?.redo();
          else flowPainterRef.current?.undo();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && key === 'y') {
          e.preventDefault();
          flowPainterRef.current?.redo();
          return;
        }

        switch (key) {
          case '1': setViewMode('2d'); break;
          case '2': setViewMode('split'); break;
          case '3': setViewMode('3d'); break;
          case 'b':
            setActiveTool('brush');
            setBrushSettings(prev => ({ ...prev, isEraser: false }));
            break;
          case 'e':
            setActiveTool('eraser');
            setBrushSettings(prev => ({ ...prev, isEraser: true }));
            break;
          case 'm': setActiveTool('magic_wand'); break;
          case 'a': setShowArrows(prev => !prev); break;
          case ' ':
            e.preventDefault();
            setIsAnimating(prev => !prev);
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
              {(['2d', 'split', '3d'] as ViewMode[]).map((mode) => (
                <button key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`p-2 rounded-md transition-all ${viewMode === mode ? 'bg-[#2d2d33] text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-[#252529]'}`}
                  title={mode === '2d' ? '2D 绘制' : mode === 'split' ? '分屏视图' : '3D 预览'}
                >
                  {mode === '2d' ? <Palette className="w-4 h-4" /> : mode === 'split' ? <Columns className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                </button>
              ))}
            </div>
            
            <div className="h-6 w-px bg-[#2d2d33] mx-1"></div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 bg-[#1f1f23] px-3 py-1.5 rounded-lg border border-[#2d2d33]">
                <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">导出:</span>
                {['R', 'G'].map((ch, i) => (
                  <label key={ch} className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer hover:text-white transition-colors">
                    <input type="checkbox" 
                      checked={i === 0 ? invertX : invertY}
                      onChange={(e) => i === 0 ? setInvertX(e.target.checked) : setInvertY(e.target.checked)}
                      className="w-3.5 h-3.5 rounded bg-[#2d2d33] border-[#3d3d45] text-indigo-500 focus:ring-indigo-500"
                    />
                    <span>{ch}</span>
                  </label>
                ))}
              </div>
              <button onClick={handleExport}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
              >
                <Download className="w-4 h-4" /> 导出
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden">
          {/* Sidebar Controls */}
          <aside className="w-[300px] bg-[#18181b] border-r border-[#252529] overflow-y-auto p-4 flex flex-col gap-4 z-10 custom-scrollbar">
            
            {/* Section: Texture Source */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold text-white flex items-center gap-2 relative pl-3">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3 bg-indigo-500 rounded-full"></span>
                图片源
              </h2>
              <div className="relative group">
                <input type="file" accept="image/*" onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                <div className="w-full aspect-[2/1] bg-[#212124] hover:bg-[#252529] text-slate-400 rounded-xl border-2 border-dashed border-[#323238] group-hover:border-indigo-500/50 transition-all flex flex-col items-center justify-center gap-2">
                  <ImageIcon className="w-5 h-5 text-slate-500 group-hover:text-indigo-400" />
                  <p className="text-[10px] text-slate-500">点击上传图片</p>
                </div>
              </div>
              {/* Projection Toggle */}
              <div className="flex p-1 gap-1 bg-[#1f1f23] rounded-xl border border-[#2d2d33]">
                {([['equirectangular', '球面'], ['polar', '极坐标'], ['planar', '平面']] as [ProjectionType, string][]).map(([type, label]) => (
                  <button key={type}
                    onClick={() => setProjectionType(type)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${projectionType === type ? 'bg-[#2d2d33] text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                  >{label}</button>
                ))}
              </div>
              {projectionType === 'polar' && (
                <div className="flex items-center gap-3 px-1">
                    <span className="text-[10px] text-slate-500 font-bold uppercase w-12">角度</span>
                    <input type="range" min="45" max="180" value={polarAngle}
                      onChange={(e) => setPolarAngle(Number(e.target.value))}
                      className="flex-1 h-1 bg-[#2d2d33] rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                    <span className="text-[10px] font-mono text-indigo-400 w-8 text-right">{polarAngle}°</span>
                </div>
              )}
            </section>

            {/* Section: Properties Panel */}
            {activeLayer && (
                <section>
                    <PropertiesPanel layer={activeLayer} updateLayer={updateLayer} />
                </section>
            )}

            {/* Section: Layers */}
            <section className="flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between relative pl-3 mb-3">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3 bg-indigo-500 rounded-full"></span>
                <h2 className="text-xs font-bold text-white">图层</h2>
                <div className="flex items-center gap-1">
                    <button onClick={addPaintLayer}
                        className="p-1.5 bg-[#2d2d33] text-emerald-400 hover:text-white hover:bg-emerald-600 rounded-md transition-all"
                        title="新建流向图层"
                    >
                        <Plus className="w-3.5 h-3.5" />
                    </button>
                    <div className="relative">
                        <button onClick={() => setShowAddMenu(!showAddMenu)}
                            className="flex items-center gap-0.5 p-1.5 bg-[#2d2d33] text-indigo-400 hover:text-white hover:bg-indigo-600 rounded-md transition-all"
                            title="新建调整图层"
                        >
                            <Layers className="w-3.5 h-3.5" />
                            <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                        {showAddMenu && (
                            <div className="absolute right-0 top-full mt-1 bg-[#1f1f23] border border-[#2d2d33] rounded-lg shadow-xl z-50 py-1 min-w-[120px]">
                                {(['wind', 'obstacle'] as const).map((type) => {
                                    const cfg = LAYER_TYPE_CONFIG[type];
                                    return (
                                        <button key={type}
                                            onClick={() => addAdjustmentLayer(type)}
                                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-[#2d2d33] transition-colors"
                                        >
                                            <cfg.icon className="w-3.5 h-3.5" /> {cfg.label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <button onClick={() => removeLayer(activeLayerId)}
                        className="p-1.5 bg-[#2d2d33] text-slate-400 hover:text-white hover:bg-rose-600 rounded-md transition-all"
                        title="删除当前图层"
                    >
                        <Minus className="w-3.5 h-3.5" />
                    </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={[...layers].reverse()} strategy={verticalListSortingStrategy}>
                          {[...layers].reverse().map((layer) => (
                              <SortableLayerItem 
                                  key={layer.id} 
                                  layer={layer}
                                  activeLayerId={activeLayerId}
                                  editTarget={editTarget}
                                  setActiveLayerId={setActiveLayerId}
                                  setEditTarget={setEditTarget}
                                  updateLayer={updateLayer}
                                  removeLayer={removeLayer}
                              />
                          ))}
                      </SortableContext>
                  </DndContext>
              </div>
            </section>
          </aside>

          {/* Main Canvas Area */}
          <div className="flex-1 relative bg-neutral-950 flex overflow-hidden">
            {/* Toolbar */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30 flex flex-wrap justify-center items-center gap-3 w-max max-w-[95vw] p-1 pointer-events-auto"
              onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-2 bg-[#18181b]/50 backdrop-blur-md p-1.5 rounded-xl border border-[#2d2d33] shadow-xl pointer-events-auto">
                    {viewMode !== '3d' && (
                        <div className="relative group flex items-center">
                            <button onClick={() => setShowReference(!showReference)}
                                className={`p-1.5 rounded-lg transition-colors ${showReference ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:bg-[#323238]'}`}
                                title="显示贴图"
                            ><ImageIcon size={16} /></button>
                            {showReference && (
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                    <div className="bg-[#18181b] border border-[#2d2d33] rounded-lg p-3 shadow-xl flex flex-col gap-2 min-w-[140px]">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">透明度</span>
                                            <span className="text-[10px] text-indigo-400 font-mono">{(referenceOpacity * 100).toFixed(0)}%</span>
                                        </div>
                                        <input type="range" min="0" max="1" step="0.05" value={referenceOpacity}
                                            onChange={(e) => setReferenceOpacity(Number(e.target.value))}
                                            className="w-full h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {viewMode !== '2d' && (
                        <div className="relative group flex items-center">
                            <button onClick={() => setShowFlowMap(!showFlowMap)}
                                className={`p-1.5 rounded-lg transition-colors ${showFlowMap ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:bg-[#323238]'}`}
                                title="显示叠加"
                            ><Layers size={16} /></button>
                            {showFlowMap && (
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                    <div className="bg-[#18181b] border border-[#2d2d33] rounded-lg p-3 shadow-xl flex flex-col gap-2 min-w-[140px]">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">透明度</span>
                                            <span className="text-[10px] text-indigo-400 font-mono">{(flowMapOpacity * 100).toFixed(0)}%</span>
                                        </div>
                                        <input type="range" min="0" max="1" step="0.05" value={flowMapOpacity}
                                            onChange={(e) => setFlowMapOpacity(Number(e.target.value))}
                                            className="w-full h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="relative group flex items-center">
                        <button onClick={() => setIsAnimating(!isAnimating)}
                            className={`p-1.5 rounded-lg transition-colors ${isAnimating ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:bg-[#323238]'}`}
                            title="动画开关"
                        ><Play size={16} fill={isAnimating ? "currentColor" : "none"} /></button>
                        {isAnimating && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                <div className="bg-[#18181b] border border-[#2d2d33] rounded-lg p-3 shadow-xl flex flex-col gap-3 min-w-[140px]">
                                    {[['速度', previewSpeed, setPreviewSpeed, 0, 2, 0.05], ['强度', previewDistortion, setPreviewDistortion, 0, 0.5, 0.01]].map(([label, val, setter, min, max, step]) => (
                                        <div key={label as string} className="flex flex-col gap-1">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{label as string}</span>
                                                <span className="text-[10px] text-indigo-400 font-mono">{(val as number).toFixed(2)}</span>
                                            </div>
                                            <input type="range" min={min as number} max={max as number} step={step as number} value={val as number}
                                                onChange={(e) => (setter as Function)(Number(e.target.value))}
                                                className="w-full h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="relative group flex items-center">
                        <button onClick={() => setShowArrows(!showArrows)}
                            className={`p-1.5 rounded-lg transition-colors ${showArrows ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:bg-[#323238]'}`}
                            title="显示箭头"
                        ><Move size={16} /></button>
                        {showArrows && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                <div className="bg-[#18181b] border border-[#2d2d33] rounded-lg p-3 shadow-xl flex flex-col gap-3 min-w-[140px]">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">密度</span>
                                            <span className="text-[10px] text-indigo-400 font-mono">{arrowDensity}</span>
                                        </div>
                                        <input type="range" min="16" max="128" step="4" value={arrowDensity}
                                            onChange={(e) => setArrowDensity(Number(e.target.value))}
                                            className="w-full h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 2D View */}
            <div className={`relative overflow-hidden border-r border-slate-800 transition-all duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] will-change-[flex-grow]
                ${viewMode === '3d' ? 'flex-[0] border-none opacity-0 pointer-events-none' : 'flex-[1] opacity-100'} min-w-0`}
            >
              <div className="absolute inset-0">
                <FlowPainter 
                  ref={flowPainterRef}
                  activeTool={activeTool}
                  brushSettings={brushSettings} 
                  bgImageUrl={skyTextureUrl} 
                  showReference={showReference}
                  referenceOpacity={referenceOpacity}
                  onTextureUpdate={handleTextureUpdate}
                  layers={layers}
                  activeLayerId={activeLayerId}
                  editTarget={editTarget}
                  magicWandThreshold={magicWandThreshold}
                  onPaintingComplete={handlePaintingComplete}
                  onSetBrushSize={(size) => setBrushSettings(prev => ({ ...prev, size }))}
                  projectionType={projectionType}
                  polarAngle={polarAngle}
                  cursorUV={sharedCursorUV}
                  onCursorUpdate={setSharedCursorUV}
                  showArrows={showArrows}
                  arrowDensity={arrowDensity}
                />
              </div>
            </div>

            {/* 3D View */}
            <div className={`relative overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] will-change-[flex-grow] flex items-center justify-center bg-neutral-950
                ${viewMode === '2d' ? 'flex-[0] opacity-0 pointer-events-none' : 'flex-[1] opacity-100'} min-w-0`}
            >
              <div className={`relative w-full h-full ${viewMode === 'split' ? 'aspect-square max-h-full max-w-full' : ''} transition-all duration-500`}>
                <PreviewScene 
                  skyTextureUrl={skyTextureUrl}
                  flowCanvas={flowCanvas}
                  speed={isAnimating ? previewSpeed : 0}
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
                  flowMapOpacity={flowMapOpacity}
                  onSetBrushSize={(size) => setBrushSettings(prev => ({ ...prev, size }))}
                  cursorUV={sharedCursorUV}
                  onCursorUpdate={setSharedCursorUV}
                />
              </div>
            </div>

            {/* Help Button */}
            <div className="absolute top-4 left-4 z-10 pointer-events-auto">
                <button onClick={() => setShowShortcuts(!showShortcuts)}
                  className={`p-2 rounded-xl backdrop-blur-md border transition-all duration-300 shadow-xl ${showShortcuts ? 'bg-indigo-500 text-white border-indigo-400' : 'bg-[#18181b]/80 text-slate-400 border-[#2d2d33] hover:text-white hover:bg-[#2d2d33]'}`}
                >
                  <HelpCircle size={20} />
                </button>
                {showShortcuts && (
                  <div className="absolute top-full left-0 mt-2 bg-[#18181b]/90 backdrop-blur-md p-4 rounded-2xl border border-[#2d2d33] shadow-2xl w-[200px]">
                    <div className="space-y-2 text-[10px]">
                      <strong className="text-slate-400 uppercase tracking-wider text-[9px] font-bold">快捷键</strong>
                      <ul className="space-y-1 text-slate-400">
                        {[['画笔', 'B'], ['橡皮擦', 'E'], ['选取', 'M'], ['箭头', 'A'], ['笔刷大小', 'F+拖拽'], ['笔刷强度', 'Ctrl+F'], ['2D/分屏/3D', '1/2/3'], ['播放/暂停', 'Space'], ['撤销/重做', 'Ctrl+Z/Y']].map(([name, key]) => (
                          <li key={name} className="flex justify-between"><span>{name}</span><span className="text-indigo-400 bg-[#323238] px-1 py-0.5 rounded text-[9px] font-bold">{key}</span></li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
            </div>

            {/* Brush Settings - Bottom Center */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center gap-3 pointer-events-none">
                {activeTool !== 'magic_wand' && (
                  <div className="pointer-events-auto flex items-center gap-3 bg-[#18181b]/50 backdrop-blur-md px-2 py-2 rounded-xl border border-[#2d2d33] shadow-xl">
                      <button onClick={() => {
                          const newTool = activeTool === 'brush' ? 'eraser' : 'brush';
                          setActiveTool(newTool);
                          setBrushSettings(prev => ({ ...prev, isEraser: newTool === 'eraser' }));
                      }}
                        className={`p-1.5 rounded-lg transition-colors ${activeTool === 'eraser' ? 'bg-rose-500 text-white' : 'bg-indigo-500 text-white'}`}
                      >
                        {activeTool === 'eraser' ? <Eraser size={16} /> : <Pencil size={16} />}
                      </button>
                      {[['大小', brushSettings.size, 1, 200, 1, (v: number) => setBrushSettings(prev => ({ ...prev, size: v })), `${brushSettings.size.toFixed(0)}`],
                        ['强度', brushSettings.strength, 0, 1, 0.01, (v: number) => setBrushSettings(prev => ({ ...prev, strength: v })), `${(brushSettings.strength * 100).toFixed(0)}%`]
                      ].map(([label, value, min, max, step, onChange, display]) => (
                        <div key={label as string} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider whitespace-nowrap">{label as string}</span>
                          <input type="range" min={min as number} max={max as number} step={step as number} value={value as number}
                            onChange={(e) => (onChange as Function)(Number(e.target.value))}
                            className="w-20 h-1 bg-[#323238] rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                          <span className="text-[10px] text-indigo-400 font-mono min-w-[3ch] text-right">{display as string}</span>
                        </div>
                      ))}

                      {/* Show what we're editing */}
                      {activeLayer && (
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${
                              LAYER_TYPE_CONFIG[activeLayer.type].color === 'emerald' ? 'bg-emerald-500/20 text-emerald-400' :
                              LAYER_TYPE_CONFIG[activeLayer.type].color === 'violet' ? 'bg-violet-500/20 text-violet-400' :
                              LAYER_TYPE_CONFIG[activeLayer.type].color === 'rose' ? 'bg-rose-500/20 text-rose-400' :
                              'bg-sky-500/20 text-sky-400'
                          }`}>
                              <span className="text-[9px] font-bold uppercase">
                                  {isAdjustmentLayer(activeLayer) && editTarget === 'mask' ? '遮罩' : activeLayer.name}
                              </span>
                          </div>
                      )}
                  </div>
                )}
            </div>
          </div>
        </main>
      </div>
    );
  };

  export default App;
