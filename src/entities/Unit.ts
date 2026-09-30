// 可被伤害的实体基类
import type { Vec2, Team } from '../data/types';

let nextId = 1;

export class Unit {
  id: number;
  team: Team;
  pos: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  alive = true;
  name: string;

  constructor(team: Team, pos: Vec2, radius: number, maxHp: number, name: string) {
    this.id = nextId++;
    this.team = team;
    this.pos = { ...pos };
    this.radius = radius;
    this.hp = maxHp;
    this.maxHp = maxHp;
    this.name = name;
  }

  applyRawDamage(raw: number): void {
    if (!this.alive) return;
    this.hp -= raw;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  heal(amount: number): void {
    if (!this.alive) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }
}
