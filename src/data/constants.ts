// 全局常量与配色

export const TEAM_COLORS = {
  blue: { main: '#2e7cff', dark: '#173f8f', ink: 'rgba(46,124,255,0.55)' },
  red: { main: '#ff4d5e', dark: '#8f1f2b', ink: 'rgba(255,77,94,0.55)' },
  neutral: '#141824',
} as const;

export const TEAM_NAMES = ['蓝方', '红方'] as const;

// 伤害类型配色（子弹=暖色，魔法=冷色）
export const DAMAGE_COLORS = {
  bullet: '#fbbf24',
  magic: '#c084fc',
} as const;

export const INK_CELL = 24; // 墨格尺寸(像素)
export const MAP_W = 4400; // 地图宽度
export const MAP_H = 2600; // 地图高度
export const LANE_Y = MAP_H / 2; // 兵线中线 y

// 侧边道路（绕后/偷袭）
export const SIDE_ROAD_TOP = 380;
export const SIDE_ROAD_BOTTOM = 2220;
export const SIDE_ROAD_WIDTH = 150;

// 掉落金钱吸附
export const MONEY_SUCTION_RADIUS = 220; // 吸附半径
export const MONEY_SUCTION_SPEED = 620; // 吸附速度
export const MONEY_COLLECT_RADIUS = 22; // 收集判定

// 射击/单位半径
export const HERO_RADIUS = 20;
export const MINION_RADIUS = 13;
export const TOWER_RADIUS = 46;
export const BASE_RADIUS = 70;

export const MAX_ITEM_SLOTS = 6;
export const PASSIVE_GOLD_PER_SEC = 2.5;

// 等级：与累计金钱挂钩
export const LEVEL_GOLD_PER = 600; // 每 600 累计金币升 1 级
export const MAX_LEVEL = 18;

// 掉落金钱
export const MONEY_PICKUP_RADIUS = 18;
export const MONEY_PICKUP_LIFETIME = 25; // 秒
export const BASE_HEAL_RADIUS = 520; // 基地回血范围
export const BASE_HEAL_RATE = 0.18; // 每秒恢复最大生命比例（外加固定值）

export const FIXED_DT = 1 / 60;
