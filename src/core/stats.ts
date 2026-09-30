// 属性计算工具
import type { StatBlock, ItemDef, HeroDef } from '../data/types';
import { LEVEL_GOLD_PER, MAX_LEVEL } from '../data/constants';

export function emptyStats(): StatBlock {
  return {
    maxHp: 0,
    bulletDamage: 0,
    magicDamage: 0,
    bulletDef: 0,
    magicDef: 0,
    bulletPen: 0,
    magicPen: 0,
    moveSpeed: 0,
    turnSpeed: 0,
    attackSpeed: 0,
    inkMax: 0,
    inkRegen: 0,
    inkRegenDived: 0,
    diveSpeedMult: 0,
    jumpPower: 0,
    hpRegen: 0,
  };
}

export function addStats(a: StatBlock, b: Partial<StatBlock>): StatBlock {
  const out: StatBlock = { ...a };
  (Object.keys(b) as (keyof StatBlock)[]).forEach((k) => {
    const val = b[k];
    if (typeof val === 'number') out[k] += val;
  });
  return out;
}

// 基础属性 + 所有装备属性叠加
export function computeStats(base: StatBlock, items: ItemDef[]): StatBlock {
  let s = { ...base };
  for (const it of items) s = addStats(s, it.stats);
  return s;
}

// 等级由累计金钱决定
export function getLevel(totalGold: number): number {
  return Math.min(1 + Math.floor(totalGold / LEVEL_GOLD_PER), MAX_LEVEL);
}

// 每级基础属性增强：三种职业方向不同
export function getLevelBonus(role: HeroDef['role'], level: number): Partial<StatBlock> {
  const n = Math.max(0, level - 1);
  switch (role) {
    case 'tank':
      return { maxHp: 80 * n, bulletDef: 3 * n, magicDef: 3 * n, hpRegen: 0.4 * n };
    case 'assassin':
      return { moveSpeed: 6 * n, turnSpeed: 0.6 * n, bulletDamage: 4 * n, magicDamage: 4 * n };
    case 'ranger':
      return { bulletDamage: 5 * n, attackSpeed: 0.02 * n, maxHp: 40 * n };
  }
}
