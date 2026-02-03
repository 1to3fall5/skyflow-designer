import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Sphere } from '@react-three/drei';
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
  projectionType: ProjectionType;
  polarAngle: number;
  showFlowMap: boolean;
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
  projectionType,
  polarAngle,
  showFlowMap
}) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const arrowMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const textureLoader = useMemo(() => new THREE.TextureLoader(), []);
  const { gl } = useThree();
  const prevVersion = useRef(flowVersion);
  
  // Update cursor style
  useEffect(() => {
     gl.domElement.style.cursor = 'crosshair';
  }, [gl]);

  // Painting State (Raster)
  const isDragging = useRef(false);
  const lastTransformedUV = useRef<THREE.Vector2 | null>(null);
  
  // Cursor State
  const cursorUV = useRef<THREE.Vector2>(new THREE.Vector2(0, 0));
  const [showCursor, setShowCursor] = useState(false);

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
      
      const shouldUpdate = flowVersion !== prevVersion.current || isDragging.current;
      
      if (shouldUpdate || (flowCanvas && materialRef.current.uniforms.uFlowMap.value.image === flowCanvas)) {
         if (flowVersion !== prevVersion.current) {
             prevVersion.current = flowVersion;
         }
         materialRef.current.uniforms.uFlowMap.value.needsUpdate = true;
      }
      
      const uvRadius = (brushSettings.size / 2.0) / 1024.0;
      materialRef.current.uniforms.uCursor.value.copy(cursorUV.current);
      materialRef.current.uniforms.uBrushSize.value = uvRadius;
      materialRef.current.uniforms.uShowCursor.value = showCursor ? 1.0 : 0.0;
      materialRef.current.uniforms.uProjectionType.value = projectionType === 'polar' ? 1.0 : 0.0;
      materialRef.current.uniforms.uPolarAngle.value = THREE.MathUtils.degToRad(polarAngle);
      materialRef.current.uniforms.uShowFlowMap.value = showFlowMap ? 1.0 : 0.0;
      materialRef.current.uniformsNeedUpdate = true;
    }
    if (arrowMaterialRef.current) {
      if (materialRef.current?.uniforms.uFlowMap.value.needsUpdate) {
        arrowMaterialRef.current.uniforms.uFlowMap.value.needsUpdate = true;
      }
      arrowMaterialRef.current.uniforms.uProjectionType.value = projectionType === 'polar' ? 1.0 : 0.0;
      arrowMaterialRef.current.uniforms.uPolarAngle.value = THREE.MathUtils.degToRad(polarAngle);
      arrowMaterialRef.current.uniformsNeedUpdate = true;
    }
  });

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
              if (materialRef.current) {
                materialRef.current.uniforms.uTexture.value = tex;
                materialRef.current.uniformsNeedUpdate = true;
              }
          }
        );
    } else {
         const canvas = document.createElement('canvas');
         canvas.width = 64; canvas.height = 64;
         const ctx = canvas.getContext('2d');
         if (ctx) {
            ctx.fillStyle = '#444'; ctx.fillRect(0,0,64,64);
            ctx.fillStyle = '#666'; ctx.fillRect(0,0,32,32); ctx.fillRect(32,32,32,32);
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

  // --- Interaction Handlers ---

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); 
    
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
    isDragging.current = false;
    lastTransformedUV.current = null;
  };
  
  const handlePointerLeave = (e: ThreeEvent<PointerEvent>) => {
    isDragging.current = false;
    lastTransformedUV.current = null;
    setShowCursor(false);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.uv) {
        const transformed = getTransformedUV(e.uv);
        cursorUV.current.copy(transformed);
        if (!showCursor) setShowCursor(true);
        
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
    <group>
        {/* Main Sky Sphere */}
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
        
        {/* Flow Arrows Overlay */}
        {isPaintMode && (
            <Sphere args={[9.8, 64, 32]} scale={[-1, 1, 1]} raycast={() => null}>
                <shaderMaterial 
                    ref={arrowMaterialRef}
                    args={[ArrowShaderMaterial]}
                    side={THREE.DoubleSide}
                    transparent={true}
                />
            </Sphere>
        )}
    </group>
  );
};

interface PreviewSceneProps extends Omit<SceneContentProps, 'flowVersion' | 'polarAngle' | 'showFlowMap'> {
  className?: string;
  flowVersion?: number;
  polarAngle?: number;
  showFlowMap?: boolean;
}

const PreviewScene: React.FC<PreviewSceneProps> = (props) => {
  return (
    <div className={`relative w-full h-full ${props.className}`}>
      <Canvas 
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
        />
        <OrbitControls 
          makeDefault 
          enableZoom={true} 
          enablePan={false} 
          rotateSpeed={-0.5} 
          enabled={true} 
          mouseButtons={{
            LEFT: undefined as unknown as THREE.MOUSE,
            MIDDLE: THREE.MOUSE.ROTATE,
            RIGHT: THREE.MOUSE.PAN
          }}
        />
      </Canvas>
    </div>
  );
};

export default PreviewScene;