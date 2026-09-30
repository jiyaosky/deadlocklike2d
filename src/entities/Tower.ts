// 防御塔
import { Unit } from './Unit';
import type { Vec2, Team } from '../data/types';
import type { Game } from '../core/Game';
import { dist, norm, fromAngle, angleOf } from '../core/vec';
import { TOWER_RADIUS, DAMAGE_COLORS } from '../data/constants';

export class Tower extends Unit {
  damage: number;
  range: number;
  attackInterval: number;
  cooldown = 0;

  constructor(team: Team, pos: Vec2) {
    super(team, pos, TOWER_RADIUS, 3200, team === 0 ? '蓝方防御塔' : '红方防御塔');
    this.damage = 150;
    this.range = 580;
    this.attackInterval = 1.0;
  }

  update(game: Game, dt: number): void {
    if (!this.alive) return; // 已摧毁的塔不再攻击
    this.cooldown -= dt;
    // 优先攻击小兵，其次英雄
    const target =
      game.nearestEnemy(this.team, this.pos, this.range, true, 'minion') ??
      game.nearestEnemy(this.team, this.pos, this.range, true, 'hero');
    if (!target) return;
    if (this.cooldown <= 0) {
      const ang = angleOf({ x: target.pos.x - this.pos.x, y: target.pos.y - this.pos.y });
      const start = { x: this.pos.x, y: this.pos.y - 30 };
      game.spawnProjectile({
        pos: start,
        vel: fromAngle(ang, 700),
        team: this.team,
        damage: this.damage,
        type: 'bullet',
        radius: 7,
        range: this.range + 80,
        pierce: 0,
        sourceId: this.id,
        paintRadius: 0,
        color: DAMAGE_COLORS.bullet,
        sourceLabel: '防御塔',
      });
      this.cooldown = this.attackInterval;
    }
  }
}
