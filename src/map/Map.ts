// 单兵线地图定义
import { MAP_H, LANE_Y } from '../data/constants';
import type { Team } from '../data/types';

export interface MapSpot {
  team: Team;
  x: number;
  y: number;
}

export interface MapDef {
  bases: MapSpot[];
  towers: MapSpot[];
  heroSpawn: MapSpot[];
  laneY: number;
}

// 蓝方在左，红方在右
export const MAP_DEF: MapDef = {
  laneY: LANE_Y,
  bases: [
    { team: 0, x: 200, y: MAP_H / 2 },
    { team: 1, x: 4200, y: MAP_H / 2 },
  ],
  towers: [
    { team: 0, x: 1150, y: MAP_H / 2 }, // 蓝内塔
    { team: 0, x: 1800, y: MAP_H / 2 }, // 蓝外塔
    { team: 1, x: 2600, y: MAP_H / 2 }, // 红外塔
    { team: 1, x: 3250, y: MAP_H / 2 }, // 红内塔
  ],
  heroSpawn: [
    { team: 0, x: 480, y: MAP_H / 2 },
    { team: 1, x: 3920, y: MAP_H / 2 },
  ],
};

export function enemyBaseX(team: Team): number {
  return team === 0 ? 4200 : 200;
}
