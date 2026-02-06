# SkyFlow Designer

SkyFlow Designer 是一款基于 Web 的专业工具，用于创建动态天空盒流动贴图（Flowmaps）。它支持导入天空纹理、实时绘制流向矢量，并在 3D 场景中即时预览动画效果。非常适合为游戏引擎（如 Unity、Unreal、Godot 等）创建动态天空效果。

## 主要功能

- 🎨 **流动绘制**：直观的笔刷和橡皮擦工具，用于定义流动的方向和强度。
- 🖼️ **纹理支持**：支持导入自定义天空盒图像（等距柱状投影/全景图）。
- 🔄 **实时预览**：在球体上即时可视化流动效果，可调节速度和扭曲程度。
- 🛠️ **高级工具**：
  - 全局风向控制。
  - 支持极坐标和等距柱状投影模式，方便在两极进行精确绘制。
  - 非破坏性的全局模糊处理。
  - 可视化辅助工具（参考图叠加、箭头流向显示）。
- 📤 **导出**：生成并下载流动贴图（支持标准或反转通道）。

## 技术栈

- **框架**：React + Vite
- **3D 引擎**：Three.js / React Three Fiber
- **样式**：TailwindCSS
- **图标**：Lucide React

## 快速开始

### 前置条件

- Node.js (推荐 v18 或更高版本)

### 安装步骤

1. 克隆仓库：
   ```bash
   git clone https://github.com/1to3fall5/skyflow-designer.git
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 启动开发服务器：
   ```bash
   npm run dev
   ```

4. 在浏览器中访问 `http://localhost:5173`。

## 部署

本项目是一个静态 Web 应用，可以轻松部署到任何静态托管服务。

### 推荐平台
- **腾讯云 EdgeOne Pages**
- **Vercel**
- **Netlify**
- **GitHub Pages**

### 构建

构建生产版本：

```bash
npm run build
```

构建后的文件将生成在 `dist` 目录中。

## 许可证

MIT
