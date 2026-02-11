export interface BrushSettings {
  size: number;
  strength: number; // 0 to 1
  hardness: number; // 0 to 1
  isEraser: boolean;
}

export type ViewMode = 'split' | '2d' | '3d';

export type ActiveTool = 'brush' | 'eraser' | 'magic_wand';

export interface Layer {
    id: string;
    name: string;
    visible: boolean;
    isObstacle: boolean;
    disturbance?: number; // 0 to 1, creates flow deviation around obstacle
    disturbanceEnabled?: boolean; // Controls whether disturbance is active
    blur: number; // 0 to 32
    opacity: number; // 0 to 1
}

export interface LayerSettings {
    blur: number;
    opacity: number;
    disturbance?: number;
    disturbanceEnabled?: boolean;
    visible: boolean;
}

export type ProjectionType = 'equirectangular' | 'polar' | 'planar';

export interface FlowPainterHandle {
  stroke: (u: number, v: number, lastU: number, lastV: number) => void;
  floodFill: (u: number, v: number, threshold: number) => void;
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;
  clearLayer: (id: string) => void;
  renderComposite: () => void;
  getCanvas: () => HTMLCanvasElement | null;
}
