// 宿命公牌 (Dora Hold'em) - 后端服务总入口

import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import statsRoutes from './routes/stats.js';
import handsRoutes from './routes/hands.js';
import roomsRoutes from './routes/rooms.js';
import { DoraWebSocketServer } from './websocket/server.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API 路由注册
app.use('/api/auth', authRoutes);
app.use('/api/users', statsRoutes);
app.use('/api/hands', handsRoutes);
app.use('/api/rooms', roomsRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    game: "Dora Hold'em (宿命公牌)",
    version: '1.0.0',
    timestamp: Date.now(),
  });
});

// 托管前端静态资源（兼容从根目录、server 目录或打包产物目录启动）
const possibleDistPaths = [
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
  typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../../client/dist') : '',
  typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../client/dist') : '',
].filter(Boolean);

const clientDistPath = possibleDistPaths.find(p => fs.existsSync(p));

if (clientDistPath) {
  console.log(`[Static] Serving frontend SPA from ${clientDistPath}`);
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  console.warn('[Static] Warning: client/dist not found. Please run "npm run build" to build frontend SPA.');
}

const server = http.createServer(app);

// 挂载 WebSocket 实时权威游戏服务器
new DoraWebSocketServer(server);

server.listen(port, () => {
  console.log(`=======================================================`);
  console.log(`🎴 Dora Hold'em Game Server running on port ${port}`);
  console.log(`🌐 HTTP API: http://localhost:${port}/api/health`);
  console.log(`⚡ WebSocket: ws://localhost:${port}/ws`);
  console.log(`=======================================================`);
});
