// 基地核心
import { Unit } from './Unit';
import type { Vec2, Team } from '../data/types';
import { BASE_RADIUS } from '../data/constants';

export class Base extends Unit {
  constructor(team: Team, pos: Vec2) {
    super(team, pos, BASE_RADIUS, 9000, team === 0 ? '蓝方基地' : '红方基地');
  }
}
