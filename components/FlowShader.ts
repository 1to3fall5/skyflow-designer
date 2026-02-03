import * as THREE from 'three';

// Create a simple 1x1 grey pixel texture for initialization
const createPlaceholderTexture = () => {
  const data = new Uint8Array([128, 128, 128, 255]);
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
};

export const FlowShaderMaterial = {
  uniforms: {
    uTime: { value: 0 },
    uTexture: { value: createPlaceholderTexture() },
    uFlowMap: { value: createPlaceholderTexture() },
    uSpeed: { value: 0.2 },
    uDistortionStrength: { value: 0.1 },
    // Cursor uniforms
    uCursor: { value: new THREE.Vector2(0, 0) },
    uBrushSize: { value: 0.02 },
    uShowCursor: { value: 0.0 }, // 0.0 = false, 1.0 = true
    // Projection: 0.0 = Equirectangular, 1.0 = Polar
    uProjectionType: { value: 0.0 },
    // Polar Coverage Angle in Radians (PI/2 for Hemisphere, PI for Full Sphere)
    uPolarAngle: { value: Math.PI / 2 },
    uShowFlowMap: { value: 0.0 }, // 0.0 = false, 1.0 = true
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform sampler2D uTexture;
    uniform sampler2D uFlowMap;
    uniform float uSpeed;
    uniform float uDistortionStrength;
    
    // Cursor
    uniform vec2 uCursor;
    uniform float uBrushSize;
    uniform float uShowCursor;
    uniform float uProjectionType;
    uniform float uPolarAngle;
    uniform float uShowFlowMap;
    
    varying vec2 vUv;

    // Convert Sphere UV (Equirectangular) to Sampling UV (Polar or Equirectangular)
    vec2 getSamplingUV(vec2 sphereUV) {
        if (uProjectionType > 0.5) {
            // Polar / Fisheye Mapping
            // Sphere UV: v=1 is Zenith (Center)
            // Phi goes from 0 (Zenith) to PI (Nadir)
            float phi = (1.0 - sphereUV.y) * 3.14159265;
            float theta = sphereUV.x * 2.0 * 3.14159265;
            
            // Map Phi to Radius
            // We want the edge of the image (r=0.5) to correspond to uPolarAngle.
            // r = (phi / uPolarAngle) * 0.5
            float r = (phi / uPolarAngle) * 0.5;
            
            // Convert polar to cartesian centered at 0.5, 0.5
            float x = r * sin(theta);
            float y = r * cos(theta);
            
            return vec2(0.5 + x, 0.5 + y);
        } else {
            // Equirectangular (Default)
            return sphereUV;
        }
    }

    void main() {
      // Calculate actual sampling coordinate based on projection
      vec2 baseUV = getSamplingUV(vUv);
      
      // Sample flow map (vectors stored in R and G channels)
      // Neutral is 0.5 (128/255). 
      // Map [0, 1] back to [-1, 1] direction.
      vec4 flowColor = texture2D(uFlowMap, baseUV);
      vec2 flowDir = (flowColor.rg - 0.5) * 2.0;

      // Make the flow loop seamlessly using two phases
      float progress1 = fract(uTime * uSpeed);
      float progress2 = fract(uTime * uSpeed + 0.5);
      
      // Offset UVs based on flow direction and time
      vec2 uv1 = baseUV + flowDir * progress1 * uDistortionStrength;
      vec2 uv2 = baseUV + flowDir * progress2 * uDistortionStrength;
      
      // Sample the actual texture twice
      vec4 col1 = texture2D(uTexture, uv1);
      vec4 col2 = texture2D(uTexture, uv2);
      
      // Blend based on the phase to hide the reset pop
      // The mix factor creates a triangle wave oscillation
      float mixFactor = abs(progress1 - 0.5) * 2.0;
      
      // Final color
      vec4 finalColor = mix(col1, col2, mixFactor);
      
      // Masking for Polar: Black out everything outside the valid radius
      if (uProjectionType > 0.5) {
          float dist = distance(baseUV, vec2(0.5));
          if (dist > 0.5) finalColor = vec4(0.0, 0.0, 0.0, 1.0);
      }
      
      // --- Flow Map Overlay ---
      if (uShowFlowMap > 0.5) {
          // Show the flow map colors (0..1) directly
          // R = Flow X, G = Flow Y, B = 0, A = 1
          vec4 overlayColor = vec4(flowColor.rgb, 1.0);
          
          // Blend it with the sky texture (e.g. 50% opacity)
          // Or show it fully? Usually for debugging 50-70% is good
          finalColor = mix(finalColor, overlayColor, 0.6);
      }

      // --- Cursor Visualization ---
      if (uShowCursor > 0.5) {
        // uCursor is passed in as the *Transformed* UV from raycasting
        float dist = distance(baseUV, uCursor);
        
        // Simple single thin ring
        float ringWidth = 0.001;
        float ringAlpha = smoothstep(ringWidth + 0.001, ringWidth, abs(dist - uBrushSize));

        // No fill to avoid obstruction
        
        // Mix White Ring
        finalColor.rgb = mix(finalColor.rgb, vec3(1.0), ringAlpha);
      }
      
      gl_FragColor = finalColor;

      #include <colorspace_fragment>
    }
  `
};

export const ArrowShaderMaterial = {
  uniforms: {
    uFlowMap: { value: createPlaceholderTexture() },
    uGridSize: { value: new THREE.Vector2(64, 32) }, // Increased density for fluid look
    uColor: { value: new THREE.Color('#fbbf24') }, // Amber-400
    uProjectionType: { value: 0.0 },
    uPolarAngle: { value: Math.PI / 2 },
  },
  transparent: true,
  depthWrite: false, // Don't block background
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D uFlowMap;
    uniform vec2 uGridSize;
    uniform vec3 uColor;
    uniform float uProjectionType;
    uniform float uPolarAngle;
    
    varying vec2 vUv;
    
    // Copy of helper (could be shared, but inlined for simplicity)
    vec2 getSamplingUV(vec2 sphereUV) {
        if (uProjectionType > 0.5) {
            float phi = (1.0 - sphereUV.y) * 3.14159265;
            float theta = sphereUV.x * 2.0 * 3.14159265;
            // r = (phi / uPolarAngle) * 0.5
            float r = (phi / uPolarAngle) * 0.5;
            float x = r * sin(theta);
            float y = r * cos(theta);
            return vec2(0.5 + x, 0.5 + y);
        } else {
            return sphereUV;
        }
    }

    void main() {
      // 1. Determine Grid Cell based on Spherical Layout?
      vec2 gridUV = vUv * uGridSize;
      vec2 cellIndex = floor(gridUV);
      vec2 cellLocal = fract(gridUV) - 0.5; // [-0.5, 0.5]

      // 2. Sample Flow at center of cell
      vec2 cellCenterSphereUV = (cellIndex + 0.5) / uGridSize;
      
      // TRANSFORM: Map sphere UV to texture UV to read flow
      vec2 texUV = getSamplingUV(cellCenterSphereUV);
      
      // Check mask
      if (uProjectionType > 0.5 && distance(texUV, vec2(0.5)) > 0.5) discard;
      
      vec4 flowVal = texture2D(uFlowMap, texUV);
      
      // 3. Decode Flow
      // Our painter produces 0..1. 0.5 is neutral.
      // Flow vector in shader logic (UV offset):
      vec2 flow = (flowVal.rg - 0.5) * 2.0;
      
      // VISUALIZATION LOGIC:
      // The flow vector is in Texture Space.
      // If projection is Polar, we must rotate this vector to align with Sphere Surface Space (East/North).
      
      vec2 visualDir = -flow; // Initial visual direction in Texture Space
      
      if (uProjectionType > 0.5) {
          // Rotate from Texture Space to Sphere Surface Space
          // Theta is Longitude angle.
          // sphereUV.x is 0..1, maps to 0..2PI.
          
          float theta = cellCenterSphereUV.x * 2.0 * 3.14159265;
          float c = cos(theta);
          float s = sin(theta);
          
          // Transformation:
          // U_sphere = F_x * cos(theta) - F_y * sin(theta)
          // V_sphere = -(F_x * sin(theta) + F_y * cos(theta))
          
          float u_sphere = visualDir.x * c - visualDir.y * s;
          float v_sphere = -(visualDir.x * s + visualDir.y * c);
          
          visualDir = vec2(u_sphere, v_sphere);
      }
      
      float mag = length(visualDir);

      // Threshold to show arrow
      if (mag < 0.02) {
        discard;
      }

      // 4. Rotate CellLocal based on flow direction
      float angle = atan(visualDir.y, visualDir.x);
      float c = cos(angle);
      float s = sin(angle);
      // Inverse rotation to align space with arrow direction
      vec2 rotatedUV = cellLocal * mat2(c, s, -s, c); 

      // 5. Draw Thin Line Arrow (Fluid Style)
      float thickness = 0.005; 
      float len = min(0.4, mag * 0.8 + 0.1); 
      
      float dShaft = max(abs(rotatedUV.y) - thickness, abs(rotatedUV.x) - len);
      
      // Head
      vec2 tip = vec2(len, 0.0);
      vec2 p = rotatedUV;
      
      vec2 wingEnd = vec2(len - 0.15, 0.15);
      vec2 v = wingEnd - tip;
      vec2 w = p - tip;
      float h = clamp(dot(w, v) / dot(v, v), 0.0, 1.0);
      float dWing1 = length(w - v * h) - thickness;
      
      vec2 wingEnd2 = vec2(len - 0.15, -0.15);
      vec2 v2 = wingEnd2 - tip;
      float h2 = clamp(dot(w, v2) / dot(v2, v2), 0.0, 1.0);
      float dWing2 = length(w - v2 * h2) - thickness;
      
      float dArrow = min(dShaft, min(dWing1, dWing2));
      
      float alpha = 1.0 - smoothstep(0.0, 0.02, dArrow);
      
      if (alpha < 0.1) discard;

      float opacity = min(1.0, mag * 3.0);
      
      gl_FragColor = vec4(uColor, alpha * opacity);

      #include <colorspace_fragment>
    }
  `
};
