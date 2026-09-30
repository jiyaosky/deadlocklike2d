// 小兵（近战 / 远程）
import { Unit } from './Unit';
import type { Vec2, Team, DamageType } from '../data/types';
import type { Game } from '../core/Game';
import { norm, dist, scale, fromAngle, angleOf } from '../core/vec';
import { MINION_RADIUS, DAMAGE_COLORS } from '../data/constants';

export type MinionKind = 'melee' | 'ranged';

export class Minion extends Unit {
  kind: MinionKind;
  damage: number;
  damageType: DamageType;
  attackRange: number;
  attackInterval: number;
  moveSpeed: number;
  aggroRange: number;
  bounty: number;
  targetX: number;
  attackCooldown = 0;

  constructor(team: Team, pos: Vec2, targetX: number, tier: number, kind: MinionKind = 'melee') {
    const maxHp = kind === 'melee' ? 260 + tier * 60 : 150 + tier * 40;
    super(team, pos, MINION_RADIUS, maxHp, team === 0 ? '蓝方小兵' : '红方小兵');
    this.kind = kind;
    if (kind === 'melee') {
      this.damage = 16 + tier * 4;
      this.attackRange = 90;
      this.attackInterval = 1.0;
      this.moveSpeed = 145;
    } else {
      this.damage = 11 + tier * 3;
      this.attackRange = 240; // 远程小兵射程不长
      this.attackInterval = 1.3;
      this.moveSpeed = 135;
    }
    this.damageType = 'bullet';
    this.aggroRange = 300;
    this.bounty = 40 + tier * 10;
    this.targetX = targetX;
  }

  update(game: Game, dt: number): void {
    if (!this.alive) return; // 已死亡的小兵不再行动
    this.attackCooldown -= dt;
    const target = game.nearestEnemy(this.team, this.pos, this.aggroRange, true);
    let goal: Vec2 | null = null;

    if (target) {
      const d = dist(this.pos, target.pos);
      if (d <= this.attackRange) {
        if (this.attackCooldown <= 0) {
          if (this.kind === 'ranged') {
            // 远程小兵发射子弹
            const ang = angleOf({ x: target.pos.x - this.pos.x, y: target.pos.y - this.pos.y });
            game.spawnProjectile({
              pos: { x: this.pos.x + Math.cos(ang) * (this.radius + 4), y: this.pos.y + Math.sin(ang) * (this.radius + 4) },
              vel: fromAngle(ang, 560),
              team: this.team,
              damage: this.damage,
              type: 'bullet',
              radius: 4,
              range: this.attackRange + 40,
              pierce: 0,
              sourceId: this.id,
              paintRadius: 0,
              color: DAMAGE_COLORS.bullet,
              sourceLabel: '小兵',
            });
          } else {
            game.dealDamage(target, this.damage, this.damageType, this.team, this.id, true, '小兵');
          }
          this.attackCooldown = this.attackInterval;
        }
        return; // 攻击时不动
      }
      goal = target.pos;
    } else {
      goal = { x: this.targetX, y: this.pos.y };
    }

    const dir = norm({ x: goal.x - this.pos.x, y: goal.y - this.pos.y });
    this.pos = game.movePoint(this.pos, scale(dir, this.moveSpeed * dt));
  }
}
