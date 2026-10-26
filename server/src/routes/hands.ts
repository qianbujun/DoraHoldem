// 宿命公牌 (Dora Hold'em) - 单局牌谱与回放复盘路由

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { dbService } from '../db/database.js';

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

// 获取当前玩家最近 50 场单小局牌谱（FIFO 滚动队列）
router.get('/recent', async (req, res) => {
  try {
    const userId = getUserIdFromAuth(req);
    const list = await dbService.getUserHandList(userId, false);
    res.json(list);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

// 获取当前玩家收藏的单小局牌谱（上限 50 场，永久保留不受滚动清理影响）
router.get('/favorites', async (req, res) => {
  try {
    const userId = getUserIdFromAuth(req);
    const list = await dbService.getUserHandList(userId, true);
    res.json(list);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

// 收藏 / 取消收藏特定单小局记录
router.post('/:uhrId/favorite', async (req, res) => {
  try {
    const userId = getUserIdFromAuth(req);
    const uhrId = Number(req.params.uhrId);
    const { isFavorite } = req.body;

    await dbService.toggleFavoriteHand(userId, uhrId, Boolean(isFavorite));
    res.json({ success: true, isFavorite });
  } catch (err: any) {
    if (err.message === 'FAVORITE_LIMIT_EXCEEDED') {
      res.status(400).json({ error: 'FAVORITE_LIMIT_EXCEEDED', message: 'Maximum 50 favorites allowed' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// 获取单小局完整时序行动流（供前端单步/自动复盘回放器渲染）
router.get('/:handId/replay', async (req, res) => {
  try {
    const handId = Number(req.params.handId);
    const detail = await dbService.getHandDetail(handId);
    if (!detail) {
      return res.status(404).json({ error: 'Hand record not found' });
    }
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

