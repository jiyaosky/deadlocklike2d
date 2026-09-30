// 投射物
import type { Vec2, Team, DamageType } from '../data/types';

export class Projectile {
  pos: Vec2;
  vel: Vec2;
  team: Team;
  damage: number;
  type: DamageType;
  radius: number;
  range: number;
  traveled = 0;
  pierce: number; // 命中后剩余可穿透数
  alive = true;
  sourceId: number;
  paintRadius: number;
  color: string;
  hitIds = new Set<number>();
  sourceLabel?: string; // 伤害来源标签（用于日志）
  // 命中效果
  onHit?: 'bleed' | 'explode';
  effectValue?: number;
  explodeRadius?: number;

  constructor(opts: {
    pos: Vec2;
    vel: Vec2;
    team: Team;
    damage: number;
    type: DamageType;
    radius: number;
    range: number;
    pierce: number;
    sourceId: number;
    paintRadius: number;
    color: string;
    sourceLabel?: string;
    onHit?: 'bleed' | 'explode';
    effectValue?: number;
    explodeRadius?: number;
  }) {
    this.pos = { ...opts.pos };
    this.vel = { ...opts.vel };
    this.team = opts.team;
    this.damage = opts.damage;
    this.type = opts.type;
    this.radius = opts.radius;
    this.range = opts.range;
    this.pierce = opts.pierce;
    this.sourceId = opts.sourceId;
    this.paintRadius = opts.paintRadius;
    this.color = opts.color;
    this.sourceLabel = opts.sourceLabel;
    this.onHit = opts.onHit;
    this.effectValue = opts.effectValue;
    this.explodeRadius = opts.explodeRadius;
  }

  update(dt: number): void {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.traveled += Math.hypot(this.vel.x, this.vel.y) * dt;
    if (this.traveled >= this.range) this.alive = false;
  }
}
