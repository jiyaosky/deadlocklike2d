// 装备定义：防御 / 子弹攻击 / 魔法攻击 各 3 件
import type { ItemDef } from '../data/types';

export const ITEMS: ItemDef[] = [
  // —— 防御类 ——
  {
    id: 'bulletVest',
    name: '防弹背心',
    category: 'defense',
    cost: 600,
    desc: '+30 子弹防御',
    stats: { bulletDef: 30 },
  },
  {
    id: 'arcaneWard',
    name: '奥术护盾',
    category: 'defense',
    cost: 600,
    desc: '+30 魔法防御',
    stats: { magicDef: 30 },
  },
  {
    id: 'balancedArmor',
    name: '均衡护甲',
    category: 'defense',
    cost: 800,
    desc: '+20 子弹防御 / +20 魔法防御',
    stats: { bulletDef: 20, magicDef: 20 },
  },
  {
    id: 'guardianCore',
    name: '守护核心',
    category: 'defense',
    cost: 900,
    desc: '+150 生命 · 受击超 200 时获得临时护盾(冷却 12s)',
    stats: { maxHp: 150 },
    color: '#22c55e',
    passive: { type: 'autoShield', threshold: 200, shield: 240, duration: 3, cooldown: 12 },
  },
  // —— 子弹攻击类 ——
  {
    id: 'rapidBarrel',
    name: '速射枪管',
    category: 'bulletAttack',
    cost: 500,
    desc: '+15 子弹伤害 / +15% 攻速',
    stats: { bulletDamage: 15, attackSpeed: 0.15 },
  },
  {
    id: 'heavyRounds',
    name: '重型弹头',
    category: 'bulletAttack',
    cost: 700,
    desc: '+35 子弹伤害',
    stats: { bulletDamage: 35 },
  },
  {
    id: 'piercingRounds',
    name: '穿甲弹头',
    category: 'bulletAttack',
    cost: 900,
    desc: '+25 子弹伤害 / +12 子弹穿透',
    stats: { bulletDamage: 25, bulletPen: 12 },
  },
  // —— 魔法攻击类 ——
  {
    id: 'tome',
    name: '魔导之书',
    category: 'magicAttack',
    cost: 500,
    desc: '+15 魔法伤害',
    stats: { magicDamage: 15 },
  },
  {
    id: 'arcaneCore',
    name: '奥术核心',
    category: 'magicAttack',
    cost: 700,
    desc: '+30 魔法伤害 / +15 回墨',
    stats: { magicDamage: 30, inkRegen: 15 },
  },
  {
    id: 'spellPiercer',
    name: '破法之刃',
    category: 'magicAttack',
    cost: 900,
    desc: '+25 魔法伤害 / +12 魔法穿透',
    stats: { magicDamage: 25, magicPen: 12 },
  },
];

export function getItemDef(id: string): ItemDef {
  const it = ITEMS.find((x) => x.id === id);
  if (!it) throw new Error('unknown item ' + id);
  return it;
}
