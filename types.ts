export interface BrushSettings {
  size: number;
  strength: number; // 0 to 1
  hardness: number; // 0 to 1
  isEraser: boolean;
}

export type ViewMode = 'split' | '2d' | '3d';

export type ActiveTool = 'brush' | 'eraser' | 'magic_wand';

export type LayerType = 'paint' | 'wind' | 'obstacle';

// Base interface shared by all layers
export interface BaseLayer {
    id: string;
    name: string;
    type: LayerType;
    visible: boolean;
    opacity: number; // 0 to 1
    blur: number;    // 0 to 64, applied during compositing
}

// Normal painting layer - stores hand-drawn flow direction data
export interface PaintLayer extends BaseLayer {
    type: 'paint';
}

// Wind adjustment layer - fills uniform direction, optionally masked
export interface WindLayer extends BaseLayer {
    type: 'wind';
    direction: number;    // 0 to 360
    strength: number;     // 0 to 1
    hasMask: boolean;     // whether user has drawn a mask
}

// Obstacle adjustment layer - marks static areas (B=0), optionally with disturbance
export interface ObstacleLayer extends BaseLayer {
    type: 'obstacle';
    disturbanceEnabled: boolean;
    disturbance: number;  // 0 to 1
    hasMask: boolean;
}

// Union type for all layers
export type Layer = PaintLayer | WindLayer | ObstacleLayer;

// Helper type guard functions
export const isPaintLayer = (layer: Layer): layer is PaintLayer => layer.type === 'paint';
export const isWindLayer = (layer: Layer): layer is WindLayer => layer.type === 'wind';
export const isObstacleLayer = (layer: Layer): layer is ObstacleLayer => layer.type === 'obstacle';
export const isAdjustmentLayer = (layer: Layer): layer is WindLayer | ObstacleLayer =>
    layer.type === 'wind' || layer.type === 'obstacle';

export type ProjectionType = 'equirectangular' | 'polar' | 'planar';

// What the user is currently editing on an adjustment layer
export type EditTarget = 'content' | 'mask';

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
