// 掉落金钱（小兵死亡后原地留下的一半赏金，涂墨收集）
import type { Vec2, Team } from '../data/types';
import { MONEY_PICKUP_RADIUS, MONEY_PICKUP_LIFETIME } from '../data/constants';

export class MoneyPickup {
  pos: Vec2;
  team: Team; // 归属队伍（只有该队伍涂墨才能收集）
  amount: number;
  radius = MONEY_PICKUP_RADIUS;
  lifetime = MONEY_PICKUP_LIFETIME;
  alive = true;
  bob = Math.random() * Math.PI * 2;

  constructor(team: Team, pos: Vec2, amount: number) {
    this.team = team;
    this.pos = { ...pos };
    this.amount = amount;
  }

  update(dt: number): void {
    this.lifetime -= dt;
    if (this.lifetime <= 0) this.alive = false;
  }
}
