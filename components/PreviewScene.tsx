import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Sphere, Plane, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { FlowShaderMaterial, ArrowShaderMaterial } from './FlowShader';
import { BrushSettings, ActiveTool, ProjectionType } from '../types';

// Augment the global JSX namespace to include Three.js elements
// We use 'any' to ensure compatibility across different R3F/Three type versions
declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      shaderMaterial: any;
      ambientLight: any;
    }
  }
}

// Augment React's local JSX namespace (fixes issues with recent React types where JSX is scoped to React)
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      shaderMaterial: any;
      ambientLight: any;
    }
  }
}

interface SceneContentProps {
  skyTextureUrl: string | null;
  flowCanvas: HTMLCanvasElement | null;
  speed: number;
  distortion: number;
  brushSettings: BrushSettings;
  isPaintMode: boolean;
  activeTool: ActiveTool;
  flowVersion: number;
  onPaint: (u: number, v: number, lu: number, lv: number) => void;
  onPaintEnd?: () => void;
  projectionType: ProjectionType;
  polarAngle: number;
  showFlowMap: boolean;
  flowMapOpacity?: number;
  arrowDensity: number;
  cursorUV?: {u: number, v: number} | null;
  onCursorUpdate?: (uv: {u: number, v: number} | null) => void;
}

const SceneContent: React.FC<SceneContentProps> = ({ 
  skyTextureUrl, 
  flowCanvas,
  speed,
  distortion,
  brushSettings,
  isPaintMode,
  activeTool,
  flowVersion,
  onPaint,
  onPaintEnd,
  projectionType,
  polarAngle,
  showFlowMap,
  flowMapOpacity = 0.6,
  arrowDensity,
  cursorUV: cursorUVProp,
  onCursorUpdate
}) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const arrowMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const textureLoader = useMemo(() => new THREE.TextureLoader(), []);
  const { gl } = useThree();
  const prevVersion = useRef(flowVersion);
  
  // Update cursor style
  useEffect(() => {
     gl.domElement.style.cursor = activeTool === 'magic_wand' ? 'default' : 'none';
  }, [gl, activeTool]);

  // Painting State (Raster)
  const isDragging = useRef(false);
  const lastTransformedUV = useRef<THREE.Vector2 | null>(null);
  
  // Cursor State
  const cursorUV = useRef<THREE.Vector2>(new THREE.Vector2(0, 0));
  const [showCursor, setShowCursor] = useState(false);
  
  // Plane Aspect Ratio
  const [planeAspect, setPlaneAspect] = useState(2.0);

  // Helper to transform Sphere UVs to Texture UVs based on projection
  const getTransformedUV = (sphereUV: THREE.Vector2): THREE.Vector2 => {
      if (projectionType === 'polar') {
          // Hemisphere Mapping: Zenith (v=1) -> Center (r=0), Horizon (v=0.5) -> Edge (r=0.5)
          const phi = (1.0 - sphereUV.y) * Math.PI;
          const theta = sphereUV.x * 2.0 * Math.PI;
          
          const maxPhi = THREE.MathUtils.degToRad(polarAngle);

          // r = (phi / maxPhi) * 0.5
          const r = (phi / maxPhi) * 0.5;
          
          const x = r * Math.sin(theta);
          const y = r * Math.cos(theta);
          return new THREE.Vector2(0.5 + x, 0.5 + y);
      }
      return sphereUV.clone();
  };

  // Create flow texture from canvas
  const flowTexture = useMemo(() => {
    if (!flowCanvas) {
      const data = new Uint8Array([128, 128, 0, 255]);
      const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      t.needsUpdate = true;
      return t;
    }
    const t = new THREE.CanvasTexture(flowCanvas);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }, [flowCanvas]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      
      // Update cursor position every frame for smoothness
      materialRef.current.uniforms.uCursor.value.copy(cursorUV.current);

      const shouldUpdate = flowVersion !== prevVersion.current || isDragging.current;
      
      if (shouldUpdate) {
         if (flowVersion !== prevVersion.current) {
             prevVersion.current = flowVersion;
         }
         materialRef.current.uniforms.uFlowMap.value.needsUpdate = true;
      }

      // Update brush strength uniform
      materialRef.current.uniforms.uBrushStrength.value = brushSettings.strength;
    }
    if (arrowMaterialRef.current) {
      if (materialRef.current?.uniforms.uFlowMap.value.needsUpdate) {
        arrowMaterialRef.current.uniforms.uFlowMap.value.needsUpdate = true;
      }
    }
  });

  // Update other static/slow uniforms via effect to save frame time
  useEffect(() => {
    if (materialRef.current) {
      const uvRadius = (brushSettings.size / 2.0) / 1024.0;
      materialRef.current.uniforms.uBrushSize.value = uvRadius;
      materialRef.current.uniforms.uShowCursor.value = showCursor ? 1.0 : 0.0;
      materialRef.current.uniforms.uProjectionType.value = projectionType === 'polar' ? 1.0 : (projectionType === 'planar' ? 2.0 : 0.0);
      materialRef.current.uniforms.uPolarAngle.value = THREE.MathUtils.degToRad(polarAngle);
      materialRef.current.uniforms.uShowFlowMap.value = showFlowMap ? 1.0 : 0.0;
      materialRef.current.uniforms.uFlowMapOpacity.value = flowMapOpacity;
      materialRef.current.uniformsNeedUpdate = true;
    }
    if (arrowMaterialRef.current) {
      arrowMaterialRef.current.uniforms.uProjectionType.value = projectionType === 'polar' ? 1.0 : (projectionType === 'planar' ? 2.0 : 0.0);
      arrowMaterialRef.current.uniforms.uPolarAngle.value = THREE.MathUtils.degToRad(polarAngle);
      
      const x = arrowDensity;
      const y = projectionType === 'planar' ? Math.round(x / planeAspect) : Math.round(x / 2);
      arrowMaterialRef.current.uniforms.uGridSize.value.set(x, y);

      arrowMaterialRef.current.uniformsNeedUpdate = true;
    }
  }, [brushSettings.size, showCursor, projectionType, polarAngle, showFlowMap, flowMapOpacity, arrowDensity, planeAspect]);

  // Special handling for cursor UV as it changes on mouse move but doesn't need a full uniform update loop if not painting
  // However, cursor is tracked via ref cursorUV.current and updated in useFrame normally.
  // Actually, cursor position SHOULD be in useFrame if we want smooth cursor movement in 3D.
  // Let's keep uCursor in useFrame.

  // Load Sky Texture
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;

    if (skyTextureUrl) {
        textureLoader.load(
          skyTextureUrl, 
          (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.wrapS = THREE.RepeatWrapping;
              tex.wrapT = THREE.RepeatWrapping;
              tex.minFilter = THREE.LinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.needsUpdate = true;
              if (tex.image) {
                  setPlaneAspect(tex.image.width / tex.image.height);
              }
              if (materialRef.current) {
                materialRef.current.uniforms.uTexture.value = tex;
                materialRef.current.uniformsNeedUpdate = true;
              }
          }
        );
    } else {
         const canvas = document.createElement('canvas');
         canvas.width = 512; canvas.height = 256;
         setPlaneAspect(2.0);
         const ctx = canvas.getContext('2d');
         if (ctx) {
            ctx.fillStyle = '#444'; 
            ctx.fillRect(0, 0, 512, 256);
            ctx.fillStyle = '#666'; 
            const gridSize = 16; // Size of each square
             for (let y = 0; y < 256; y += gridSize) {
                 for (let x = 0; x < 512; x += gridSize) {
                    // Checkerboard pattern
                    if ((x / gridSize + y / gridSize) % 2 === 0) {
                        ctx.fillRect(x, y, gridSize, gridSize);
                    }
                }
            }
         }
         const t = new THREE.CanvasTexture(canvas);
         t.wrapS = THREE.RepeatWrapping;
         t.wrapT = THREE.RepeatWrapping;
         t.colorSpace = THREE.SRGBColorSpace;
         material.uniforms.uTexture.value = t;
         material.uniformsNeedUpdate = true;
    }
  }, [skyTextureUrl, textureLoader]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uSpeed.value = speed;
      materialRef.current.uniforms.uDistortionStrength.value = distortion;
      materialRef.current.uniforms.uFlowMap.value = flowTexture;
      materialRef.current.uniformsNeedUpdate = true;
    }
    if (arrowMaterialRef.current) {
      arrowMaterialRef.current.uniforms.uFlowMap.value = flowTexture;
      arrowMaterialRef.current.uniformsNeedUpdate = true;
    }
  }, [speed, distortion, flowTexture]);

  // Sync cursor from external source
  useEffect(() => {
    if (cursorUVProp) {
        // Convert from Canvas UV (0,0 top-left) to Shader UV (0,0 bottom-left)
        const shaderUV = new THREE.Vector2(cursorUVProp.u, 1 - cursorUVProp.v);
        cursorUV.current.copy(shaderUV);
        if (!showCursor) setShowCursor(true);
    } else {
        // If external cursor is null, we might want to hide, but ONLY if we are not interacting locally.
        // However, if we interact locally, we emit non-null.
        // If we leave locally, we emit null.
        // So if prop is null, it means NO ONE is pointing.
        if (showCursor) setShowCursor(false);
    }
  }, [cursorUVProp]);

  // --- Interaction Handlers ---

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); 
    try {
        gl.domElement.setPointerCapture(e.pointerId);
    } catch (err) {
        // Ignore InvalidStateError if pointer is already released or invalid
        console.warn('Failed to capture pointer:', err);
    }
    
    if (e.uv) {
        const transformed = getTransformedUV(e.uv);
        lastTransformedUV.current = transformed.clone();
        
        // Paint initial dot
        const u = transformed.x;
        // Invert Y for Canvas logic (0 is top)
        const v = 1 - transformed.y; 
        
        onPaint(u, v, u, v);
    }

    isDragging.current = true;
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    try {
        gl.domElement.releasePointerCapture(e.pointerId);
    } catch (err) {
        // Ignore errors if pointer was not captured
    }
    if (isDragging.current) {
        if (onPaintEnd) onPaintEnd();
    }
    isDragging.current = false;
    lastTransformedUV.current = null;
  };
  
  const handlePointerLeave = (e: ThreeEvent<PointerEvent>) => {
    if (isDragging.current) {
        if (onPaintEnd) onPaintEnd();
    }
    isDragging.current = false;
    lastTransformedUV.current = null;
    
    // Only hide if we don't have an external cursor
    // Actually, if we leave, we signal null to external.
    onCursorUpdate?.(null);
    if (!cursorUVProp) setShowCursor(false);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.uv) {
        const transformed = getTransformedUV(e.uv);
        cursorUV.current.copy(transformed);
        if (!showCursor) setShowCursor(true);
        
        // Emit cursor update (convert to Canvas UV: 0,0 at top-left)
        onCursorUpdate?.({
            u: transformed.x,
            v: 1 - transformed.y
        });
        
        if (!isDragging.current || !lastTransformedUV.current) return;
        
        e.stopPropagation();

        const current = transformed;
        const last = lastTransformedUV.current;

        const u = current.x;
        const v = 1 - current.y; 
        const lu = last.x;
        const lv = 1 - last.y;

        onPaint(u, v, lu, lv);
        lastTransformedUV.current = current.clone();
    }
  };

  return (
    <group rotation={[0, projectionType === 'polar' ? -Math.PI / 2 : 0, 0]}>
        {/* Main Sky Mesh */}
        {projectionType === 'planar' ? (
            <Plane
                args={[20, 20 / planeAspect]}
                position={[0, -5, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
            >
                <shaderMaterial
                    ref={materialRef}
                    args={[FlowShaderMaterial]}
                    side={THREE.DoubleSide}
                />
            </Plane>
        ) : (
            <Sphere 
              args={[10, 64, 64]} 
              scale={[-1, 1, 1]}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
            > 
              <shaderMaterial
                  ref={materialRef}
                  args={[FlowShaderMaterial]}
                  side={THREE.DoubleSide}
              />
            </Sphere>
        )}
        
        {/* Flow Arrows Overlay */}
        {isPaintMode && (
            projectionType === 'planar' ? (
                <Plane 
                    args={[20, 20 / planeAspect]} 
                    position={[0, -4.99, 0]} 
                    rotation={[-Math.PI / 2, 0, 0]}
                    raycast={() => null}
                >
                    <shaderMaterial 
                        ref={arrowMaterialRef}
                        args={[ArrowShaderMaterial]}
                        side={THREE.DoubleSide}
                        transparent={true}
                    />
                </Plane>
            ) : (
                <Sphere args={[9.8, 64, 32]} scale={[-1, 1, 1]} raycast={() => null}>
                    <shaderMaterial 
                        ref={arrowMaterialRef}
                        args={[ArrowShaderMaterial]}
                        side={THREE.DoubleSide}
                        transparent={true}
                    />
                </Sphere>
            )
        )}
    </group>
  );
};

const UEControls = ({ 
  controlsRef, 
  projectionType,
  onSetBrushSize,
  currentBrushSize
}: { 
  controlsRef: React.MutableRefObject<any>, 
  projectionType: ProjectionType,
  onSetBrushSize?: (size: number) => void,
  currentBrushSize: number
}) => {
  const { camera, gl } = useThree();
  const keys = useRef({ w: false, a: false, s: false, d: false, q: false, e: false });
  const isRightMouseDown = useRef(false);
  
  // Brush Resize State
  const isFKeyPressed = useRef(false);
  const hasResizedBrush = useRef(false);
  const fKeyAccumulatedMovement = useRef(0);
  const ignoreNextMove = useRef(false);
  const currentBrushSizeRef = useRef(currentBrushSize);

  // Keep ref in sync
  useEffect(() => {
    currentBrushSizeRef.current = currentBrushSize;
  }, [currentBrushSize]);

  // Auto-reset camera when projection type changes
  useEffect(() => {
    if (projectionType === 'planar') {
      camera.position.set(0, 0, 10);
      if (controlsRef.current) {
        controlsRef.current.target.set(0, -5, 0);
        controlsRef.current.update();
      }
    } else {
      camera.position.set(0, 0, 0.1);
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }
    }
  }, [projectionType, camera]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'f') {
        if (!isFKeyPressed.current) {
            isFKeyPressed.current = true;
            hasResizedBrush.current = false;
            fKeyAccumulatedMovement.current = 0;
            ignoreNextMove.current = true;
        }
        return;
      }
      if (key in keys.current) {
        keys.current[key as keyof typeof keys.current] = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'f') {
        isFKeyPressed.current = false;
        
        // Only trigger reset if we didn't resize the brush (and exceeded threshold)
        // Reset Logic: If F key was pressed and released without significant mouse movement
        if (!hasResizedBrush.current && fKeyAccumulatedMovement.current < 20) {
            console.log('F key release detected as TAP (Reset Camera)', { accumulated: fKeyAccumulatedMovement.current });
            if (projectionType === 'planar') {
              // Reset to view the plane from a perspective angle
              camera.position.set(0, 0, 10);
              if (controlsRef.current) {
                controlsRef.current.target.set(0, -5, 0);
                controlsRef.current.update();
              }
            } else {
              // Reset to center of sphere, keeping viewing direction
              if (controlsRef.current) {
                const offset = new THREE.Vector3().subVectors(controlsRef.current.target, camera.position);
                camera.position.set(0, 0, 0.1);
                controlsRef.current.target.copy(camera.position).add(offset);
                controlsRef.current.update();
              }
            }
        }
        hasResizedBrush.current = false;
        fKeyAccumulatedMovement.current = 0;
        return;
      }
      if (key in keys.current) {
        keys.current[key as keyof typeof keys.current] = false;
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2) isRightMouseDown.current = true;
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 2) isRightMouseDown.current = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Handle Brush Resize
      if (isFKeyPressed.current && onSetBrushSize) {
          // If Ctrl/Meta is pressed, we are likely adjusting strength (handled in App.tsx), so skip size adjustment
          if (e.ctrlKey || e.metaKey) return;

          if (ignoreNextMove.current) {
              ignoreNextMove.current = false;
              return;
          }
          
          fKeyAccumulatedMovement.current += Math.abs(e.movementX) + Math.abs(e.movementY);
          
          // Debug F key movement
          // console.log('F key active - movement:', { x: e.movementX, y: e.movementY, total: fKeyAccumulatedMovement.current });
          
          // Threshold to prevent accidental resize when just clicking F for reset
          if (fKeyAccumulatedMovement.current > 20 || hasResizedBrush.current) {
              hasResizedBrush.current = true;
              const delta = e.movementX;
              // Adjust sensitivity and clamp
              const newSize = Math.max(1, Math.min(200, currentBrushSizeRef.current + delta * 0.5));
              onSetBrushSize(newSize);
          }
          return; // Stop camera movement while holding F (even if below threshold, to be safe)
      }

      if (!isRightMouseDown.current || !controlsRef.current) return;
      
      const { movementX, movementY } = e;
      const sensitivity = 0.002;
      
      const controls = controlsRef.current;
      const target = controls.target;
      
      const vector = new THREE.Vector3();
      vector.subVectors(target, camera.position);
      
      // Yaw: Rotate around World UP (0,1,0)
      // Mouse Left (neg X) -> Look Left -> Rotate vector around +Y
      vector.applyAxisAngle(new THREE.Vector3(0, 1, 0), -movementX * sensitivity);
      
      // Pitch: Rotate around Camera Right
      const right = new THREE.Vector3().crossVectors(vector, new THREE.Vector3(0, 1, 0)).normalize();
      
      // Mouse Up (neg Y) -> Look Up -> Rotate vector around Right
      vector.applyAxisAngle(right, -movementY * sensitivity);
      
      target.copy(camera.position).add(vector);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [camera, projectionType, onSetBrushSize]);

  useFrame((state, delta) => {
    if (!isRightMouseDown.current || !controlsRef.current) return;

    const { w, a, s, d, q, e } = keys.current;
    if (!w && !a && !s && !d && !q && !e) return;

    const speed = 10.0 * delta; 
    const moveDir = new THREE.Vector3();
    
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    
    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();
    
    const up = new THREE.Vector3(0, 1, 0);

    if (w) moveDir.add(forward);
    if (s) moveDir.sub(forward);
    if (d) moveDir.add(right);
    if (a) moveDir.sub(right);
    if (e) moveDir.add(up);
    if (q) moveDir.sub(up);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().multiplyScalar(speed);
      
      camera.position.add(moveDir);
      controlsRef.current.target.add(moveDir);
    }
  });

  return null;
};

interface PreviewSceneProps extends Omit<SceneContentProps, 'flowVersion' | 'polarAngle' | 'showFlowMap' | 'arrowDensity'> {
  className?: string;
  flowVersion?: number;
  polarAngle?: number;
  showFlowMap?: boolean;
  flowMapOpacity?: number;
  arrowDensity?: number;
  onSetBrushSize?: (size: number) => void;
}

const PreviewScene: React.FC<PreviewSceneProps> = (props) => {
  const controlsRef = useRef<any>(null);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setIsCtrlPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setIsCtrlPressed(false);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div className={`relative w-full h-full ${props.className}`}>
      <Canvas 
        resize={{ debounce: 0 }} // Force immediate resize during layout transitions to prevent lag
        flat 
        camera={{ position: [0, 0, 0.1], fov: 75 }} 
        gl={{ preserveDrawingBuffer: true }}
      >
        <ambientLight intensity={0.5} />
        <SceneContent 
          {...props} 
          flowVersion={props.flowVersion || 0} 
          polarAngle={props.polarAngle || 90} 
          showFlowMap={props.showFlowMap || false}
          flowMapOpacity={props.flowMapOpacity}
          arrowDensity={props.arrowDensity || 64}
          cursorUV={props.cursorUV}
          onCursorUpdate={props.onCursorUpdate}
        />
        <UEControls 
          controlsRef={controlsRef}  
          projectionType={props.projectionType} 
          onSetBrushSize={props.onSetBrushSize}
          currentBrushSize={props.brushSettings.size}
        />
        <OrbitControls 
          ref={controlsRef}
          makeDefault 
          enableZoom={true} 
          enablePan={false} 
          rotateSpeed={-0.5} 
          enabled={true} 
          mouseButtons={{
            LEFT: undefined as unknown as THREE.MOUSE,
            MIDDLE: isCtrlPressed ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE,
            RIGHT: undefined as unknown as THREE.MOUSE
          }}
        />
        <GizmoHelper alignment="top-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ff3653', '#0adb50', '#2c8fdf']} labelColor="white" />
        </GizmoHelper>
      </Canvas>
    </div>
  );
};

export default PreviewScene;