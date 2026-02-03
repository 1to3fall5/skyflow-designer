export interface BrushSettings {
  size: number;
  strength: number; // 0 to 1
  hardness: number; // 0 to 1
  isEraser: boolean;
}

export type ViewMode = 'split' | '2d' | '3d';

export type ActiveTool = 'brush' | 'eraser';

export type ProjectionType = 'equirectangular' | 'polar';

export interface FlowPainterHandle {
  stroke: (u: number, v: number, lastU: number, lastV: number) => void;
}