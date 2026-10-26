// 宿命公牌 (Dora Hold'em) - 数据库服务层 (MySQL 8.0+ 适配与内存降级支持)

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

export interface UserRow {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  preferred_lang: string;
  created_at: string;
}

export interface PositionStatRow {
  user_id: number;
  seat_position: number;
  play_count: number;
  wins: number;
  total_win_score: number;
  win_rate: number;
  avg_win_score: number;
}

export interface HandRecordSummary {
  id: number;
  hand_id: number;
  round_number: number;
  room_code?: string;
  seat_position: number;
  is_dealer: boolean;
  dora_rank: string;
  initial_dora_card: string;
  final_orbit: number;
  base_score: number;
  end_reason: string;
  is_winner: boolean;
  is_folded: boolean;
  net_score: number;
  is_favorite: boolean;
  favorite_at?: string;
  created_at: string;
}

class DatabaseService {
  private pool: mysql.Pool | null = null;
  public isUsingMySQL: boolean = false;

  // 内存备份存储 (当本地未启动 MySQL 时自动无缝降级，确保本地开发测试开箱即用)
  private memoryUsers: Map<number, UserRow> = new Map();
  private memoryPositionStats: Map<string, PositionStatRow> = new Map();
  private memoryHandRecords: Map<number, any> = new Map();
  private memoryUserHandRecords: Map<number, any> = new Map();
  private userIdCounter = 1;
  private handIdCounter = 1;
  private uhrIdCounter = 1;

  constructor() {
    this.init();
  }

  private async init() {
    const host = process.env.DB_HOST || 'localhost';
    const port = Number(process.env.DB_PORT || 3306);
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_NAME || 'dora_holdem';

    try {
      this.pool = mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0,
      });

      // 测试连接
      const conn = await this.pool.getConnection();
      await conn.ping();
      conn.release();
      this.isUsingMySQL = true;
      console.log(`[DB] Connected successfully to MySQL 8.0 at ${host}:${port}/${database}`);
    } catch (err: any) {
      console.warn(`[DB] MySQL connection not available (${err.message}). Using high-performance in-memory fallback store for local development.`);
      this.isUsingMySQL = false;
      this.pool = null;
    }
  }

  // --- 用户操作 ---
  async createUser(email: string, username: string, passwordHash: string, preferredLang: string = 'zh-CN'): Promise<UserRow> {
    if (this.isUsingMySQL && this.pool) {
      const [res]: any = await this.pool.execute(
        `INSERT INTO users (email, username, password_hash, preferred_lang) VALUES (?, ?, ?, ?)`,
        [email, username, passwordHash, preferredLang]
      );
      return {
        id: res.insertId,
        email,
        username,
        password_hash: passwordHash,
        preferred_lang: preferredLang,
        created_at: new Date().toISOString(),
      };
    } else {
      for (const u of this.memoryUsers.values()) {
        if (u.email === email) {
          throw new Error('Email already registered');
        }
      }
      const user: UserRow = {
        id: this.userIdCounter++,
        email,
        username,
        password_hash: passwordHash,
        preferred_lang: preferredLang,
        created_at: new Date().toISOString(),
      };
      this.memoryUsers.set(user.id, user);
      return user;
    }
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.execute(`SELECT * FROM users WHERE email = ? LIMIT 1`, [email]);
      return rows[0] || null;
    } else {
      for (const u of this.memoryUsers.values()) {
        if (u.email === email) return u;
      }
      return null;
    }
  }

  async findUserById(id: number): Promise<UserRow | null> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.execute(`SELECT * FROM users WHERE id = ? LIMIT 1`, [id]);
      return rows[0] || null;
    } else {
      return this.memoryUsers.get(id) || null;
    }
  }

  async updateUserProfile(id: number, username: string, preferredLang: string): Promise<void> {
    if (this.isUsingMySQL && this.pool) {
      await this.pool.execute(
        `UPDATE users SET username = ?, preferred_lang = ? WHERE id = ?`,
        [username, preferredLang, id]
      );
    } else {
      const user = this.memoryUsers.get(id);
      if (user) {
        user.username = username;
        user.preferred_lang = preferredLang;
      }
    }
  }

  // --- 位置战绩系统 (1~5号位) ---
  async getUserPositionStats(userId: number): Promise<PositionStatRow[]> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.execute(
        `SELECT user_id, seat_position, play_count, wins, total_win_score,
                win_rate, avg_win_score
         FROM user_position_stats
         WHERE user_id = ?
         ORDER BY seat_position ASC`,
        [userId]
      );
      // 补齐 1~5 号位未有数据的占位
      const result: PositionStatRow[] = [];
      for (let pos = 1; pos <= 5; pos++) {
        const found = rows.find((r: any) => r.seat_position === pos);
        if (found) {
          result.push({
            user_id: userId,
            seat_position: pos,
            play_count: Number(found.play_count),
            wins: Number(found.wins),
            total_win_score: Number(found.total_win_score),
            win_rate: Number(found.win_rate),
            avg_win_score: Number(found.avg_win_score),
          });
        } else {
          result.push({
            user_id: userId,
            seat_position: pos,
            play_count: 0,
            wins: 0,
            total_win_score: 0,
            win_rate: 0,
            avg_win_score: 0,
          });
        }
      }
      return result;
    } else {
      const result: PositionStatRow[] = [];
      for (let pos = 1; pos <= 5; pos++) {
        const key = `${userId}_${pos}`;
        const found = this.memoryPositionStats.get(key);
        if (found) {
          result.push(found);
        } else {
          result.push({
            user_id: userId,
            seat_position: pos,
            play_count: 0,
            wins: 0,
            total_win_score: 0,
            win_rate: 0,
            avg_win_score: 0,
          });
        }
      }
      return result;
    }
  }

  async recordPositionResult(userId: number, seatPosition: number, isWinner: boolean, winScore: number): Promise<void> {
    const scoreToAdd = isWinner && winScore > 0 ? winScore : 0;
    const winsToAdd = isWinner ? 1 : 0;

    if (this.isUsingMySQL && this.pool) {
      await this.pool.execute(
        `INSERT INTO user_position_stats (user_id, seat_position, play_count, wins, total_win_score)
         VALUES (?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE
           play_count = play_count + 1,
           wins = wins + ?,
           total_win_score = total_win_score + ?`,
        [userId, seatPosition, winsToAdd, scoreToAdd, winsToAdd, scoreToAdd]
      );
    } else {
      const key = `${userId}_${seatPosition}`;
      const stat = this.memoryPositionStats.get(key) || {
        user_id: userId,
        seat_position: seatPosition,
        play_count: 0,
        wins: 0,
        total_win_score: 0,
        win_rate: 0,
        avg_win_score: 0,
      };
      stat.play_count += 1;
      stat.wins += winsToAdd;
      stat.total_win_score += scoreToAdd;
      stat.win_rate = stat.play_count > 0 ? Number((stat.wins / stat.play_count).toFixed(4)) : 0;
      stat.avg_win_score = stat.wins > 0 ? Number((stat.total_win_score / stat.wins).toFixed(2)) : 0;
      this.memoryPositionStats.set(key, stat);
    }
  }

  // 校准与重算指定玩家的 1~5 号位战绩（用于纠正早期历史数据）
  async recalibrateUserPositionStats(userId: number): Promise<PositionStatRow[]> {
    if (this.isUsingMySQL && this.pool) {
      try {
        // 1. 如果历史记录中 seat_position 未做相对换算（例如两人对局中 is_dealer=0 却记为1），进行自动纠正
        await this.pool.execute(
          `UPDATE user_hand_records uhr
           JOIN hand_records hr ON uhr.hand_id = hr.id
           SET uhr.seat_position = CASE 
             WHEN uhr.is_dealer = 1 THEN 1 
             WHEN hr.player_count = 2 THEN 2
             ELSE uhr.seat_position 
           END
           WHERE uhr.user_id = ?`,
          [userId]
        );

        // 2. 清理旧位置聚合表
        await this.pool.execute(`DELETE FROM user_position_stats WHERE user_id = ?`, [userId]);

        // 3. 重新聚合写入
        await this.pool.execute(
          `INSERT INTO user_position_stats (user_id, seat_position, play_count, wins, total_win_score)
           SELECT 
             user_id, 
             seat_position, 
             COUNT(*) as play_count,
             SUM(CASE WHEN is_winner = 1 THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN is_winner = 1 AND net_score > 0 THEN net_score ELSE 0 END) as total_win_score
           FROM user_hand_records
           WHERE user_id = ?
           GROUP BY user_id, seat_position`,
          [userId]
        );
      } catch (e) {
        console.error('Failed to recalibrate user position stats in MySQL:', e);
      }
    } else {
      // 内存模式下：重新按 memoryUserHandRecords 聚合
      const userHands = Array.from(this.memoryUserHandRecords.values()).filter(r => r.user_id === userId);
      for (let pos = 1; pos <= 5; pos++) {
        this.memoryPositionStats.delete(`${userId}_${pos}`);
      }
      for (const uh of userHands) {
        let pos = uh.seat_position;
        if (!uh.is_dealer && pos === 1) {
          pos = 2;
          uh.seat_position = 2;
        }
        await this.recordPositionResult(userId, pos, uh.is_winner, uh.net_score);
      }
    }

    return this.getUserPositionStats(userId);
  }

  // --- 牌谱存储与 50 滚动清理 / 50 收藏机制 ---
  async saveHandRecord(
    handData: {
      room_id?: number;
      round_number: number;
      player_count: number;
      dealer_user_id: number;
      dora_rank: string;
      initial_dora_card: string;
      final_community_cards: string[];
      final_orbit: number;
      base_score: number;
      total_pot: number;
      end_reason: string;
      action_history: any;
    },
    userResults: {
      user_id: number;
      seat_position: number;
      is_dealer: boolean;
      initial_hole_cards: string[];
      exposed_cards: string[];
      final_best_hand?: any;
      hand_category?: string;
      dora_count: number;
      is_folded: boolean;
      fold_orbit?: number;
      is_winner: boolean;
      net_score: number;
    }[]
  ): Promise<number> {
    if (this.isUsingMySQL && this.pool) {
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();

        // 插入母表
        const dealerId = handData.dealer_user_id > 0 ? handData.dealer_user_id : 0;
        const [res]: any = await conn.execute(
          `INSERT INTO hand_records 
            (room_id, round_number, player_count, dealer_user_id, dora_rank, initial_dora_card,
             final_community_cards, final_orbit, base_score, total_pot, end_reason, action_history)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            handData.room_id || null,
            handData.round_number,
            handData.player_count,
            dealerId,
            handData.dora_rank,
            handData.initial_dora_card,
            JSON.stringify(handData.final_community_cards),
            handData.final_orbit,
            handData.base_score,
            handData.total_pot,
            handData.end_reason,
            JSON.stringify(handData.action_history),
          ]
        );
        const handId = res.insertId;

        // 插入子表 (仅持久化真实玩家数据，跳过 AI 机器人负数 ID)
        for (const ur of userResults) {
          if (ur.user_id <= 0) continue;
          await conn.execute(
            `INSERT INTO user_hand_records
              (user_id, hand_id, seat_position, is_dealer, initial_hole_cards, exposed_cards,
               final_best_hand, hand_category, dora_count, is_folded, fold_orbit, is_winner, net_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              ur.user_id,
              handId,
              ur.seat_position,
              ur.is_dealer ? 1 : 0,
              JSON.stringify(ur.initial_hole_cards),
              JSON.stringify(ur.exposed_cards),
              ur.final_best_hand ? JSON.stringify(ur.final_best_hand) : null,
              ur.hand_category || null,
              ur.dora_count,
              ur.is_folded ? 1 : 0,
              ur.fold_orbit || null,
              ur.is_winner ? 1 : 0,
              ur.net_score,
            ]
          );

          // 更新每个玩家的位置胜率战绩
          await this.recordPositionResult(ur.user_id, ur.seat_position, ur.is_winner, ur.net_score);

          // 执行 50 场最近记录 FIFO 滚动清理 (存储过程)
          try {
            await conn.query(`CALL sp_prune_user_hand_history(?)`, [ur.user_id]);
          } catch (e) {
            // 若存储过程尚未创建，执行等价内联清理逻辑
            await conn.execute(
              `DELETE FROM user_hand_records 
               WHERE user_id = ? AND is_favorite = 0 
               AND id NOT IN (
                 SELECT keep_id FROM (
                   SELECT id AS keep_id FROM user_hand_records 
                   WHERE user_id = ? AND is_favorite = 0 
                   ORDER BY created_at DESC, id DESC LIMIT 50
                 ) t
               )`,
              [ur.user_id, ur.user_id]
            );
          }
        }

        await conn.commit();
        return handId;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } else {
      // 内存存储逻辑
      const handId = this.handIdCounter++;
      const handRecord = {
        id: handId,
        ...handData,
        created_at: new Date().toISOString(),
      };
      this.memoryHandRecords.set(handId, handRecord);

      for (const ur of userResults) {
        if (ur.user_id <= 0) continue;
        const uhrId = this.uhrIdCounter++;
        const uhr = {
          id: uhrId,
          hand_id: handId,
          ...ur,
          is_favorite: false,
          favorite_at: null,
          created_at: new Date().toISOString(),
        };
        this.memoryUserHandRecords.set(uhrId, uhr);

        // 更新位置战绩
        await this.recordPositionResult(ur.user_id, ur.seat_position, ur.is_winner, ur.net_score);

        // 内存中执行 50 条最近记录保留清理
        const userUnfavs = Array.from(this.memoryUserHandRecords.values())
          .filter(r => r.user_id === ur.user_id && !r.is_favorite)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        if (userUnfavs.length > 50) {
          const toRemove = userUnfavs.slice(50);
          for (const rem of toRemove) {
            this.memoryUserHandRecords.delete(rem.id);
          }
        }
      }

      return handId;
    }
  }

  async getUserHandList(userId: number, favoriteOnly: boolean = false): Promise<HandRecordSummary[]> {
    if (this.isUsingMySQL && this.pool) {
      const sql = favoriteOnly
        ? `SELECT uhr.id, uhr.hand_id, hr.round_number, uhr.seat_position, uhr.is_dealer,
                  hr.dora_rank, hr.initial_dora_card, hr.final_orbit, hr.base_score, hr.end_reason,
                  uhr.is_winner, uhr.is_folded, uhr.net_score, uhr.is_favorite, uhr.favorite_at, uhr.created_at
           FROM user_hand_records uhr
           JOIN hand_records hr ON uhr.hand_id = hr.id
           WHERE uhr.user_id = ? AND uhr.is_favorite = 1
           ORDER BY uhr.favorite_at DESC, uhr.id DESC
           LIMIT 50`
        : `SELECT uhr.id, uhr.hand_id, hr.round_number, uhr.seat_position, uhr.is_dealer,
                  hr.dora_rank, hr.initial_dora_card, hr.final_orbit, hr.base_score, hr.end_reason,
                  uhr.is_winner, uhr.is_folded, uhr.net_score, uhr.is_favorite, uhr.favorite_at, uhr.created_at
           FROM user_hand_records uhr
           JOIN hand_records hr ON uhr.hand_id = hr.id
           WHERE uhr.user_id = ?
           ORDER BY uhr.created_at DESC, uhr.id DESC
           LIMIT 50`;
      const [rows]: any = await this.pool.execute(sql, [userId]);
      return rows;
    } else {
      let list = Array.from(this.memoryUserHandRecords.values()).filter(r => r.user_id === userId);
      if (favoriteOnly) {
        list = list.filter(r => r.is_favorite);
        list.sort((a, b) => new Date(b.favorite_at || 0).getTime() - new Date(a.favorite_at || 0).getTime());
      } else {
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
      return list.slice(0, 50).map(uhr => {
        const hr = this.memoryHandRecords.get(uhr.hand_id) || {};
        return {
          id: uhr.id,
          hand_id: uhr.hand_id,
          round_number: hr.round_number || 1,
          seat_position: uhr.seat_position,
          is_dealer: uhr.is_dealer,
          dora_rank: hr.dora_rank || '7',
          initial_dora_card: hr.initial_dora_card || '7s',
          final_orbit: hr.final_orbit || 1,
          base_score: hr.base_score || 0,
          end_reason: hr.end_reason || 'voluntary_showdown',
          is_winner: uhr.is_winner,
          is_folded: uhr.is_folded,
          net_score: uhr.net_score,
          is_favorite: uhr.is_favorite,
          favorite_at: uhr.favorite_at,
          created_at: uhr.created_at,
        };
      });
    }
  }

  async toggleFavoriteHand(userId: number, uhrId: number, setFavorite: boolean): Promise<boolean> {
    if (this.isUsingMySQL && this.pool) {
      if (setFavorite) {
        // 校验是否超出 50 条上限
        const [cntRows]: any = await this.pool.execute(
          `SELECT COUNT(*) as cnt FROM user_hand_records WHERE user_id = ? AND is_favorite = 1`,
          [userId]
        );
        if (cntRows[0].cnt >= 50) {
          throw new Error('FAVORITE_LIMIT_EXCEEDED');
        }
        await this.pool.execute(
          `UPDATE user_hand_records SET is_favorite = 1, favorite_at = NOW() WHERE id = ? AND user_id = ?`,
          [uhrId, userId]
        );
      } else {
        await this.pool.execute(
          `UPDATE user_hand_records SET is_favorite = 0, favorite_at = NULL WHERE id = ? AND user_id = ?`,
          [uhrId, userId]
        );
      }
      return true;
    } else {
      const uhr = this.memoryUserHandRecords.get(uhrId);
      if (!uhr || uhr.user_id !== userId) return false;

      if (setFavorite) {
        const favCount = Array.from(this.memoryUserHandRecords.values()).filter(
          r => r.user_id === userId && r.is_favorite
        ).length;
        if (favCount >= 50) {
          throw new Error('FAVORITE_LIMIT_EXCEEDED');
        }
        uhr.is_favorite = true;
        uhr.favorite_at = new Date().toISOString();
      } else {
        uhr.is_favorite = false;
        uhr.favorite_at = null;
      }
      return true;
    }
  }

  async getHandDetail(handId: number): Promise<any | null> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.execute(`SELECT * FROM hand_records WHERE id = ?`, [handId]);
      if (!rows[0]) return null;
      const hr = rows[0];
      const parsedCommunity = typeof hr.final_community_cards === 'string' ? JSON.parse(hr.final_community_cards) : hr.final_community_cards;
      const parsedHistory = typeof hr.action_history === 'string' ? JSON.parse(hr.action_history) : hr.action_history;

      let actions = [];
      let settlement = null;
      let playerHands = [];

      if (parsedHistory && typeof parsedHistory === 'object' && !Array.isArray(parsedHistory)) {
        actions = parsedHistory.actions || [];
        settlement = parsedHistory.settlement || null;
        playerHands = parsedHistory.playerHands || [];
      } else if (Array.isArray(parsedHistory)) {
        actions = parsedHistory;
      }

      // 查询 user_hand_records 查漏补缺（兼容旧牌谱或补充成牌信息）
      if (!settlement || !playerHands.length) {
        const [uhrs]: any = await this.pool.execute(
          `SELECT uhr.*, u.username
           FROM user_hand_records uhr
           LEFT JOIN users u ON uhr.user_id = u.id
           WHERE uhr.hand_id = ?`,
          [handId]
        );
        if (uhrs && uhrs.length > 0) {
          playerHands = uhrs.map((u: any) => ({
            seat: u.seat_position,
            userId: u.user_id,
            username: u.username || `Player ${u.seat_position}`,
            holeCards: typeof u.initial_hole_cards === 'string' ? JSON.parse(u.initial_hole_cards) : u.initial_hole_cards,
            exposedCards: typeof u.exposed_cards === 'string' ? JSON.parse(u.exposed_cards) : u.exposed_cards,
            isFolded: Boolean(u.is_folded),
            isWinner: Boolean(u.is_winner),
            bestHand: u.final_best_hand ? (typeof u.final_best_hand === 'string' ? JSON.parse(u.final_best_hand) : u.final_best_hand) : null,
            netScore: u.net_score,
          }));
        }
      }

      return {
        ...hr,
        final_community_cards: parsedCommunity,
        action_history: actions,
        settlement,
        player_hands: playerHands,
      };
    } else {
      const hr = this.memoryHandRecords.get(handId);
      if (!hr) return null;
      const parsedHistory = hr.action_history;
      let actions = [];
      let settlement = null;
      let playerHands = [];

      if (parsedHistory && typeof parsedHistory === 'object' && !Array.isArray(parsedHistory)) {
        actions = parsedHistory.actions || [];
        settlement = parsedHistory.settlement || null;
        playerHands = parsedHistory.playerHands || [];
      } else if (Array.isArray(parsedHistory)) {
        actions = parsedHistory;
      }

      return {
        ...hr,
        action_history: actions,
        settlement,
        player_hands: playerHands,
      };
    }
  }
}

export const dbService = new DatabaseService();
