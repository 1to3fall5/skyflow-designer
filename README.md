# SkyFlow Designer

SkyFlow Designer is a professional web-based tool for creating dynamic skybox flowmaps. It allows you to import sky textures, paint directional flow vectors in real-time, and preview the animated results in 3D. Perfect for creating dynamic skies for game engines (Unity, Unreal, Godot, etc.).

## Features

- 🎨 **Flow Painting**: Intuitive brush and eraser tools to define flow direction and intensity.
- 🖼️ **Texture Support**: Import custom skybox images (Equirectangular/Panorama).
- 🔄 **Real-time Preview**: Instant 3D visualization of flow effects on a sphere with adjustable speed and distortion.
- 🛠️ **Advanced Tools**:
  - Global wind direction control.
  - Polar & Equirectangular projection modes for accurate pole painting.
  - Non-destructive global blur.
  - Visual helpers (Reference overlay, Arrow visualization).
- 📤 **Export**: Generate and download flowmaps (standard or inverted channels).

## Tech Stack

- **Framework**: React + Vite
- **3D Engine**: Three.js / React Three Fiber
- **Styling**: TailwindCSS
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js (v18 or later recommended)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/1to3fall5/skyflow-designer.git
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and visit `http://localhost:5173`.

## Deployment

This project is a static web application and can be easily deployed to any static hosting service.

### Recommended Platforms
- **Tencent Cloud EdgeOne Pages**
- **Vercel**
- **Netlify**
- **GitHub Pages**

### Build

To build for production:

```bash
npm run build
```

The output will be in the `dist` directory.

## License

MIT
