// 宿命公牌 (Dora Hold'em) - 房间管理路由

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { roomManager } from '../room/roomManager.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dora_holdem_secret_key_2026';

function getUserIdFromAuth(req: any): number {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }
  const token = authHeader.substring(7);
  const decoded: any = jwt.verify(token, JWT_SECRET);
  return decoded.userId;
}

// 创建新房间
router.post('/', async (req, res) => {
  try {
    const userId = getUserIdFromAuth(req);
    const { maxPlayers, totalRounds, password } = req.body;

    const playersCount = Number(maxPlayers) || 4;
    const rounds = Number(totalRounds) || playersCount;

    if (playersCount < 2 || playersCount > 5) {
      return res.status(400).json({ error: 'Player count must be between 2 and 5' });
    }

    if (rounds % playersCount !== 0) {
      return res.status(400).json({
        error: `Total rounds (${rounds}) must be an exact multiple of player count (${playersCount}) to ensure equal dealer rotations.`,
      });
    }

    const room = roomManager.createRoom(userId, playersCount, rounds, password || undefined);
    res.json(room.getPublicRoomInfo());
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 查询大厅等待中的公开房间
router.get('/', (req, res) => {
  try {
    const list = roomManager.listPublicRooms();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 查询指定房间信息
router.get('/:code', (req, res) => {
  try {
    const room = roomManager.getRoom(req.params.code);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json(room.getPublicRoomInfo());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

