// 全局类型定义

export type Team = 0 | 1; // 0 = 蓝方, 1 = 红方

export type DamageType = 'bullet' | 'magic';

export type SkillKey = 'q' | 'e' | 'f' | 'r';

export interface Vec2 {
  x: number;
  y: number;
}

// 可被装备 / 技能 / buff 叠加的最终属性
export interface StatBlock {
  maxHp: number;
  bulletDamage: number;
  magicDamage: number;
  bulletDef: number;
  magicDef: number;
  bulletPen: number;
  magicPen: number;
  moveSpeed: number; // 单位/秒
  turnSpeed: number; // 弧度/秒
  attackSpeed: number; // 攻速倍率
  inkMax: number; // 墨槽上限
  inkRegen: number; // 浮出状态回墨/秒
  inkRegenDived: number; // 潜水状态回墨/秒
  diveSpeedMult: number; // 潜水移速倍率
  jumpPower: number; // 起跳初速度
  hpRegen: number; // 生命回复/秒
}

export type WeaponKind = 'shotgun' | 'smg' | 'rifle';

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  damage: number; // 单发(单颗弹丸)伤害
  damageType: DamageType;
  fireInterval: number; // 射击间隔(秒, 基础值)
  projectileSpeed: number;
  range: number; // 射程(弹丸存活距离)
  spread: number; // 散射半角(弧度)
  pellets: number; // 每次射击弹丸数
  inkCost: number; // 每次射击耗墨
  projectileRadius: number;
}

export interface MeleeDef {
  damage: number;
  damageType: DamageType;
  range: number;
  arc: number; // 攻击弧(弧度)
  cooldown: number;
}

export interface SkillDef {
  key: SkillKey;
  name: string;
  desc: string;
  isUltimate: boolean;
  cooldown: number; // 秒
  inkCost: number;
}

export interface HeroDef {
  id: string;
  name: string;
  role: 'tank' | 'assassin' | 'ranger';
  color: string;
  accent: string;
  radius: number;
  base: StatBlock;
  weapon: WeaponDef;
  melee: MeleeDef;
  skills: SkillDef[];
}

export type ItemCategory = 'defense' | 'bulletAttack' | 'magicAttack';

export interface ItemPassive {
  type: 'autoShield';
  threshold: number; // 单次受击超过此值触发
  shield: number; // 护盾值
  duration: number; // 护盾持续时间
  cooldown: number; // 触发冷却
}

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  cost: number;
  desc: string;
  stats: Partial<StatBlock>;
  passive?: ItemPassive;
  color?: string; // 自定义图标颜色
}

export interface DamageInstance {
  amount: number;
  type: DamageType;
  sourceTeam: Team;
  sourceId?: number;
}

export interface StatusEffect {
  id: string;
  duration: number; // 剩余秒
  // 由外部系统解释的具体效果数据
  [key: string]: unknown;
}
