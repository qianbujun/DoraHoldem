// 宿命公牌 (Dora Hold'em) - 位置战绩统计路由

import { Router } from 'express';
import { dbService } from '../db/database.js';

const router = Router();

// 查询指定用户 1~5 号位战绩数据（公开权限，支持对局中点击任意玩家头像/姓名卡片弹窗查看）
router.get('/:userId/position-stats', async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ error: 'Valid userId is required' });
    }

    const user = await dbService.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const stats = await dbService.getUserPositionStats(userId);
    res.json({
      userId,
      username: user.username,
      stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 手动校准/刷新用户 1~5 号位战绩（基于历史局牌谱重新统计）
router.post('/:userId/recalibrate-stats', async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ error: 'Valid userId is required' });
    }

    const user = await dbService.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const stats = await dbService.recalibrateUserPositionStats(userId);
    res.json({
      message: 'Position stats successfully recalibrated',
      userId,
      username: user.username,
      stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

