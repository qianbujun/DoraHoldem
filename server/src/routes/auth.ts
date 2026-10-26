// 宿命公牌 (Dora Hold'em) - 用户认证路由

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbService } from '../db/database.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dora_holdem_secret_key_2026';

// 注册
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, preferred_lang } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }

    const existing = await dbService.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await dbService.createUser(
      email,
      username,
      passwordHash,
      preferred_lang || 'zh-CN'
    );

    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        preferred_lang: user.preferred_lang,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await dbService.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        preferred_lang: user.preferred_lang,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 获取当前用户信息
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.substring(7);
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const user = await dbService.findUserById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      preferred_lang: user.preferred_lang,
    });
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// 更新个人信息（昵称、语言偏好）
router.put('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.substring(7);
    const decoded: any = jwt.verify(token, JWT_SECRET);

    const { username, preferred_lang } = req.body;
    await dbService.updateUserProfile(decoded.userId, username, preferred_lang);

    res.json({ success: true, username, preferred_lang });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

