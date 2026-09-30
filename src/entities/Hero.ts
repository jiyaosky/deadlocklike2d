// 英雄
import { Unit } from './Unit';
import type { HeroDef, Vec2, Team, DamageType, ItemDef, StatBlock } from '../data/types';
import type { Game } from '../core/Game';
import { computeStats, addStats, getLevel, getLevelBonus } from '../core/stats';
import { clamp, angleOf, rotateToward, angleDelta, fromAngle, norm } from '../core/vec';
import { HERO_RADIUS, DAMAGE_COLORS } from '../data/constants';

// 控制来源（玩家输入或 Bot）
export interface Controller {
  move: Vec2; // 期望移动方向（幅值 0..1）
  aim: Vec2; // 瞄准目标（世界坐标）
  shoot: boolean; // 持续按住
  dive: boolean; // 持续按住
  jump: boolean; // 边沿触发
  melee: boolean; // 边沿触发
  skills: boolean[]; // [q,e,f,r] 边沿触发
}

export function makeController(): Controller {
  return {
    move: { x: 0, y: 0 },
    aim: { x: 0, y: 0 },
    shoot: false,
    dive: false,
    jump: false,
    melee: false,
    skills: [false, false, false, false],
  };
}

export class Hero extends Unit {
  heroDef: HeroDef;
  controller: Controller;
  baseStats: StatBlock;
  stats: StatBlock;
  items: ItemDef[] = [];
  gold = 0;
  totalGold = 0; // 累计获得金钱（决定等级，消费不减少）
  level = 1;

  ink: number;
  facing: number;
  vel: Vec2 = { x: 0, y: 0 };

  isDiving = false;
  isJumping = false;
  zHeight = 0;
  jumpVel = 0;

  fireCooldown = 0;
  meleeCooldown = 0;
  skillCooldowns: number[] = [0, 0, 0, 0];
  ultCharge = 0;

  // 状态效果
  shield = 0; // 护盾吸收量
  shieldTimer = 0;
  slowFactor = 0; // 0 无减速, 1 完全停止
  slowTimer = 0;
  bleedDps = 0;
  bleedType: DamageType = 'magic';
  bleedTimer = 0;
  speedTimer = 0; // 疾射 buff（攻速+移速）
  stealthTimer = 0;
  nextAttackBonus = 0; // 潜影强化下次攻击
  defBoost = 0; // 硬化双抗提升
  defBoostTimer = 0;
  autoShieldCd = 0; // 守护核心自动护盾冷却
  hitFlash = 0; // 受击白闪计时

  respawnTimer = 0;
  kills = 0;
  deaths = 0;
  creepKills = 0;
  owner = 'ai'; // 联机归属：玩家 id 或 'ai'

  constructor(heroDef: HeroDef, team: Team, pos: Vec2, controller: Controller) {
    super(team, pos, heroDef.radius || HERO_RADIUS, heroDef.base.maxHp, heroDef.name);
    this.heroDef = heroDef;
    this.controller = controller;
    this.baseStats = { ...heroDef.base };
    this.stats = { ...heroDef.base };
    this.ink = heroDef.base.inkMax;
    this.facing = team === 0 ? 0 : Math.PI;
  }

  refreshStats(): void {
    const before = this.maxHp;
    this.level = getLevel(this.totalGold);
    this.stats = computeStats(this.baseStats, this.items);
    this.stats = addStats(this.stats, getLevelBonus(this.heroDef.role, this.level));
    this.stats.bulletDef += this.defBoost;
    this.stats.magicDef += this.defBoost;
    this.maxHp = this.stats.maxHp;
    if (this.maxHp > before && this.alive) this.hp += this.maxHp - before;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    if (this.ink > this.stats.inkMax) this.ink = this.stats.inkMax;
  }

  isOnOwnInk(game: Game): boolean {
    return game.ink.ownerAt(this.pos.x, this.pos.y) === this.team;
  }

  isOnEnemyInk(game: Game): boolean {
    const o = game.ink.ownerAt(this.pos.x, this.pos.y);
    return o !== -1 && o !== this.team;
  }

  update(game: Game, dt: number): void {
    if (!this.alive) {
      this.respawnTimer -= dt;
      // 死亡时清空边沿输入，避免复活后误触发
      this.controller.jump = false;
      this.controller.melee = false;
      for (let i = 0; i < 4; i++) this.controller.skills[i] = false;
      return;
    }

    this.refreshStats();

    // 冷却与状态计时
    this.fireCooldown -= dt;
    this.meleeCooldown -= dt;
    for (let i = 0; i < 4; i++) if (this.skillCooldowns[i] > 0) this.skillCooldowns[i] -= dt;
    this.shieldTimer -= dt;
    if (this.shieldTimer <= 0) this.shield = 0;
    this.slowTimer -= dt;
    if (this.slowTimer <= 0) this.slowFactor = 0;
    this.bleedTimer -= dt;
    if (this.bleedTimer > 0) {
      game.dealDamage(this, this.bleedDps * dt, this.bleedType, this.team === 0 ? 1 : 0, -1, false, '流血·影刃');
    }
    this.speedTimer -= dt;
    this.stealthTimer -= dt;
    this.defBoostTimer -= dt;
    if (this.defBoostTimer <= 0) this.defBoost = 0;
    if (this.autoShieldCd > 0) this.autoShieldCd -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // 大招充能
    this.ultCharge = clamp(this.ultCharge + 0.015 * dt, 0, 1);

    // 回血
    if (this.stats.hpRegen > 0) this.heal(this.stats.hpRegen * dt);

    // 潜水状态判定：按住且脚下为己方墨水
    this.isDiving = this.controller.dive && this.isOnOwnInk(game);

    // 回墨
    const regen = this.isDiving ? this.stats.inkRegenDived : this.stats.inkRegen;
    this.ink = clamp(this.ink + regen * dt, 0, this.stats.inkMax);

    // 转向
    const aimDir = norm({ x: this.controller.aim.x - this.pos.x, y: this.controller.aim.y - this.pos.y });
    const targetAngle = angleOf(aimDir);
    this.facing = rotateToward(this.facing, targetAngle, this.stats.turnSpeed * dt);

    // 移动
    let speed = this.stats.moveSpeed;
    if (this.isDiving) speed *= this.stats.diveSpeedMult;
    if (this.slowFactor > 0) speed *= 1 - this.slowFactor;
    if (this.isOnEnemyInk(game) && !this.isDiving) speed *= 0.65; // 敌方墨水减速
    if (this.speedTimer > 0) speed *= 1.25;
    const mv = norm(this.controller.move);
    this.vel = { x: mv.x * speed, y: mv.y * speed };
    this.pos = game.movePoint(this.pos, { x: this.vel.x * dt, y: this.vel.y * dt });

    // 跳跃
    if (this.controller.jump && !this.isJumping) {
      this.isJumping = true;
      this.jumpVel = this.stats.jumpPower;
      this.zHeight = 0.01;
    }
    if (this.isJumping) {
      this.jumpVel -= 1100 * dt;
      this.zHeight += this.jumpVel * dt;
      if (this.zHeight <= 0) {
        this.zHeight = 0;
        this.isJumping = false;
      }
    }

    // 射击
    if (this.controller.shoot && !this.isDiving && this.fireCooldown <= 0) {
      this.tryShoot(game);
    }

    // 近战
    if (this.controller.melee && this.meleeCooldown <= 0) {
      this.tryMelee(game);
    }

    // 技能
    for (let i = 0; i < 4; i++) {
      if (this.controller.skills[i]) {
        game.castSkill(this, i);
      }
    }

    // 脚下轻微涂墨（移动或潜水时）
    if (this.isDiving || Math.hypot(this.vel.x, this.vel.y) > 10) {
      const r = this.isDiving ? this.radius + 6 : this.radius * 0.7;
      game.ink.paint(this.pos.x, this.pos.y, r, this.team, 0.35 * dt);
    }

    // 清空边沿输入
    this.controller.jump = false;
    this.controller.melee = false;
    for (let i = 0; i < 4; i++) this.controller.skills[i] = false;
  }

  tryShoot(game: Game): void {
    const w = this.heroDef.weapon;
    const cost = w.inkCost;
    if (this.ink < cost) return;
    // 朝向与瞄准角差过大时不开火（转向未到位）
    const aimAng = angleOf({ x: this.controller.aim.x - this.pos.x, y: this.controller.aim.y - this.pos.y });
    if (Math.abs(angleDelta(aimAng, this.facing)) > 0.5) return;

    this.ink -= cost;
    const speedBuff = this.speedTimer > 0 ? 1.4 : 1;
    const interval = w.fireInterval / (this.stats.attackSpeed * speedBuff);
    this.fireCooldown = interval;

    const dmg = w.damage + (w.damageType === 'bullet' ? this.stats.bulletDamage : this.stats.magicDamage);
    const bonus = this.nextAttackBonus;
    const pellets = w.pellets;
    for (let p = 0; p < pellets; p++) {
      const spread = (Math.random() - 0.5) * 2 * w.spread;
      const ang = this.facing + spread;
      const start = { x: this.pos.x + Math.cos(this.facing) * (this.radius + 6), y: this.pos.y + Math.sin(this.facing) * (this.radius + 6) };
      game.spawnProjectile({
        pos: start,
        vel: fromAngle(ang, w.projectileSpeed),
        team: this.team,
        damage: dmg + bonus,
        type: w.damageType,
        radius: w.projectileRadius,
        range: w.range,
        pierce: 0,
        sourceId: this.id,
        paintRadius: 10,
        color: DAMAGE_COLORS[w.damageType],
        sourceLabel: `武器·${w.name}`,
      });
    }
    if (bonus) this.nextAttackBonus = 0;
  }

  tryMelee(game: Game): void {
    const m = this.heroDef.melee;
    this.meleeCooldown = m.cooldown;
    const bonus = this.nextAttackBonus;
    const enemies = game.enemiesInArc(this.team, this.pos, m.range, this.facing, m.arc, true);
    for (const e of enemies) {
      game.dealDamage(e, m.damage + bonus, m.damageType, this.team, this.id, true, '近战');
      // 近战命中附带回墨
      this.ink = clamp(this.ink + 4, 0, this.stats.inkMax);
    }
    if (bonus) this.nextAttackBonus = 0;
    // 挥击涂墨
    game.ink.paint(this.pos.x + Math.cos(this.facing) * m.range * 0.5, this.pos.y + Math.sin(this.facing) * m.range * 0.5, m.range * 0.7, this.team, 0.6);
    // 近战命中特效（伤害类型配色）
    game.spawnBurst(
      { x: this.pos.x + Math.cos(this.facing) * m.range * 0.6, y: this.pos.y + Math.sin(this.facing) * m.range * 0.6 },
      DAMAGE_COLORS[m.damageType],
      enemies.length > 0 ? 10 : 4,
      280,
      4,
      0.35,
    );
  }

  // 被减速
  applySlow(factor: number, duration: number): void {
    this.slowFactor = Math.max(this.slowFactor, factor);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  // 加护盾
  addShield(amount: number, duration: number): void {
    this.shield = Math.max(this.shield, amount);
    this.shieldTimer = Math.max(this.shieldTimer, duration);
  }

  // 承受伤害（先扣护盾）
  takeDamage(game: Game, raw: number, type: DamageType, sourceTeam: Team, sourceId: number, grantUlt: boolean): void {
    if (!this.alive) return;
    let remaining = raw;
    // 潜行期间减伤，且受击破隐
    if (this.stealthTimer > 0) {
      remaining *= 0.5;
      this.stealthTimer = 0;
    }
    const hitAmount = remaining; // 本次受击量（用于阈值判断）
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) {
      super.applyRawDamage(remaining);
      this.hitFlash = 0.15;
      if (grantUlt) {
        const src = game.heroById(sourceId);
        if (src && src.team !== this.team) src.ultCharge = clamp(src.ultCharge + remaining / 1500, 0, 1);
      }
    }
    // 守护核心：受击超过阈值后，生成临时护盾保护后续伤害
    if (this.alive && this.autoShieldCd <= 0) {
      const shieldItem = this.items.find((i) => i.passive?.type === 'autoShield');
      if (shieldItem?.passive && hitAmount >= shieldItem.passive.threshold) {
        this.addShield(shieldItem.passive.shield, shieldItem.passive.duration);
        this.autoShieldCd = shieldItem.passive.cooldown;
      }
    }
  }
}
