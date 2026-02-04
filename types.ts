export interface BrushSettings {
  size: number;
  strength: number; // 0 to 1
  hardness: number; // 0 to 1
  isEraser: boolean;
}

export type ViewMode = 'split' | '2d' | '3d';

export type ActiveTool = 'brush' | 'eraser' | 'obstacle' | 'obstacle_eraser' | 'magic_wand';

export interface LayerSettings {
    blur: number; // 0 to 32
    opacity: number; // 0 to 1 (Optional, mainly for mixing)
    visible: boolean;
}

export type ProjectionType = 'equirectangular' | 'polar';

export interface FlowPainterHandle {
  stroke: (u: number, v: number, lastU: number, lastV: number) => void;
  floodFill: (u: number, v: number, threshold: number) => void;
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;
}