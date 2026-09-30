// 技能施放实现
import type { Game } from '../core/Game';
import type { Hero } from '../entities/Hero';
import { fromAngle } from '../core/vec';
import { DAMAGE_COLORS } from '../data/constants';

export function castSkill(game: Game, hero: Hero, index: number): void {
  const def = hero.heroDef.skills[index];

  // 检查冷却
  if (hero.skillCooldowns[index] > 0) return;
  // 大招需要充能满
  if (def.isUltimate && hero.ultCharge < 1) return;
  // 墨水消耗
  if (hero.ink < def.inkCost) return;

  hero.ink -= def.inkCost;
  hero.skillCooldowns[index] = def.cooldown;
  if (def.isUltimate) hero.ultCharge = 0;

  switch (hero.heroDef.id) {
    case 'tank':
      castTank(game, hero, index);
      break;
    case 'assassin':
      castAssassin(game, hero, index);
      break;
    case 'ranger':
      castRanger(game, hero, index);
      break;
  }
}

function castTank(game: Game, hero: Hero, index: number): void {
  switch (index) {
    case 0: {
      // 硬化：护盾 + 双抗
      hero.addShield(450, 5);
      hero.defBoost = 40;
      hero.defBoostTimer = 5;
      break;
    }
    case 1: {
      // 冲撞：向前冲锋，撞击击退
      const dashDist = 240;
      const from = { ...hero.pos };
      const to = game.movePoint(hero.pos, fromAngle(hero.facing, dashDist));
      hero.pos = { ...to };
      // 沿途敌人受伤并击退
      for (const e of game.enemiesInArc(hero.team, hero.pos, 170, hero.facing, 1.2, true)) {
        game.dealDamage(e, 90 + hero.stats.bulletDamage, 'bullet', hero.team, hero.id, true, '冲撞');
        game.knockback(e, hero.facing, 150);
      }
      game.ink.paint(from.x, from.y, 40, hero.team, 0.6);
      game.ink.paint(to.x, to.y, 40, hero.team, 0.6);
      break;
    }
    case 2: {
      // 墨汁泼洒：大范围涂墨 + 减速
      const r = 260;
      game.ink.paint(hero.pos.x, hero.pos.y, r, hero.team, 0.9);
      for (const e of game.enemiesInArc(hero.team, hero.pos, r, hero.facing, Math.PI * 2, true)) {
        game.dealDamage(e, 60 + hero.stats.bulletDamage, 'bullet', hero.team, hero.id, true, '墨汁泼洒');
        if (e instanceof Object && 'applySlow' in e) (e as Hero).applySlow(0.4, 2.5);
      }
      game.spawnBurst({ ...hero.pos }, DAMAGE_COLORS.bullet, 18, 420, 5, 0.4);
      break;
    }
    case 3: {
      // 地裂重击：大范围伤害 + 涂墨 + 减速
      const r = 300;
      game.ink.paint(hero.pos.x, hero.pos.y, r, hero.team, 1);
      for (const e of game.enemiesInArc(hero.team, hero.pos, r, hero.facing, Math.PI * 2, true)) {
        game.dealDamage(e, 300 + hero.stats.bulletDamage, 'bullet', hero.team, hero.id, true, '地裂重击');
        if ('applySlow' in e) (e as Hero).applySlow(0.6, 2);
      }
      game.spawnBurst({ ...hero.pos }, DAMAGE_COLORS.bullet, 30, 520, 6, 0.5);
      break;
    }
  }
}

function castAssassin(game: Game, hero: Hero, index: number): void {
  switch (index) {
    case 0: {
      // 瞬步：向瞄准方向瞬移并留墨
      const from = { ...hero.pos };
      const dir = { x: hero.controller.aim.x - hero.pos.x, y: hero.controller.aim.y - hero.pos.y };
      const to = game.movePoint(hero.pos, fromAngle(Math.atan2(dir.y, dir.x), 320));
      game.paintLine(from, to, hero.team, 0.8);
      hero.pos = { ...to };
      break;
    }
    case 1: {
      // 影刃：魔法飞刀 + 流血
      const start = { x: hero.pos.x + Math.cos(hero.facing) * (hero.radius + 6), y: hero.pos.y + Math.sin(hero.facing) * (hero.radius + 6) };
      game.spawnProjectile({
        pos: start,
        vel: fromAngle(hero.facing, 900),
        team: hero.team,
        damage: 120 + hero.stats.magicDamage,
        type: 'magic',
        radius: 6,
        range: 520,
        pierce: 0,
        sourceId: hero.id,
        paintRadius: 8,
        color: DAMAGE_COLORS.magic,
        sourceLabel: '影刃',
        onHit: 'bleed',
        effectValue: 40,
      });
      break;
    }
    case 2: {
      // 潜影：潜行 + 强化下次攻击
      hero.stealthTimer = 3.5;
      hero.nextAttackBonus = 60;
      break;
    }
    case 3: {
      // 暗影突袭：范围魔法爆发
      const r = 280;
      game.ink.paint(hero.pos.x, hero.pos.y, r, hero.team, 1);
      for (const e of game.enemiesInArc(hero.team, hero.pos, r, hero.facing, Math.PI * 2, true)) {
        game.dealDamage(e, 420 + hero.stats.magicDamage, 'magic', hero.team, hero.id, true, '暗影突袭');
      }
      game.spawnBurst({ ...hero.pos }, DAMAGE_COLORS.magic, 28, 500, 6, 0.5);
      break;
    }
  }
}

function castRanger(game: Game, hero: Hero, index: number): void {
  switch (index) {
    case 0: {
      // 穿透弹
      const start = { x: hero.pos.x + Math.cos(hero.facing) * (hero.radius + 6), y: hero.pos.y + Math.sin(hero.facing) * (hero.radius + 6) };
      game.spawnProjectile({
        pos: start,
        vel: fromAngle(hero.facing, 1200),
        team: hero.team,
        damage: 180 + hero.stats.bulletDamage,
        type: 'bullet',
        radius: 8,
        range: 560,
        pierce: 4,
        sourceId: hero.id,
        paintRadius: 12,
        color: DAMAGE_COLORS.bullet,
        sourceLabel: '穿透弹',
      });
      break;
    }
    case 1: {
      // 墨汁手雷：范围魔法 + 涂墨
      const start = { x: hero.pos.x + Math.cos(hero.facing) * (hero.radius + 6), y: hero.pos.y + Math.sin(hero.facing) * (hero.radius + 6) };
      game.spawnProjectile({
        pos: start,
        vel: fromAngle(hero.facing, 560),
        team: hero.team,
        damage: 0,
        type: 'magic',
        radius: 7,
        range: 520,
        pierce: 0,
        sourceId: hero.id,
        paintRadius: 0,
        color: DAMAGE_COLORS.magic,
        sourceLabel: '墨汁手雷',
        onHit: 'explode',
        effectValue: 160 + hero.stats.magicDamage,
        explodeRadius: 160,
      });
      break;
    }
    case 2: {
      // 疾射
      hero.speedTimer = 4;
      break;
    }
    case 3: {
      // 全弹轨道炮：直线贯穿大伤害
      const start = { x: hero.pos.x + Math.cos(hero.facing) * (hero.radius + 6), y: hero.pos.y + Math.sin(hero.facing) * (hero.radius + 6) };
      game.spawnProjectile({
        pos: start,
        vel: fromAngle(hero.facing, 1400),
        team: hero.team,
        damage: 600 + hero.stats.bulletDamage,
        type: 'bullet',
        radius: 16,
        range: 560,
        pierce: 6,
        sourceId: hero.id,
        paintRadius: 26,
        color: DAMAGE_COLORS.bullet,
        sourceLabel: '轨道炮',
      });
      break;
    }
  }
}
