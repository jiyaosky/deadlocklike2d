// 敌方/队友英雄 Bot 控制器
import type { Controller } from '../entities/Hero';
import { makeController } from '../entities/Hero';
import type { Hero } from '../entities/Hero';
import type { Unit } from '../entities/Unit';
import type { Tower } from '../entities/Tower';
import type { Game } from '../core/Game';
import { norm, dist } from '../core/vec';
import { LANE_Y } from '../data/constants';

export class BotController {
  c: Controller = makeController();
  private thinkTimer = 0;
  private goal: { x: number; y: number };
  private retreating = false;

  constructor() {
    // 初始目标设为兵线中点，避免开局往家里跑
    this.goal = { x: 2200, y: LANE_Y };
  }

  update(game: Game, hero: Hero, dt: number): Controller {
    this.thinkTimer -= dt;
    const ownBaseX = hero.team === 0 ? 480 : 3920;
    const enemyBaseX = hero.team === 0 ? 3920 : 480;
    const hpFrac = hero.hp / hero.maxHp;

    // 撤退 / 再战决策（带滞回，避免来回抖动）
    if (this.retreating) {
      if (hpFrac >= 0.7) this.retreating = false;
    } else if (hpFrac < 0.25) {
      this.retreating = true;
    }

    // 索敌：优先敌方英雄，其次小兵；推塔需有友方小兵掩护；基地进入射程才打
    const enemyHero = game.nearestEnemy(hero.team, hero.pos, 800, false, 'hero');
    const enemyMinion = game.nearestEnemy(hero.team, hero.pos, 700, true, 'minion');
    const hasAllyMinion = this.hasAllyMinionNear(game, hero, 520);
    const enemyTowerAhead = game.nearestEnemy(hero.team, hero.pos, 720, false, 'tower') as Tower | null;
    const enemyBase = game.nearestEnemy(hero.team, hero.pos, hero.heroDef.weapon.range + 60, false, 'base');

    let target: Unit | null = null;
    if (!this.retreating) {
      target = enemyHero ?? enemyMinion ?? (hasAllyMinion ? enemyTowerAhead : null) ?? enemyBase;
    }

    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.2 + Math.random() * 0.15;
      if (this.retreating) {
        // 回基地：走兵线，别卡在角落
        this.goal = { x: ownBaseX, y: hero.pos.y * 0.3 + LANE_Y * 0.7 };
      } else if (target) {
        this.goal = this.keepDistanceGoal(hero, target);
      } else if (enemyTowerAhead && !hasAllyMinion) {
        // 前方有塔但没有小兵掩护：在塔射程外等待，不要送
        const dir = norm({ x: hero.pos.x - enemyTowerAhead.pos.x, y: hero.pos.y - enemyTowerAhead.pos.y });
        this.goal = {
          x: enemyTowerAhead.pos.x + dir.x * (enemyTowerAhead.range + 140),
          y: enemyTowerAhead.pos.y + dir.y * (enemyTowerAhead.range + 140),
        };
      } else {
        // 无目标：沿兵线向敌方基地推进
        this.goal = { x: enemyBaseX, y: LANE_Y + (Math.random() - 0.5) * 120 };
      }
    }

    // 移动
    const moveDir = norm({ x: this.goal.x - hero.pos.x, y: this.goal.y - hero.pos.y });
    const arrived = dist(hero.pos, this.goal) < 30;
    this.c.move = arrived ? { x: 0, y: 0 } : moveDir;

    // 瞄准
    const aimTarget = target && !this.retreating ? target.pos : { x: enemyBaseX, y: LANE_Y };
    this.c.aim = { x: aimTarget.x + (Math.random() - 0.5) * 40, y: aimTarget.y + (Math.random() - 0.5) * 40 };

    // 射击
    const inRange = target && !this.retreating && dist(hero.pos, target.pos) <= hero.heroDef.weapon.range;
    this.c.shoot = !!inRange && hero.ink > hero.heroDef.weapon.inkCost;

    // 低墨潜水回墨
    this.c.dive = hero.ink < 25 && hero.isOnOwnInk(game);

    // 近战（近战英雄贴脸）
    this.c.melee = !this.retreating && !!target && dist(hero.pos, target.pos) < hero.heroDef.melee.range * 1.1;

    // 跳跃
    if (Math.random() < dt * 0.6) this.c.jump = true;

    // 技能
    if (!this.retreating && target) {
      for (let i = 0; i < 3; i++) {
        const sk = hero.heroDef.skills[i];
        if (hero.skillCooldowns[i] <= 0 && hero.ink >= sk.inkCost && dist(hero.pos, target.pos) < 600) {
          this.c.skills[i] = true;
        }
      }
    }
    if (hero.ultCharge >= 1 && target && dist(hero.pos, target.pos) < 400) {
      this.c.skills[3] = true;
    }

    return this.c;
  }

  // 接战距离：远程保持武器射程，近战/肉盾贴脸
  private keepDistanceGoal(hero: Hero, target: Unit): { x: number; y: number } {
    const keep = hero.heroDef.role === 'ranger' ? hero.heroDef.weapon.range * 0.75 : hero.heroDef.melee.range * 0.85;
    const d = dist(hero.pos, target.pos);
    const dir = norm({ x: target.pos.x - hero.pos.x, y: target.pos.y - hero.pos.y });
    if (d < keep * 0.9) {
      return { x: hero.pos.x - dir.x * (keep - d), y: hero.pos.y - dir.y * (keep - d) };
    }
    if (d > keep * 1.1) {
      return { x: hero.pos.x + dir.x * Math.min(keep, d - keep), y: hero.pos.y + dir.y * Math.min(keep, d - keep) };
    }
    return { ...hero.pos };
  }

  private hasAllyMinionNear(game: Game, hero: Hero, range: number): boolean {
    for (const m of game.minions) {
      if (m.team === hero.team && m.alive && dist(m.pos, hero.pos) < range) return true;
    }
    return false;
  }
}
