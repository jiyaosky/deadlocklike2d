// 主游戏：状态机、世界更新、伤害结算、渲染、UI
import type { Team, DamageType, Vec2, ItemDef } from '../data/types';
import {
  MAP_W, MAP_H, INK_CELL, TEAM_COLORS, TEAM_NAMES,
  PASSIVE_GOLD_PER_SEC, MAX_ITEM_SLOTS, LANE_Y,
  BASE_HEAL_RADIUS, BASE_HEAL_RATE, MONEY_PICKUP_LIFETIME,
  DAMAGE_COLORS, SIDE_ROAD_TOP, SIDE_ROAD_BOTTOM, SIDE_ROAD_WIDTH,
  MONEY_SUCTION_RADIUS, MONEY_SUCTION_SPEED, MONEY_COLLECT_RADIUS,
  TOWER_RADIUS, BASE_RADIUS, MINION_RADIUS, HERO_RADIUS,
} from '../data/constants';
import { GameLoop } from './GameLoop';
import { Camera } from './Camera';
import { Input } from './Input';
import { InkGrid } from '../ink/InkGrid';
import { PlayerController } from './PlayerController';
import { Hero, makeController } from '../entities/Hero';
import { Minion } from '../entities/Minion';
import { Tower } from '../entities/Tower';
import { Base } from '../entities/Base';
import { Projectile } from '../entities/Projectile';
import { MoneyPickup } from '../entities/MoneyPickup';
import { Unit } from '../entities/Unit';
import { BotController } from '../ai/BotController';
import { HEROES, getHeroDef } from '../heroes/heroRegistry';
import { ITEMS } from '../items/itemRegistry';
import { castSkill as castSkillImpl } from '../heroes/skills';
import { MAP_DEF, enemyBaseX } from '../map/Map';
import { clamp, dist, angleDelta, fromAngle, norm } from './vec';
import { Net, type NetMessage } from '../net/Net';
import { NetworkController } from '../net/NetworkController';
import type { RoomStateMsg, NetState, NetInput, NetUnit, NetHero } from '../net/protocol';

type GameState = 'menu' | 'select' | 'playing' | 'ended' | 'lobby';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface DamageLogEntry {
  t: number;
  source: string;
  target: string;
  type: DamageType;
  raw: number;
  final: number;
  x: number;
  y: number;
}

export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  input: Input;
  camera: Camera;
  ink: InkGrid;
  loop: GameLoop;

  state: GameState = 'menu';
  selectedHero: number | null = null;
  winner: Team | null = null;
  endTimer = 0;

  heroes: Hero[] = [];
  minions: Minion[] = [];
  towers: Tower[] = [];
  bases: Base[] = [];
  projectiles: Projectile[] = [];
  moneyPickups: MoneyPickup[] = [];
  particles: Particle[] = [];
  floaters: FloatText[] = [];
  playerHitFlash = 0; // 玩家受击红屏提示
  damageLog: DamageLogEntry[] = []; // 伤害来源日志
  showDamageLog = false;
  logCopied = false;

  player: Hero | null = null;
  playerController: PlayerController | null = null;
  botControllers = new Map<number, BotController>();

  time = 0;
  waveTimer = 3;
  waveCount = 0;
  shopOpen = false;

  // —— 联机 ——
  net: Net | null = null;
  multi = false;
  isHost = false;
  myPlayerId = '';
  roomCode = '';
  roomHostId = '';
  roomSlots: RoomStateMsg['slots'] = [];
  lobbyMode: 'connect' | 'home' | 'joinInput' | 'inRoom' = 'home';
  codeInput = '';
  lobbyError = '';
  remote: NetState | null = null; // 非房主：最近一帧状态
  netCtrlMap = new Map<string, NetworkController>(); // 房主：远程玩家控制器
  private netSendTimer = 0;
  private netStateTimer = 0;
  private inputSeq = 0;
  private pendJump = false;
  private pendMelee = false;
  private pendSkills: [boolean, boolean, boolean, boolean] = [false, false, false, false];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.input = new Input(canvas);
    this.camera = new Camera();
    this.ink = new InkGrid();
    this.loop = new GameLoop((dt) => this.update(dt), () => this.render());
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loop.start();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.camera.setView(w, h);
  }

  // —— 状态切换 ——
  toMenu(): void {
    this.state = 'menu';
    this.heroes = [];
    this.minions = [];
    this.towers = [];
    this.bases = [];
    this.projectiles = [];
    this.moneyPickups = [];
    this.player = null;
    this.shopOpen = false;
  }

  toSelect(): void {
    this.state = 'select';
    this.selectedHero = null;
  }

  startGame(heroIndex: number): void {
    const pick = HEROES[heroIndex];
    this.selectedHero = heroIndex;
    this.state = 'playing';
    this.winner = null;
    this.endTimer = 0;
    this.time = 0;
    this.waveTimer = 3;
    this.waveCount = 0;
    this.shopOpen = false;
    this.ink = new InkGrid();
    this.projectiles = [];
    this.moneyPickups = [];
    this.minions = [];
    this.botControllers.clear();

    // 基地与塔
    this.bases = MAP_DEF.bases.map((b) => new Base(b.team, { x: b.x, y: b.y }));
    this.towers = MAP_DEF.towers.map((t) => new Tower(t.team, { x: t.x, y: t.y }));

    // 蓝方：玩家 + 2 bot（用另外两个英雄）
    const blueHeroes: Hero[] = [];
    const playerCtrl = new PlayerController(this.input, this.camera);
    this.playerController = playerCtrl;
    const player = new Hero(pick, 0, this.heroSpawn(0, 0), playerCtrl.c);
    player.name = '你';
    blueHeroes.push(player);
    this.player = player;

    const others = HEROES.filter((_, i) => i !== heroIndex);
    for (let i = 0; i < others.length; i++) {
      const bot = new Hero(others[i], 0, this.heroSpawn(0, i + 1), makeController());
      const bc = new BotController();
      bot.controller = bc.c;
      this.botControllers.set(bot.id, bc);
      blueHeroes.push(bot);
    }

    // 红方：3 bot（三名英雄各一）
    for (let i = 0; i < HEROES.length; i++) {
      const bot = new Hero(HEROES[i], 1, this.heroSpawn(1, i), makeController());
      const bc = new BotController();
      bot.controller = bc.c;
      this.botControllers.set(bot.id, bc);
      this.heroes.push(bot);
    }

    this.heroes.push(...blueHeroes);
  }

  heroSpawn(team: Team, index: number): Vec2 {
    const baseX = team === 0 ? 480 : 3920;
    const yOff = (index - 1) * 90;
    return { x: baseX + (team === 0 ? index * 40 : -index * 40), y: LANE_Y + yOff };
  }

  // —— 主更新 ——
  update(dt: number): void {
    if (this.state === 'menu') {
      if (this.input.justPressed('Space') || this.input.justPressed('Enter')) this.toSelect();
      if (this.input.justPressed('KeyM')) this.enterLobby();
      if (this.input.mouseJustPressed) this.handleMenuClick();
      this.input.endFrame();
      return;
    }

    if (this.state === 'lobby') {
      this.updateLobby(dt);
      this.input.endFrame();
      return;
    }

    if (this.state === 'select') {
      if (this.input.justPressed('KeyQ')) { this.selectedHero = 0; this.startGame(0); }
      else if (this.input.justPressed('KeyW')) { this.selectedHero = 1; this.startGame(1); }
      else if (this.input.justPressed('KeyE')) { this.selectedHero = 2; this.startGame(2); }
      if (this.input.mouseJustPressed) this.handleSelectClick();
      this.input.endFrame();
      return;
    }

    if (this.state === 'ended') {
      this.endTimer += dt;
      if (this.endTimer > 1.5 && this.input.justPressed('KeyR')) this.leaveToMenu();
      this.input.endFrame();
      return;
    }

    // —— playing ——
    if (this.multi && !this.isHost) {
      this.updateRemote(dt);
      this.input.endFrame();
      return;
    }

    this.time += dt;
    if (this.player && this.player.alive) this.camera.follow(this.player.pos);

    // 输入/控制
    this.playerController?.update();
    // 商店打开时屏蔽战斗输入，避免误射
    if (this.shopOpen && this.playerController) {
      const c = this.playerController.c;
      c.shoot = false;
      c.dive = false;
      c.jump = false;
      c.melee = false;
      for (let i = 0; i < 4; i++) c.skills[i] = false;
    }
    for (const h of this.heroes) {
      const bc = this.botControllers.get(h.id);
      if (bc) bc.update(this, h, dt);
    }

    for (const h of this.heroes) h.update(this, dt);

    for (const m of this.minions) m.update(this, dt);
    for (const t of this.towers) t.update(this, dt);
    this.updateProjectiles(dt);
    this.updateMinionWaves(dt);
    this.updateMoneyPickups(dt);
    this.updateParticles(dt);
    this.updateFloaters(dt);
    if (this.playerHitFlash > 0) this.playerHitFlash -= dt;
    this.applyBaseHeal(dt);
    this.handleRespawns();
    this.botBuy();
    this.passiveGold(dt);
    this.cleanupDead();

    // 商店开关
    if (this.input.justPressed('KeyB')) this.shopOpen = !this.shopOpen;
    if (this.shopOpen && this.input.mouseJustPressed) this.handleShopClick();
    // 伤害日志面板
    if (this.input.justPressed('F3')) this.showDamageLog = !this.showDamageLog;
    if (this.input.justPressed('KeyL')) this.copyDamageLog();

    // 胜负判定
    for (const b of this.bases) {
      if (!b.alive) {
        this.winner = b.team === 0 ? 1 : 0;
        this.state = 'ended';
        this.endTimer = 0;
        break;
      }
    }

    // 联机房主：广播状态
    if (this.multi && this.isHost) this.broadcastState(dt);

    this.input.endFrame();
  }

  handleSelectClick(): void {
    const { x, y } = this.input.mouse;
    const w = this.camera.viewW;
    const cardW = 260;
    const gap = 40;
    const total = cardW * 3 + gap * 2;
    const startX = (w - total) / 2;
    const startY = this.camera.viewH * 0.34;
    for (let i = 0; i < 3; i++) {
      const cx = startX + i * (cardW + gap);
      if (x >= cx && x <= cx + cardW && y >= startY && y <= startY + 360) {
        this.startGame(i);
        return;
      }
    }
  }

  // ================= 联机 =================
  private netUrl(): string {
    return `ws://${window.location.hostname || 'localhost'}:8787`;
  }

  enterLobby(): void {
    this.state = 'lobby';
    this.lobbyMode = 'connect';
    this.lobbyError = '';
    this.codeInput = '';
    this.roomSlots = [];
    this.roomCode = '';
    this.roomHostId = '';
    this.multi = true;
    this.remote = null;
    const name = '玩家' + Math.floor(1000 + Math.random() * 9000);
    this.net = new Net(name);
    this.net.on((m) => this.onNetMessage(m));
    this.net
      .connect(this.netUrl())
      .then(() => {
        if (this.state === 'lobby' && this.lobbyMode === 'connect') this.lobbyMode = 'home';
      })
      .catch(() => {
        this.lobbyError = '无法连接服务器（请先运行 pnpm server）';
        this.lobbyMode = 'home';
      });
  }

  leaveToMenu(): void {
    if (this.net) {
      try {
        this.net.leave();
        this.net.close();
      } catch {
        /* 忽略 */
      }
    }
    this.net = null;
    this.multi = false;
    this.isHost = false;
    this.myPlayerId = '';
    this.remote = null;
    this.netCtrlMap.clear();
    this.toMenu();
  }

  private onNetMessage(m: NetMessage): void {
    switch (m.type) {
      case 'hello':
        this.myPlayerId = m.id;
        break;
      case 'joined':
        this.roomCode = m.code;
        this.roomHostId = m.hostId;
        this.lobbyMode = 'inRoom';
        break;
      case 'roomState':
        this.roomCode = m.code;
        this.roomHostId = m.hostId;
        this.roomSlots = m.slots;
        break;
      case 'error':
        this.lobbyError = m.message;
        break;
      case 'start':
        this.beginMulti(m.slots);
        break;
      case 'input':
        if (this.isHost) this.applyRemoteInput(m);
        break;
      case 'buy':
        if (this.isHost) this.applyRemoteBuy(m.playerId, m.itemId);
        break;
      case 'state':
        if (!this.isHost) this.remote = m;
        break;
      case 'disconnect':
        if (this.state === 'lobby') {
          this.lobbyError = '与服务器断开连接';
          this.lobbyMode = 'home';
        }
        break;
    }
  }

  private beginMulti(slots: { playerId: string | null; heroId: string | null }[]): void {
    this.isHost = this.roomHostId === this.myPlayerId;
    // 合并房主本地已知的名字
    const merged = slots.map((s, i) => ({
      playerId: s.playerId,
      heroId: s.heroId,
      name: this.roomSlots[i]?.name ?? (s.playerId ? '玩家' : null),
    }));
    if (this.isHost) this.startMultiGame(merged);
    else this.startRemote();
  }

  private startMultiGame(slots: { playerId: string | null; heroId: string | null; name: string | null }[]): void {
    this.state = 'playing';
    this.winner = null;
    this.endTimer = 0;
    this.time = 0;
    this.waveTimer = 3;
    this.waveCount = 0;
    this.shopOpen = false;
    this.ink = new InkGrid();
    this.projectiles = [];
    this.moneyPickups = [];
    this.minions = [];
    this.particles = [];
    this.floaters = [];
    this.damageLog = [];
    this.botControllers.clear();
    this.netCtrlMap.clear();
    this.bases = MAP_DEF.bases.map((b) => new Base(b.team, { x: b.x, y: b.y }));
    this.towers = MAP_DEF.towers.map((t) => new Tower(t.team, { x: t.x, y: t.y }));
    const defaultHeroes = ['tank', 'assassin', 'ranger'];
    this.heroes = [];
    this.player = null;
    this.playerController = null;

    for (let i = 0; i < 6; i++) {
      const team = (i < 3 ? 0 : 1) as Team;
      const laneIndex = i % 3;
      const slot = slots[i];
      const heroId = slot?.heroId || defaultHeroes[laneIndex];
      const heroDef = getHeroDef(heroId);
      const spawn = this.heroSpawn(team, laneIndex);

      if (slot && slot.playerId) {
        if (slot.playerId === this.myPlayerId) {
          const pc = new PlayerController(this.input, this.camera);
          this.playerController = pc;
          const hero = new Hero(heroDef, team, spawn, pc.c);
          hero.name = slot.name || '你';
          hero.owner = slot.playerId;
          this.player = hero;
          this.heroes.push(hero);
        } else {
          const nc = new NetworkController();
          const hero = new Hero(heroDef, team, spawn, nc.c);
          hero.name = slot.name || '玩家';
          hero.owner = slot.playerId;
          this.netCtrlMap.set(slot.playerId, nc);
          this.heroes.push(hero);
        }
      } else {
        const bot = new Hero(heroDef, team, spawn, makeController());
        const bc = new BotController();
        bot.controller = bc.c;
        bot.owner = 'ai';
        this.botControllers.set(bot.id, bc);
        this.heroes.push(bot);
      }
    }
  }

  private startRemote(): void {
    this.state = 'playing';
    this.remote = null;
    this.netStateTimer = 0;
    this.netSendTimer = 0;
    this.pendJump = false;
    this.pendMelee = false;
    this.pendSkills = [false, false, false, false];
    this.shopOpen = false;
  }

  private updateRemote(dt: number): void {
    // 相机跟随自己的英雄（无归属时跟随地图中心观战）
    if (this.remote) {
      const me = this.remote.heroes.find((h) => h.owner === this.myPlayerId);
      if (me && me.alive) this.camera.follow({ x: me.x, y: me.y });
      else if (!me) this.camera.follow({ x: MAP_W / 2, y: MAP_H / 2 });
    }
    // 累积边沿输入
    this.pendJump = this.pendJump || this.input.justPressed('Space');
    this.pendMelee = this.pendMelee || this.input.justPressed('KeyV');
    const keys = ['KeyQ', 'KeyE', 'KeyF', 'KeyR'] as const;
    for (let i = 0; i < 4; i++) this.pendSkills[i] = this.pendSkills[i] || this.input.justPressed(keys[i]);

    this.netSendTimer -= dt;
    if (this.netSendTimer <= 0) {
      this.netSendTimer = 0.05;
      this.sendMyInput();
    }

    if (this.input.justPressed('KeyB')) this.shopOpen = !this.shopOpen;
    if (this.shopOpen && this.input.mouseJustPressed) {
      const me = this.remote?.heroes.find((h) => h.owner === this.myPlayerId);
      if (me) this.handleRemoteShopClick(me);
    }
    if (this.input.justPressed('F3')) this.showDamageLog = !this.showDamageLog;
  }

  private sendMyInput(): void {
    if (!this.net) return;
    let mx = 0;
    let my = 0;
    if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) my -= 1;
    if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) my += 1;
    if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) mx -= 1;
    if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) mx += 1;
    const move = norm({ x: mx, y: my });
    const aim = this.camera.toWorld(this.input.mouse.x, this.input.mouse.y);
    const input: NetInput = {
      seq: this.inputSeq++,
      move,
      aim,
      shoot: this.input.mouseDown,
      dive: this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight'),
      jump: this.pendJump,
      melee: this.pendMelee,
      skills: [...this.pendSkills] as [boolean, boolean, boolean, boolean],
    };
    this.net.sendInput(input);
    this.pendJump = false;
    this.pendMelee = false;
    this.pendSkills = [false, false, false, false];
  }

  private applyRemoteInput(m: { playerId: string; seq: number; move: { x: number; y: number }; aim: { x: number; y: number }; shoot: boolean; dive: boolean; jump: boolean; melee: boolean; skills: boolean[] }): void {
    const nc = this.netCtrlMap.get(m.playerId);
    if (!nc) return;
    nc.applyInput({
      seq: m.seq,
      move: m.move,
      aim: m.aim,
      shoot: m.shoot,
      dive: m.dive,
      jump: m.jump,
      melee: m.melee,
      skills: m.skills as [boolean, boolean, boolean, boolean],
    });
  }

  private applyRemoteBuy(playerId: string, itemId: string): void {
    const hero = this.heroes.find((h) => h.owner === playerId && h.alive);
    if (!hero) return;
    const item = ITEMS.find((i) => i.id === itemId);
    if (!item) return;
    if (hero.items.some((k) => k.id === item.id)) return;
    if (hero.items.length >= MAX_ITEM_SLOTS) return;
    if (hero.gold >= item.cost) {
      hero.gold -= item.cost;
      hero.items.push(item);
    }
  }

  private broadcastState(dt: number): void {
    this.netStateTimer -= dt;
    if (this.netStateTimer > 0 || !this.net) return;
    this.netStateTimer = 0.066; // ~15Hz
    this.net.sendState({
      time: this.time,
      gameState: this.state === 'ended' ? 'ended' : 'playing',
      winner: this.winner,
      heroes: this.heroes.map((h) => ({
        id: h.id,
        owner: h.owner,
        team: h.team,
        heroId: h.heroDef.id,
        name: h.name,
        x: h.pos.x,
        y: h.pos.y,
        hp: Math.round(h.hp),
        maxHp: h.maxHp,
        ink: Math.round(h.ink),
        inkMax: h.stats.inkMax,
        facing: h.facing,
        level: h.level,
        gold: Math.floor(h.gold),
        kills: h.kills,
        deaths: h.deaths,
        creepKills: h.creepKills,
        alive: h.alive,
        isDiving: h.isDiving,
        shield: h.shield,
        stealth: h.stealthTimer > 0,
        respawnTimer: h.respawnTimer,
        items: h.items.map((i) => i.id),
        skillCooldowns: h.skillCooldowns.map((c) => Math.max(0, c)),
        ultCharge: h.ultCharge,
      })),
      minions: this.minions.map((m) => ({ id: m.id, team: m.team, x: m.pos.x, y: m.pos.y, hp: Math.round(m.hp), maxHp: m.maxHp })),
      towers: this.towers.map((t) => ({ id: t.id, team: t.team, x: t.pos.x, y: t.pos.y, hp: Math.round(t.hp), maxHp: t.maxHp })),
      bases: this.bases.map((b) => ({ id: b.id, team: b.team, x: b.pos.x, y: b.pos.y, hp: Math.round(b.hp), maxHp: b.maxHp })),
      projectiles: this.projectiles.map((p) => ({ x: p.pos.x, y: p.pos.y, r: p.radius, color: p.color, team: p.team })),
      money: this.moneyPickups.map((mp) => ({ x: mp.pos.x, y: mp.pos.y, team: mp.team })),
      ink: this.encodeInk(),
    });
  }

  private encodeInk(): string {
    const step = 4;
    let s = '';
    for (let cy = 0; cy < this.ink.rows; cy += step) {
      for (let cx = 0; cx < this.ink.cols; cx += step) {
        const o = this.ink.owner[cy * this.ink.cols + cx];
        s += o === -1 ? '0' : o === 0 ? '1' : '2';
      }
    }
    return s;
  }

  updateLobby(dt: number): void {
    void dt;
    if (this.lobbyMode === 'joinInput') {
      // 键盘输入房间码
      const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      // 通过 keydown 事件已由 Input 捕获，这里用 code 检测字符
      for (const ch of keys) {
        const code = 'Key' + ch;
        if (this.input.justPressed(code) && this.codeInput.length < 6) {
          this.codeInput += ch;
        }
      }
      for (const d of '0123456789') {
        if (this.input.justPressed('Digit' + d) && this.codeInput.length < 6) this.codeInput += d;
      }
      if (this.input.justPressed('Backspace')) this.codeInput = this.codeInput.slice(0, -1);
      if (this.input.justPressed('Enter')) {
        if (this.codeInput.length === 6) {
          this.net?.joinRoom(this.codeInput.toUpperCase());
          this.lobbyMode = 'home';
        }
      }
      if (this.input.justPressed('Escape')) this.lobbyMode = 'home';
      return;
    }

    if (this.lobbyMode === 'home') {
      if (this.input.justPressed('Escape')) this.leaveToMenu();
      if (this.input.mouseJustPressed) this.handleLobbyHomeClick();
    } else if (this.lobbyMode === 'inRoom') {
      if (this.input.justPressed('Escape')) {
        this.net?.leave();
        this.lobbyMode = 'home';
        this.roomSlots = [];
        this.roomCode = '';
      }
      if (this.input.mouseJustPressed) this.handleLobbyRoomClick();
    }
  }

  private handleLobbyHomeClick(): void {
    const { x, y } = this.input.mouse;
    const w = this.camera.viewW;
    // 创建房间按钮
    if (this.inRect(x, y, w / 2 - 140, this.camera.viewH * 0.5, 280, 50)) {
      this.net?.createRoom();
      this.lobbyMode = 'home'; // 等待 joined
    }
    // 加入房间按钮
    if (this.inRect(x, y, w / 2 - 140, this.camera.viewH * 0.5 + 70, 280, 50)) {
      this.lobbyMode = 'joinInput';
      this.codeInput = '';
    }
  }

  private handleLobbyRoomClick(): void {
    const { x, y } = this.input.mouse;
    const w = this.camera.viewW;
    const h = this.camera.viewH;
    const slotW = 300;
    const gap = 40;
    const total = slotW * 2 + gap;
    const startX = (w - total) / 2;
    const startY = h * 0.3;
    for (let i = 0; i < 6; i++) {
      const col = i < 3 ? 0 : 1;
      const row = i % 3;
      const sx = startX + col * (slotW + gap);
      const sy = startY + row * 78;
      if (this.inRect(x, y, sx, sy, slotW, 64)) {
        const cur = this.roomSlots[i];
        if (cur?.playerId === this.myPlayerId) {
          const heroIds = ['tank', 'assassin', 'ranger'];
          const idx = heroIds.indexOf(cur.heroId ?? 'tank');
          this.net?.updateSlot(i, heroIds[(idx + 1) % 3]);
        } else if (!cur?.playerId) {
          this.net?.updateSlot(i, ['tank', 'assassin', 'ranger'][row]);
        }
        return;
      }
    }
    if (this.myPlayerId === this.roomHostId && this.inRect(x, y, w / 2 - 120, h * 0.84, 240, 50)) {
      this.net?.startGame();
    }
  }

  private inRect(x: number, y: number, rx: number, ry: number, rw: number, rh: number): boolean {
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  }

  private handleMenuClick(): void {
    const { x, y } = this.input.mouse;
    const w = this.camera.viewW;
    if (this.inRect(x, y, w / 2 - 140, this.camera.viewH * 0.5, 280, 50)) this.toSelect();
    if (this.inRect(x, y, w / 2 - 140, this.camera.viewH * 0.5 + 70, 280, 50)) this.enterLobby();
  }

  // —— 小兵波次 ——
  updateMinionWaves(dt: number): void {
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = 25;
      this.waveCount++;
      const tier = Math.floor(this.waveCount / 2);
      for (let team = 0 as Team; team <= 1; team++) {
        for (let i = 0; i < 4; i++) {
          const sx = team === 0 ? 300 : 4100;
          const sy = LANE_Y + (i - 1.5) * 46;
          const kind: 'melee' | 'ranged' = i < 2 ? 'melee' : 'ranged'; // 2 近战 + 2 远程
          this.minions.push(new Minion(team, { x: sx, y: sy }, enemyBaseX(team), tier, kind));
        }
      }
    }
  }

  handleRespawns(): void {
    for (const h of this.heroes) {
      if (!h.alive && h.respawnTimer <= 0) {
        h.alive = true;
        h.hp = h.maxHp;
        h.ink = h.stats.inkMax;
        h.respawnTimer = 0;
        const sp = this.heroSpawn(h.team, 0);
        h.pos = { ...sp };
        h.shield = 0; h.bleedDps = 0; h.bleedTimer = 0; h.slowFactor = 0; h.slowTimer = 0;
        h.stealthTimer = 0; h.speedTimer = 0; h.defBoost = 0;
      }
    }
  }

  passiveGold(dt: number): void {
    for (const h of this.heroes) if (h.alive) this.grantGold(h, PASSIVE_GOLD_PER_SEC * dt);
  }

  // 清理已死亡的小兵与塔（在非迭代处调用，避免数组突变）
  cleanupDead(): void {
    this.minions = this.minions.filter((m) => m.alive);
    this.towers = this.towers.filter((t) => t.alive);
  }

  // 发放金钱（同时累计 totalGold 决定等级，消费不会降级）
  grantGold(h: Hero, amount: number): void {
    h.gold += amount;
    h.totalGold += amount;
  }

  // 队友平分金钱（只分给存活队友）
  splitGoldAmongTeam(team: Team, amount: number): void {
    const allies = this.heroes.filter((h) => h.team === team && h.alive);
    if (allies.length === 0) return;
    const share = amount / allies.length;
    for (const a of allies) this.grantGold(a, share);
  }

  // 掉落金钱：涂到己方墨水后被吸附收集
  updateMoneyPickups(dt: number): void {
    for (const p of this.moneyPickups) {
      if (!p.alive) continue;
      p.update(dt);
      if (!p.alive) continue;
      if (this.ink.ownerAt(p.pos.x, p.pos.y) !== p.team) continue;
      const ally = this.nearestAllyHero(p.team, p.pos, MONEY_SUCTION_RADIUS);
      if (!ally) continue;
      const d = dist(p.pos, ally.pos);
      const dir = norm({ x: ally.pos.x - p.pos.x, y: ally.pos.y - p.pos.y });
      if (d <= MONEY_COLLECT_RADIUS) {
        this.splitGoldAmongTeam(p.team, p.amount);
        this.spawnBurst(p.pos, '#fde047', 16, 240, 4, 0.5);
        this.spawnBurst(p.pos, TEAM_COLORS[p.team === 0 ? 'blue' : 'red'].main, 8, 150, 3, 0.4);
        p.alive = false;
        continue;
      }
      const step = Math.min(MONEY_SUCTION_SPEED * dt, d);
      p.pos = { x: p.pos.x + dir.x * step, y: p.pos.y + dir.y * step };
      if (Math.random() < 0.5) this.spawnBurst(p.pos, '#fde047', 1, 40, 2, 0.25);
    }
    this.moneyPickups = this.moneyPickups.filter((p) => p.alive);
  }

  nearestAllyHero(team: Team, pos: Vec2, range: number): Hero | null {
    let best: Hero | null = null;
    let bestD = range;
    for (const h of this.heroes) {
      if (h.team !== team || !h.alive) continue;
      const d = dist(pos, h.pos);
      if (d <= bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  // —— 粒子 ——
  spawnBurst(pos: Vec2, color: string, count: number, speed: number, size: number, life: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        color,
        size: size * (0.6 + Math.random() * 0.8),
      });
    }
  }

  updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // —— 飘字（伤害数字）——
  spawnFloater(pos: Vec2, amount: number, type: DamageType): void {
    this.floaters.push({
      x: pos.x + (Math.random() - 0.5) * 18,
      y: pos.y - 30,
      text: Math.round(amount).toString(),
      color: DAMAGE_COLORS[type],
      life: 0.8,
      maxLife: 0.8,
    });
  }

  updateFloaters(dt: number): void {
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 40 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  // 基地回血光环
  applyBaseHeal(dt: number): void {
    for (const h of this.heroes) {
      if (!h.alive) continue;
      const base = this.bases.find((b) => b.team === h.team && b.alive);
      if (base && dist(h.pos, base.pos) < BASE_HEAL_RADIUS) {
        h.heal((h.maxHp * BASE_HEAL_RATE + 30) * dt);
      }
    }
  }

  botBuy(): void {
    for (const h of this.heroes) {
      if (h === this.player || !h.alive) continue;
      if (h.items.length >= MAX_ITEM_SLOTS) continue;
      const affordable = ITEMS.filter((i) => i.cost <= h.gold && !h.items.includes(i));
      if (affordable.length === 0) continue;
      // 优先购买最贵且尚未拥有的
      affordable.sort((a, b) => b.cost - a.cost);
      const item = affordable[0];
      h.gold -= item.cost;
      h.items.push(item);
    }
  }

  // —— 投射物 ——
  updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.update(dt);
      // 弹道涂墨
      if (p.paintRadius > 0 && p.alive) {
        this.ink.paint(p.pos.x, p.pos.y, p.paintRadius, p.team, 0.5);
      }
      // 射程耗尽爆炸（手雷）
      if (!p.alive && p.onHit === 'explode') {
        this.explode(p.pos, p.team, p.sourceId, p.effectValue ?? p.damage, p.explodeRadius ?? 120, p.sourceLabel ?? '爆炸');
        continue;
      }
      if (!p.alive) continue;

      // 命中检测
      const hit = this.firstEnemyHit(p);
      if (hit) {
        this.dealDamage(hit, p.damage, p.type, p.team, p.sourceId, true, p.sourceLabel ?? '投射物');
        this.spawnBurst(p.pos, DAMAGE_COLORS[p.type], 5, 180, 3, 0.3);
        if (p.onHit === 'bleed' && hit instanceof Hero) {
          hit.bleedDps = p.effectValue ?? 30;
          hit.bleedTimer = 4;
          hit.bleedType = 'magic';
          // 记录流血施加（只记一次，不逐帧刷屏）
          const bleedEntry: DamageLogEntry = {
            t: this.time,
            source: '流血·影刃',
            target: `${hit.name}#${hit.id}`,
            type: 'magic',
            raw: hit.bleedDps * 4,
            final: hit.bleedDps * 4,
            x: Math.round(hit.pos.x),
            y: Math.round(hit.pos.y),
          };
          this.damageLog.push(bleedEntry);
          if (this.damageLog.length > 400) this.damageLog.shift();
          console.log(`[dmg t=${this.time.toFixed(1)}s] 流血·影刃 → ${hit.name}#${hit.id} 施加流血 ${hit.bleedDps}/秒 × 4秒`);
        }
        if (p.onHit === 'explode') {
          this.explode(p.pos, p.team, p.sourceId, p.effectValue ?? p.damage, p.explodeRadius ?? 120, p.sourceLabel ?? '爆炸');
          p.alive = false;
          continue;
        }
        p.hitIds.add(hit.id);
        if (p.pierce > 0) {
          p.pierce--;
          continue;
        }
        p.alive = false;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  firstEnemyHit(p: Projectile): Unit | null {
    for (const u of this.enemyUnits(p.team, true)) {
      if (p.hitIds.has(u.id)) continue;
      if (dist(p.pos, u.pos) <= p.radius + u.radius) return u;
    }
    return null;
  }

  explode(pos: Vec2, team: Team, sourceId: number, damage: number, radius: number, sourceLabel = '爆炸'): void {
    this.ink.paint(pos.x, pos.y, radius, team, 1);
    for (const u of this.enemyUnits(team, true)) {
      if (dist(pos, u.pos) <= radius + u.radius) {
        this.dealDamage(u, damage, 'magic', team, sourceId, true, sourceLabel);
      }
    }
    this.spawnBurst(pos, DAMAGE_COLORS.magic, 22, 420, 5, 0.45);
  }

  spawnProjectile(opts: ConstructorParameters<typeof Projectile>[0]): void {
    this.projectiles.push(new Projectile(opts));
  }

  castSkill(hero: Hero, index: number): void {
    castSkillImpl(this, hero, index);
  }

  // —— 伤害结算 ——
  dealDamage(target: Unit, raw: number, type: DamageType, sourceTeam: Team, sourceId: number, grantUlt = true, sourceLabel = ''): void {
    if (!target.alive || raw <= 0) return;
    let defense = 0;
    let pen = 0;
    if (target instanceof Hero) {
      defense = type === 'bullet' ? target.stats.bulletDef : target.stats.magicDef;
    }
    const src = this.heroById(sourceId);
    if (src) {
      pen = type === 'bullet' ? src.stats.bulletPen : src.stats.magicPen;
    }
    const effDef = Math.max(0, defense - pen);
    const dmg = raw * (100 / (100 + effDef));

    // 记录伤害来源日志
    this.logDamage(target, raw, dmg, type, sourceId, sourceLabel);

    if (target instanceof Hero) {
      target.takeDamage(this, dmg, type, sourceTeam, sourceId, grantUlt);
    } else {
      target.applyRawDamage(dmg);
    }

    // 伤害来源/数值提示：英雄受击显示飘字，玩家受击红屏
    if (target instanceof Hero && dmg >= 3) {
      this.spawnFloater(target.pos, dmg, type);
      if (target === this.player) this.playerHitFlash = 0.3;
    }

    if (!target.alive) this.onKill(target, sourceId);
  }

  // 伤害来源日志（同时输出到浏览器控制台）
  logDamage(target: Unit, raw: number, final: number, type: DamageType, sourceId: number, sourceLabel: string): void {
    if (sourceId < 0) return; // 流血逐帧伤害不逐条记录，改为施加时记录一次（见 updateProjectiles）
    let source = sourceLabel;
    if (!source) {
      const h = this.heroById(sourceId);
      if (h) source = `${h.name}(英雄)`;
      else {
        const t = this.towers.find((x) => x.id === sourceId);
        const m = this.minions.find((x) => x.id === sourceId);
        if (t) source = t.name;
        else if (m) source = m.name;
        else source = '未知';
      }
    }
    const entry: DamageLogEntry = {
      t: this.time,
      source,
      target: `${target.name}#${target.id}`,
      type,
      raw: Math.round(raw * 10) / 10,
      final: Math.round(final * 10) / 10,
      x: Math.round(target.pos.x),
      y: Math.round(target.pos.y),
    };
    this.damageLog.push(entry);
    if (this.damageLog.length > 400) this.damageLog.shift();
    // 控制台日志：仅打印与英雄相关的伤害，避免小兵噪声刷屏
    if (target instanceof Hero || sourceId < 0 || this.heroById(sourceId)) {
      console.log(
        `[dmg t=${entry.t.toFixed(1)}s] ${source} → ${entry.target} ${type} 原始${entry.raw} 实际${entry.final} @(${entry.x},${entry.y})`,
      );
    }
  }

  // 复制伤害日志到剪贴板（按 L）
  private copyDamageLog(): void {
    const text = this.damageLog
      .map((e) => `t=${e.t.toFixed(1)}s ${e.source} → ${e.target} ${e.type} 原始${e.raw} 实际${e.final} @(${e.x},${e.y})`)
      .join('\n');
    if (navigator.clipboard && text) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          this.logCopied = true;
          window.setTimeout(() => (this.logCopied = false), 1600);
        })
        .catch(() => {});
    }
  }

  onKill(target: Unit, sourceId: number): void {
    const src = this.heroById(sourceId);
    if (target instanceof Minion) {
      // 击杀小兵：立即发放一半（队友平分），另一半掉落为金钱，涂墨收集
      const killerTeam = this.teamOf(sourceId);
      const half = target.bounty / 2;
      if (killerTeam != null) {
        this.splitGoldAmongTeam(killerTeam, half);
        if (src && src.team !== target.team) src.creepKills++;
        this.moneyPickups.push(new MoneyPickup(killerTeam, { ...target.pos }, target.bounty - half));
      }
    } else if (target instanceof Hero) {
      target.deaths++;
      target.respawnTimer = 6;
      if (src && src.team !== target.team) {
        src.kills++;
        this.grantGold(src, 300);
      }
    } else if (target instanceof Tower) {
      if (src) this.grantGold(src, 250);
    }
  }

  // 根据 sourceId 判断击杀来源的队伍（英雄/塔/小兵）
  teamOf(sourceId: number): Team | null {
    if (sourceId < 0) return null;
    const h = this.heroById(sourceId);
    if (h) return h.team;
    const t = this.towers.find((x) => x.id === sourceId);
    if (t) return t.team;
    const m = this.minions.find((x) => x.id === sourceId);
    if (m) return m.team;
    return null;
  }

  // —— 查询辅助 ——
  heroById(id: number): Hero | undefined {
    return this.heroes.find((h) => h.id === id);
  }

  enemyUnits(team: Team, includeMinions: boolean, filterKind?: 'hero' | 'minion' | 'tower' | 'base'): Unit[] {
    const out: Unit[] = [];
    for (const h of this.heroes) if (h.team !== team && h.alive && (!filterKind || filterKind === 'hero')) out.push(h);
    if (includeMinions) for (const m of this.minions) if (m.team !== team && m.alive && (!filterKind || filterKind === 'minion')) out.push(m);
    for (const t of this.towers) if (t.team !== team && t.alive && (!filterKind || filterKind === 'tower')) out.push(t);
    for (const b of this.bases) if (b.team !== team && b.alive && (!filterKind || filterKind === 'base')) out.push(b);
    return out;
  }

  nearestEnemy(team: Team, pos: Vec2, range: number, includeMinions: boolean, filterKind?: 'hero' | 'minion' | 'tower' | 'base'): Unit | null {
    let best: Unit | null = null;
    let bestD = range;
    for (const u of this.enemyUnits(team, includeMinions, filterKind)) {
      const d = dist(pos, u.pos);
      if (d <= bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  enemiesInArc(team: Team, pos: Vec2, range: number, angle: number, arc: number, includeMinions: boolean): Unit[] {
    const out: Unit[] = [];
    for (const u of this.enemyUnits(team, includeMinions)) {
      const d = dist(pos, u.pos);
      if (d > range + u.radius) continue;
      const a = Math.atan2(u.pos.y - pos.y, u.pos.x - pos.x);
      if (Math.abs(angleDelta(a, angle)) <= arc / 2) out.push(u);
    }
    return out;
  }

  movePoint(p: Vec2, delta: Vec2): Vec2 {
    return {
      x: clamp(p.x + delta.x, 20, MAP_W - 20),
      y: clamp(p.y + delta.y, 20, MAP_H - 20),
    };
  }

  knockback(u: Unit, angle: number, d: number): void {
    u.pos = this.movePoint(u.pos, fromAngle(angle, d));
  }

  paintLine(a: Vec2, b: Vec2, team: Team, amount: number): void {
    const d = dist(a, b);
    const steps = Math.max(1, Math.ceil(d / (INK_CELL * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.ink.paint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 16, team, amount);
    }
  }

  // —— 渲染 ——
  render(): void {
    const { ctx, camera } = this;
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.clearRect(0, 0, camera.viewW, camera.viewH);

    if (this.state === 'menu') { this.renderMenu(); return; }
    if (this.state === 'lobby') { this.renderLobby(); return; }
    if (this.state === 'select') { this.renderSelect(); return; }
    if (this.state === 'ended') {
      if (this.multi && !this.isHost) this.renderRemote();
      else this.renderWorld();
      this.renderEnded();
      return;
    }

    if (this.multi && !this.isHost) {
      this.renderRemote();
      this.renderRemoteHUD();
      return;
    }

    this.renderWorld();
    this.renderHUD();
    if (this.input.isDown('Tab')) this.renderScoreboard();
    if (this.showDamageLog) this.renderDamageLog();
  }

  renderMenu(): void {
    const { ctx, camera } = this;
    ctx.fillStyle = '#0b0e16';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7fd6ff';
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.fillText('墨汁英雄', camera.viewW / 2, camera.viewH * 0.32);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#9aa4b8';
    ctx.fillText('Splatoon × Deadlock · 单兵线射击 MOBA Demo', camera.viewW / 2, camera.viewH * 0.4);

    // 单机按钮
    const bw = 280;
    const bh = 50;
    const bx = camera.viewW / 2 - bw / 2;
    this.roundRect(bx, camera.viewH * 0.5, bw, bh, 10);
    ctx.fillStyle = '#1c2a3f';
    ctx.fill();
    ctx.strokeStyle = '#7fd6ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e8ecf4';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('单机对战', camera.viewW / 2, camera.viewH * 0.5 + 32);

    // 联机按钮
    this.roundRect(bx, camera.viewH * 0.5 + 70, bw, bh, 10);
    ctx.fillStyle = '#1c2a3f';
    ctx.fill();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e8ecf4';
    ctx.fillText('联机房间', camera.viewW / 2, camera.viewH * 0.5 + 102);

    ctx.fillStyle = '#9aa4b8';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('[空格] 单机 · [M] 联机 · 或点击按钮', camera.viewW / 2, camera.viewH * 0.76);
  }

  renderSelect(): void {
    const { ctx, camera } = this;
    ctx.fillStyle = '#0b0e16';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8ecf4';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('选择你的英雄', camera.viewW / 2, camera.viewH * 0.16);

    const w = camera.viewW;
    const cardW = 260;
    const gap = 40;
    const total = cardW * 3 + gap * 2;
    const startX = (w - total) / 2;
    const startY = camera.viewH * 0.26;

    HEROES.forEach((h, i) => {
      const cx = startX + i * (cardW + gap);
      const sel = this.selectedHero === i;
      this.roundRect(cx, startY, cardW, 360, 16);
      ctx.fillStyle = sel ? '#1c2a3f' : '#12161f';
      ctx.fill();
      ctx.strokeStyle = sel ? h.color : '#2a3345';
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.stroke();

      // 头像圆
      ctx.beginPath();
      ctx.arc(cx + cardW / 2, startY + 70, 46, 0, Math.PI * 2);
      ctx.fillStyle = h.color;
      ctx.fill();
      ctx.strokeStyle = h.accent;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#e8ecf4';
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.fillText(h.name, cx + cardW / 2, startY + 150);
      ctx.fillStyle = '#9aa4b8';
      ctx.font = '15px system-ui, sans-serif';
      const role = h.role === 'tank' ? '近战肉盾' : h.role === 'assassin' ? '刺客' : '远程射手';
      ctx.fillText(role, cx + cardW / 2, startY + 176);

      ctx.textAlign = 'left';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = '#c7cfdd';
      const lines = [
        `移速 ${h.base.moveSpeed} · 转向 ${h.base.turnSpeed}`,
        `潜水 ${h.base.diveSpeedMult}× · HP ${h.base.maxHp}`,
        `武器 ${h.weapon.name}`,
      ];
      lines.forEach((t, j) => ctx.fillText(t, cx + 20, startY + 216 + j * 24));

      const keys = ['Q', 'W', 'E'];
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7fd6ff';
      ctx.fillText(`按 [${keys[i]}] 选择`, cx + cardW / 2, startY + 330);
      ctx.textAlign = 'left';
    });
  }

  // ================= 联机渲染 =================
  private drawButton(x: number, y: number, w: number, h: number, label: string, color: string): void {
    const { ctx } = this;
    this.roundRect(x, y, w, h, 10);
    ctx.fillStyle = '#1c2a3f';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e8ecf4';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 7);
  }

  renderLobby(): void {
    const { ctx, camera } = this;
    ctx.fillStyle = '#0b0e16';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8ecf4';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText('联机房间', camera.viewW / 2, 70);

    if (this.lobbyMode === 'connect') {
      ctx.fillStyle = '#9aa4b8';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('正在连接服务器…', camera.viewW / 2, camera.viewH / 2);
      return;
    }

    if (this.lobbyMode === 'home') {
      if (this.lobbyError) {
        ctx.fillStyle = '#f87171';
        ctx.font = '15px system-ui, sans-serif';
        ctx.fillText(this.lobbyError, camera.viewW / 2, 120);
      }
      this.drawButton(camera.viewW / 2 - 140, camera.viewH * 0.5, 280, 50, '创建房间', '#7fd6ff');
      this.drawButton(camera.viewW / 2 - 140, camera.viewH * 0.5 + 70, 280, 50, '加入房间', '#34d399');
      ctx.fillStyle = '#9aa4b8';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Esc 返回主菜单', camera.viewW / 2, camera.viewH * 0.78);
      return;
    }

    if (this.lobbyMode === 'joinInput') {
      ctx.fillStyle = '#e8ecf4';
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText('输入 6 位房间码', camera.viewW / 2, camera.viewH * 0.4);
      ctx.fillStyle = '#7fd6ff';
      ctx.font = 'bold 44px system-ui, monospace';
      ctx.fillText((this.codeInput + '______').slice(0, 6), camera.viewW / 2, camera.viewH * 0.5);
      ctx.fillStyle = '#9aa4b8';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('回车确认 · Backspace 删除 · Esc 取消', camera.viewW / 2, camera.viewH * 0.6);
      return;
    }

    // inRoom
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText('房间码：' + (this.roomCode || '…'), camera.viewW / 2, 110);
    const isHost = this.myPlayerId === this.roomHostId;
    ctx.fillStyle = '#9aa4b8';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(isHost ? '你是房主' : '等待房主开始游戏', camera.viewW / 2, 140);

    const slotW = 300;
    const gap = 40;
    const total = slotW * 2 + gap;
    const startX = (camera.viewW - total) / 2;
    const startY = camera.viewH * 0.3;
    const heroNames: Record<string, string> = { tank: '重装', assassin: '影', ranger: '猎手' };
    for (let i = 0; i < 6; i++) {
      const col = i < 3 ? 0 : 1;
      const row = i % 3;
      const sx = startX + col * (slotW + gap);
      const sy = startY + row * 78;
      const slot = this.roomSlots[i];
      const mine = slot?.playerId === this.myPlayerId;
      const occupied = !!slot?.playerId;
      ctx.fillStyle = mine ? 'rgba(52,211,153,0.18)' : 'rgba(20,26,38,0.9)';
      this.roundRect(sx, sy, slotW, 64, 8);
      ctx.fill();
      ctx.strokeStyle = mine ? '#34d399' : col === 0 ? TEAM_COLORS.blue.main : TEAM_COLORS.red.main;
      ctx.lineWidth = mine ? 2.5 : 1.5;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = col === 0 ? '#9cc3ff' : '#ffb3ba';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText((col === 0 ? '蓝' : '红') + (row + 1) + (mine ? ' (你)' : ''), sx + 12, sy + 24);
      ctx.fillStyle = occupied ? '#e8ecf4' : '#64748b';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(occupied ? (slot!.name || '玩家') : 'AI 补位', sx + 90, sy + 24);
      ctx.fillStyle = occupied ? '#7fd6ff' : '#9aa4b8';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(slot?.heroId ? heroNames[slot.heroId] || slot.heroId : occupied ? '未选英雄' : '-', sx + 90, sy + 46);
    }

    if (isHost) {
      this.drawButton(camera.viewW / 2 - 120, camera.viewH * 0.84, 240, 50, '开始游戏', '#34d399');
    }
    ctx.fillStyle = '#9aa4b8';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('点击空位加入 · 点击自己槽位切换英雄 · Esc 离开房间', camera.viewW / 2, camera.viewH * 0.93);
  }

  renderRemote(): void {
    const { ctx, camera } = this;
    const st = this.remote;
    if (!st) {
      ctx.fillStyle = '#0b0e16';
      ctx.fillRect(0, 0, camera.viewW, camera.viewH);
      ctx.fillStyle = '#9aa4b8';
      ctx.font = '18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待房主数据…', camera.viewW / 2, camera.viewH / 2);
      return;
    }
    ctx.fillStyle = '#141824';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    ctx.fillStyle = '#151a26';
    ctx.fillRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = '#1d2432';
    ctx.fillRect(0, LANE_Y - 90, MAP_W, 180);
    ctx.fillStyle = '#1a212e';
    ctx.fillRect(0, SIDE_ROAD_TOP - SIDE_ROAD_WIDTH / 2, MAP_W, SIDE_ROAD_WIDTH);
    ctx.fillRect(0, SIDE_ROAD_BOTTOM - SIDE_ROAD_WIDTH / 2, MAP_W, SIDE_ROAD_WIDTH);

    this.drawRemoteInk(st.ink);

    for (const b of st.bases) this.drawRemoteUnit(b, 'base');
    for (const t of st.towers) this.drawRemoteUnit(t, 'tower');

    const units: Array<NetUnit | NetHero> = [...st.minions, ...st.heroes];
    units.sort((a, b) => a.y - b.y);
    for (const u of units) {
      if ('heroId' in u) {
        this.drawRemoteHero(u);
      } else {
        this.drawRemoteMinion(u);
      }
    }
    for (const p of st.projectiles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    for (const m of st.money) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
    }
    ctx.restore();
    this.renderRemoteMinimap(st);
  }

  private drawRemoteInk(inkStr: string): void {
    const { ctx } = this;
    const step = 4;
    let idx = 0;
    for (let cy = 0; cy < this.ink.rows; cy += step) {
      for (let cx = 0; cx < this.ink.cols; cx += step) {
        const ch = inkStr[idx++];
        if (ch === '0' || ch === undefined) continue;
        ctx.fillStyle = ch === '1' ? TEAM_COLORS.blue.ink : TEAM_COLORS.red.ink;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(cx * INK_CELL, cy * INK_CELL, INK_CELL * step, INK_CELL * step);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawRemoteUnit(u: import('../net/protocol').NetUnit, kind: 'tower' | 'base'): void {
    const { ctx } = this;
    const col = u.team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.red;
    const r = kind === 'tower' ? TOWER_RADIUS : BASE_RADIUS;
    ctx.beginPath();
    ctx.arc(u.x, u.y, r, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'tower' ? '#0e1219' : col.dark;
    ctx.fill();
    ctx.strokeStyle = col.main;
    ctx.lineWidth = kind === 'tower' ? 3 : 5;
    ctx.stroke();
    if (kind === 'tower') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const rr = r * 0.7;
        const px = u.x + Math.cos(a) * rr;
        const py = u.y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = col.main;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(u.x, u.y, 580, 0, Math.PI * 2);
      ctx.fillStyle = col.main + '18';
      ctx.fill();
      ctx.strokeStyle = col.main + '66';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    this.drawRemoteHpBar(u.x, u.y - r - 14, r * 2, u.hp / u.maxHp);
  }

  private drawRemoteHpBar(x: number, y: number, w: number, pct: number): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2, y, w, 5);
    ctx.fillStyle = pct > 0.5 ? '#34d399' : pct > 0.25 ? '#fbbf24' : '#ef4444';
    ctx.fillRect(x - w / 2, y, w * clamp(pct, 0, 1), 5);
  }

  private drawRemoteHero(h: import('../net/protocol').NetHero): void {
    const { ctx } = this;
    if (!h.alive) return;
    const col = h.team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.red;
    const r = getHeroDef(h.heroId).radius || HERO_RADIUS;
    if (h.isDiving) {
      ctx.beginPath();
      ctx.ellipse(h.x, h.y + 4, r * 1.2, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = h.team === 0 ? TEAM_COLORS.blue.ink : TEAM_COLORS.red.ink;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
      ctx.fillStyle = col.main;
      ctx.fill();
      ctx.strokeStyle = h.team === 0 ? '#9cc3ff' : '#ffb3ba';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x + Math.cos(h.facing) * (r + 12), h.y + Math.sin(h.facing) * (r + 12));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (h.shield > 0) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(125,211,255,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    this.drawRemoteHpBar(h.x, h.y - r - 14, r * 2, h.hp / h.maxHp);
    ctx.textAlign = 'center';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = h.team === 0 ? '#9cc3ff' : '#ffb3ba';
    ctx.fillText(h.name, h.x, h.y - r - 20);
  }

  private drawRemoteMinion(m: import('../net/protocol').NetUnit): void {
    const { ctx } = this;
    const col = m.team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.red;
    ctx.beginPath();
    ctx.arc(m.x, m.y, MINION_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = col.main;
    ctx.fill();
    this.drawRemoteHpBar(m.x, m.y - MINION_RADIUS - 8, MINION_RADIUS * 2, m.hp / m.maxHp);
  }

  private renderRemoteMinimap(st: NetState): void {
    const { ctx, camera } = this;
    const mw = 220;
    const mh = 130;
    const mx = camera.viewW - mw - 16;
    const my = 16;
    const sx = mw / MAP_W;
    const sy = mh / MAP_H;
    ctx.fillStyle = 'rgba(10,13,20,0.75)';
    this.roundRect(mx, my, mw, mh, 6);
    ctx.fill();
    ctx.strokeStyle = '#2a3345';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const b of st.bases) {
      ctx.fillStyle = b.team === 0 ? '#7ab1ff' : '#ff8791';
      ctx.fillRect(mx + b.x * sx - 4, my + b.y * sy - 4, 8, 8);
    }
    for (const t of st.towers) {
      ctx.fillStyle = '#e8ecf4';
      ctx.fillRect(mx + t.x * sx - 2.5, my + t.y * sy - 2.5, 5, 5);
    }
    for (const h of st.heroes) {
      if (!h.alive) continue;
      ctx.fillStyle = h.owner === this.myPlayerId ? '#ffffff' : h.team === 0 ? '#9cc3ff' : '#ffb3ba';
      ctx.beginPath();
      ctx.arc(mx + h.x * sx, my + h.y * sy, h.owner === this.myPlayerId ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderRemoteHUD(): void {
    const { ctx, camera } = this;
    const st = this.remote;
    if (!st) return;
    const me = st.heroes.find((h) => h.owner === this.myPlayerId);
    if (!me) return;
    const barX = 20;
    const barW = 260;
    const barY = camera.viewH - 70;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this.roundRect(barX - 6, barY - 8, barW + 12, 40, 6);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(barX, barY, barW, 10);
    ctx.fillStyle = '#34d399';
    ctx.fillRect(barX, barY, barW * clamp(me.hp / me.maxHp, 0, 1), 10);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(barX, barY + 14, barW, 10);
    ctx.fillStyle = '#7fd6ff';
    ctx.fillRect(barX, barY + 14, barW * clamp(me.ink / me.inkMax, 0, 1), 10);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.ceil(me.hp)}/${me.maxHp}`, barX, barY - 12);

    const def = getHeroDef(me.heroId);
    const skX = camera.viewW / 2 - 120;
    const skY = camera.viewH - 78;
    for (let i = 0; i < 4; i++) {
      const x = skX + i * 62;
      const sk = def.skills[i];
      const isR = sk.isUltimate;
      const ready = isR ? me.ultCharge >= 1 : (me.skillCooldowns[i] ?? 0) <= 0;
      ctx.fillStyle = ready ? 'rgba(30,41,59,0.85)' : 'rgba(15,20,30,0.85)';
      this.roundRect(x, skY, 54, 54, 8);
      ctx.fill();
      ctx.strokeStyle = i === 3 ? '#fbbf24' : '#7fd6ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = ready ? '#e8ecf4' : '#64748b';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(['Q', 'E', 'F', 'R'][i], x + 27, skY + 32);
      if (!ready && !isR) {
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(Math.ceil(me.skillCooldowns[i] ?? 0) + '', x + 27, skY + 30);
      }
    }

    ctx.textAlign = 'left';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`金币 ${me.gold}`, 20, 36);
    ctx.fillStyle = '#7fd6ff';
    ctx.fillText(`Lv.${me.level}`, 150, 36);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#c7cfdd';
    ctx.fillText(`击杀 ${me.kills} / 死亡 ${me.deaths} / 补刀 ${me.creepKills}`, 20, 56);

    for (let i = 0; i < MAX_ITEM_SLOTS; i++) {
      const x = 20 + i * 44;
      const y = 66;
      ctx.fillStyle = 'rgba(15,20,30,0.8)';
      this.roundRect(x, y, 38, 38, 6);
      ctx.fill();
      ctx.strokeStyle = '#2a3345';
      ctx.lineWidth = 1;
      ctx.stroke();
      const id = me.items[i];
      if (id) {
        const it = ITEMS.find((k) => k.id === id);
        if (it) {
          const catCol = it.category === 'defense' ? '#38bdf8' : it.category === 'bulletAttack' ? '#f87171' : '#a78bfa';
          ctx.fillStyle = it.color ?? catCol;
          ctx.fillRect(x + 5, y + 5, 28, 28);
        }
      }
    }
    ctx.fillStyle = '#7fd6ff';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('[B] 商店 · [Shift] 潜水 · [Space] 跳跃 · [V] 近战', 20, 124);
    if (this.shopOpen) this.renderRemoteShop(me);
  }

  private renderRemoteShop(me: import('../net/protocol').NetHero): void {
    const { ctx } = this;
    const L = this.shopLayout();
    ctx.fillStyle = 'rgba(10,13,20,0.95)';
    this.roundRect(L.px, L.py, L.pw, L.ph, 12);
    ctx.fill();
    ctx.strokeStyle = '#2a3345';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    ctx.fillText('商店（点击购买 · 按 B 关闭）', L.px + L.pw / 2, L.py + 30);
    const catNames = { defense: '防御', bulletAttack: '子弹攻击', magicAttack: '魔法攻击' } as const;
    const catColors = { defense: '#38bdf8', bulletAttack: '#f87171', magicAttack: '#a78bfa' } as const;
    L.cats.forEach((cat, ci) => {
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillStyle = catColors[cat];
      ctx.fillText(catNames[cat], L.px + ci * L.colW + L.colW / 2, L.py + 60);
    });
    for (const r of L.rects) {
      const it = r.item;
      const owned = me.items.includes(it.id);
      const afford = me.gold >= it.cost;
      const slotsFull = me.items.length >= MAX_ITEM_SLOTS;
      ctx.fillStyle = owned ? 'rgba(30,58,48,0.8)' : 'rgba(20,26,38,0.9)';
      this.roundRect(r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.strokeStyle = owned ? '#34d399' : '#2a3345';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = it.color ?? catColors[it.category];
      ctx.fillRect(r.x + 8, r.y + 10, 34, 34);
      ctx.textAlign = 'left';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillStyle = owned ? '#34d399' : '#e8ecf4';
      ctx.fillText(owned ? '✓ ' + it.name : it.name, r.x + 50, r.y + 22);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#9aa4b8';
      ctx.fillText(it.desc, r.x + 50, r.y + 42);
      ctx.fillStyle = afford && !slotsFull ? '#fbbf24' : '#ef4444';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(owned ? '已购买' : `${it.cost} 金币`, r.x + 50, r.y + 64);
    }
  }

  private handleRemoteShopClick(me: import('../net/protocol').NetHero): void {
    const { x, y } = this.input.mouse;
    for (const r of this.shopLayout().rects) {
      if (this.inRect(x, y, r.x, r.y, r.w, r.h)) {
        if (me.items.includes(r.item.id)) return;
        if (me.items.length >= MAX_ITEM_SLOTS) return;
        if (me.gold >= r.item.cost) this.net?.buyItem(r.item.id);
        return;
      }
    }
  }

  renderWorld(): void {
    const { ctx, camera } = this;
    // 地面
    ctx.fillStyle = '#141824';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // 地图底色
    ctx.fillStyle = '#151a26';
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    // 兵线（主路）
    ctx.fillStyle = '#1d2432';
    ctx.fillRect(0, LANE_Y - 90, MAP_W, 180);

    // 侧边道路（绕后 / 偷袭）
    ctx.fillStyle = '#1a212e';
    ctx.fillRect(0, SIDE_ROAD_TOP - SIDE_ROAD_WIDTH / 2, MAP_W, SIDE_ROAD_WIDTH);
    ctx.fillRect(0, SIDE_ROAD_BOTTOM - SIDE_ROAD_WIDTH / 2, MAP_W, SIDE_ROAD_WIDTH);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([14, 12]);
    ctx.beginPath();
    ctx.moveTo(0, SIDE_ROAD_TOP - SIDE_ROAD_WIDTH / 2);
    ctx.lineTo(MAP_W, SIDE_ROAD_TOP - SIDE_ROAD_WIDTH / 2);
    ctx.moveTo(0, SIDE_ROAD_TOP + SIDE_ROAD_WIDTH / 2);
    ctx.lineTo(MAP_W, SIDE_ROAD_TOP + SIDE_ROAD_WIDTH / 2);
    ctx.moveTo(0, SIDE_ROAD_BOTTOM - SIDE_ROAD_WIDTH / 2);
    ctx.lineTo(MAP_W, SIDE_ROAD_BOTTOM - SIDE_ROAD_WIDTH / 2);
    ctx.moveTo(0, SIDE_ROAD_BOTTOM + SIDE_ROAD_WIDTH / 2);
    ctx.lineTo(MAP_W, SIDE_ROAD_BOTTOM + SIDE_ROAD_WIDTH / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 墨水格
    const minCx = Math.max(0, Math.floor(camera.x / INK_CELL));
    const maxCx = Math.min(this.ink.cols - 1, Math.floor((camera.x + camera.viewW) / INK_CELL));
    const minCy = Math.max(0, Math.floor(camera.y / INK_CELL));
    const maxCy = Math.min(this.ink.rows - 1, Math.floor((camera.y + camera.viewH) / INK_CELL));
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const o = this.ink.owner[cy * this.ink.cols + cx] as number;
        const amt = this.ink.amount[cy * this.ink.cols + cx] as number;
        if (o < 0 || amt <= 0) continue;
        const col = o === 0 ? TEAM_COLORS.blue : TEAM_COLORS.red;
        ctx.globalAlpha = 0.25 + amt * 0.4;
        ctx.fillStyle = col.main;
        ctx.fillRect(cx * INK_CELL, cy * INK_CELL, INK_CELL, INK_CELL);
      }
    }
    ctx.globalAlpha = 1;

    // 基地
    for (const b of this.bases) if (b.alive) this.drawBase(b);
    // 塔
    for (const t of this.towers) if (t.alive) this.drawTower(t);

    // 按 y 排序绘制单位
    const units: Unit[] = [...this.minions, ...this.heroes];
    units.sort((a, b) => a.pos.y - b.pos.y);
    for (const u of units) {
      if (!u.alive) continue;
      if (u instanceof Hero) this.drawHero(u);
      else if (u instanceof Minion) this.drawMinion(u);
    }

    // 投射物：核心用伤害类型配色，外圈用队伍色
    for (const p of this.projectiles) {
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.radius + 2, 0, Math.PI * 2);
      ctx.strokeStyle = p.team === 0 ? TEAM_COLORS.blue.main : TEAM_COLORS.red.main;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 粒子
    for (const pt of this.particles) {
      const a = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 伤害飘字
    for (const f of this.floaters) {
      const a = clamp(f.life / f.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // 掉落金钱
    for (const mp of this.moneyPickups) this.drawMoneyPickup(mp);

    ctx.restore();

    this.renderMinimap();
  }

  drawMoneyPickup(mp: MoneyPickup): void {
    const { ctx } = this;
    const bob = Math.sin(this.time * 4 + mp.bob) * 4;
    const col = mp.team === 0 ? '#7ab1ff' : '#ff8791';
    const activated = this.ink.ownerAt(mp.pos.x, mp.pos.y) === mp.team;
    const pulse = activated ? 1 + Math.sin(this.time * 8) * 0.25 : 0;

    // 激活（已被己方墨水涂到）时的外发光
    if (activated) {
      ctx.beginPath();
      ctx.arc(mp.pos.x, mp.pos.y + bob, 20 + pulse * 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(253,224,71,0.18)';
      ctx.fill();
    }

    // 金币
    ctx.beginPath();
    ctx.arc(mp.pos.x, mp.pos.y + bob, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 高光
    ctx.beginPath();
    ctx.arc(mp.pos.x - 2, mp.pos.y + bob - 2, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    // 归属圈
    ctx.beginPath();
    ctx.arc(mp.pos.x, mp.pos.y + bob, 13 + pulse * 3, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = activated ? 2.5 : 1.5;
    ctx.stroke();
    // 剩余时间环
    const pct = clamp(mp.lifetime / MONEY_PICKUP_LIFETIME, 0, 1);
    ctx.beginPath();
    ctx.arc(mp.pos.x, mp.pos.y + bob, 15 + pulse * 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawBase(b: Base): void {
    const { ctx } = this;
    const col = b.team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.red;
    // 回血光环范围
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, BASE_HEAL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(52,211,153,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(52,211,153,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = col.dark;
    ctx.fill();
    ctx.strokeStyle = col.main;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, b.radius * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = col.main;
    ctx.fill();
    this.drawHealthBar(b, b.pos.x, b.pos.y - b.radius - 18, b.radius * 2);
  }

  drawTower(t: Tower): void {
    const { ctx } = this;
    const col = t.team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.red;
    ctx.beginPath();
    ctx.arc(t.pos.x, t.pos.y, t.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#0e1219';
    ctx.fill();
    ctx.strokeStyle = col.main;
    ctx.lineWidth = 3;
    ctx.stroke();
    // 六边形塔
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const r = t.radius * 0.7;
      const px = t.pos.x + Math.cos(a) * r;
      const py = t.pos.y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = col.main;
    ctx.fill();
    // 攻击范围圈（危险区域，清晰可见）
    ctx.beginPath();
    ctx.arc(t.pos.x, t.pos.y, t.range, 0, Math.PI * 2);
    ctx.fillStyle = col.main + '18';
    ctx.fill();
    ctx.strokeStyle = col.main + '66';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawHealthBar(t, t.pos.x, t.pos.y - t.radius - 18, t.radius * 2);
  }

  drawMinion(m: Minion): void {
    const { ctx } = this;
    const col = m.team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.red;
    ctx.beginPath();
    ctx.arc(m.pos.x, m.pos.y, m.radius, 0, Math.PI * 2);
    ctx.fillStyle = col.main;
    ctx.fill();
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = 2;
    ctx.stroke();
    this.drawHealthBar(m, m.pos.x, m.pos.y - m.radius - 8, m.radius * 2);
  }

  drawHero(h: Hero): void {
    const { ctx } = this;
    const col = h.team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.red;
    const yOff = -h.zHeight;

    // 潜水形态：扁平墨点
    if (h.isDiving) {
      ctx.beginPath();
      ctx.ellipse(h.pos.x, h.pos.y + 4, h.radius * 1.2, h.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = h.team === 0 ? TEAM_COLORS.blue.ink : TEAM_COLORS.red.ink;
      ctx.fill();
    } else {
      // 身体
      ctx.beginPath();
      ctx.arc(h.pos.x, h.pos.y + yOff, h.radius, 0, Math.PI * 2);
      ctx.fillStyle = col.main;
      ctx.fill();
      ctx.strokeStyle = h.heroDef.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      // 朝向
      ctx.beginPath();
      ctx.moveTo(h.pos.x, h.pos.y + yOff);
      ctx.lineTo(h.pos.x + Math.cos(h.facing) * (h.radius + 14), h.pos.y + yOff + Math.sin(h.facing) * (h.radius + 14));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 潜行半透明提示
    if (h.stealthTimer > 0) {
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(h.pos.x, h.pos.y + yOff, h.radius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 护盾
    if (h.shield > 0) {
      ctx.beginPath();
      ctx.arc(h.pos.x, h.pos.y + yOff, h.radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(125,211,255,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // 受击白闪
    if (h.hitFlash > 0) {
      ctx.globalAlpha = clamp(h.hitFlash / 0.15, 0, 1) * 0.7;
      ctx.beginPath();
      ctx.arc(h.pos.x, h.pos.y + yOff, h.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.drawHealthBar(h, h.pos.x, h.pos.y - h.radius - 16, h.radius * 2);
    // 名字
    ctx.textAlign = 'center';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = h.team === 0 ? '#9cc3ff' : '#ffb3ba';
    ctx.fillText(h.name, h.pos.x, h.pos.y - h.radius - 22);

    // 玩家武器射程圈（提示子弹射程）
    if (h === this.player) {
      ctx.beginPath();
      ctx.arc(h.pos.x, h.pos.y, h.heroDef.weapon.range, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawHealthBar(u: Unit, x: number, y: number, w: number): void {
    const { ctx } = this;
    const pct = clamp(u.hp / u.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2, y, w, 5);
    ctx.fillStyle = pct > 0.5 ? '#34d399' : pct > 0.25 ? '#fbbf24' : '#ef4444';
    ctx.fillRect(x - w / 2, y, w * pct, 5);
  }

  renderMinimap(): void {
    const { ctx, camera } = this;
    const mw = 220;
    const mh = 130;
    const mx = camera.viewW - mw - 16;
    const my = 16;
    const sx = mw / MAP_W;
    const sy = mh / MAP_H;

    ctx.fillStyle = 'rgba(10,13,20,0.75)';
    this.roundRect(mx, my, mw, mh, 6);
    ctx.fill();
    ctx.strokeStyle = '#2a3345';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 墨水粗略
    const step = 4;
    for (let cy = 0; cy < this.ink.rows; cy += step) {
      for (let cx = 0; cx < this.ink.cols; cx += step) {
        const o = this.ink.owner[cy * this.ink.cols + cx] as number;
        if (o < 0) continue;
        ctx.fillStyle = o === 0 ? 'rgba(46,124,255,0.6)' : 'rgba(255,77,94,0.6)';
        ctx.fillRect(mx + cx * INK_CELL * sx, my + cy * INK_CELL * sy, INK_CELL * step * sx, INK_CELL * step * sy);
      }
    }

    // 基地与塔
    for (const b of this.bases) {
      ctx.fillStyle = b.team === 0 ? '#7ab1ff' : '#ff8791';
      ctx.fillRect(mx + b.pos.x * sx - 4, my + b.pos.y * sy - 4, 8, 8);
    }
    for (const t of this.towers) {
      ctx.fillStyle = '#e8ecf4';
      ctx.fillRect(mx + t.pos.x * sx - 2.5, my + t.pos.y * sy - 2.5, 5, 5);
    }
    for (const h of this.heroes) {
      if (!h.alive) continue;
      ctx.fillStyle = h === this.player ? '#ffffff' : h.team === 0 ? '#9cc3ff' : '#ffb3ba';
      ctx.beginPath();
      ctx.arc(mx + h.pos.x * sx, my + h.pos.y * sy, h === this.player ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderHUD(): void {
    const { ctx, camera } = this;
    const p = this.player;
    if (!p) return;

    // 血条 + 墨条
    const barX = 20;
    const barW = 260;
    const barY = camera.viewH - 70;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this.roundRect(barX - 6, barY - 8, barW + 12, 40, 6);
    ctx.fill();
    const hpPct = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(barX, barY, barW, 10);
    ctx.fillStyle = '#34d399';
    ctx.fillRect(barX, barY, barW * hpPct, 10);
    const inkPct = clamp(p.ink / p.stats.inkMax, 0, 1);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(barX, barY + 14, barW, 10);
    ctx.fillStyle = '#7fd6ff';
    ctx.fillRect(barX, barY + 14, barW * inkPct, 10);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.ceil(p.hp)}/${p.maxHp}`, barX, barY - 12);

    // 技能栏
    const skX = camera.viewW / 2 - 120;
    const skY = camera.viewH - 78;
    for (let i = 0; i < 4; i++) {
      const x = skX + i * 62;
      const sk = p.heroDef.skills[i];
      const isR = sk.isUltimate;
      const ready = isR ? p.ultCharge >= 1 : p.skillCooldowns[i] <= 0;
      ctx.fillStyle = ready ? 'rgba(30,41,59,0.85)' : 'rgba(15,20,30,0.85)';
      this.roundRect(x, skY, 54, 54, 8);
      ctx.fill();
      ctx.strokeStyle = i === 3 ? '#fbbf24' : '#7fd6ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = ready ? '#e8ecf4' : '#64748b';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const keyLabel = ['Q', 'E', 'F', 'R'][i];
      ctx.fillText(keyLabel, x + 27, skY + 32);
      // 冷却遮罩
      if (!ready) {
        const frac = isR ? p.ultCharge : 1 - p.skillCooldowns[i] / sk.cooldown;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x, skY, 54, 54 * (1 - clamp(frac, 0, 1)));
        if (!isR) {
          ctx.font = '13px system-ui, sans-serif';
          ctx.fillStyle = '#fff';
          ctx.fillText(Math.ceil(p.skillCooldowns[i]) + '', x + 27, skY + 30);
        }
      }
    }

    // 金币 + 装备 + 等级
    const gx = 20;
    const gy = 20;
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`金币 ${Math.floor(p.gold)}`, gx, gy + 16);
    ctx.fillStyle = '#7fd6ff';
    ctx.fillText(`Lv.${p.level}`, gx + 130, gy + 16);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#c7cfdd';
    ctx.fillText(`击杀 ${p.kills} / 死亡 ${p.deaths} / 补刀 ${p.creepKills}`, gx, gy + 36);
    // 装备格
    for (let i = 0; i < MAX_ITEM_SLOTS; i++) {
      const x = gx + i * 44;
      const y = gy + 46;
      ctx.fillStyle = 'rgba(15,20,30,0.8)';
      this.roundRect(x, y, 38, 38, 6);
      ctx.fill();
      ctx.strokeStyle = '#2a3345';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (p.items[i]) {
        const it = p.items[i];
        const catCol = it.category === 'defense' ? '#38bdf8' : it.category === 'bulletAttack' ? '#f87171' : '#a78bfa';
        ctx.fillStyle = it.color ?? catCol;
        ctx.fillRect(x + 5, y + 5, 28, 28);
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#0b0e16';
        ctx.fillText(it.name.slice(0, 1), x + 19, y + 24);
      }
    }

    ctx.fillStyle = '#7fd6ff';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('[B] 商店 · [Tab] 计分板 · [F3] 伤害日志 · [L] 复制日志', gx, gy + 104);
    if (this.logCopied) {
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText('伤害日志已复制到剪贴板', gx, gy + 124);
    }

    if (this.shopOpen) this.renderShop();

    // 玩家受击红屏提示
    if (this.playerHitFlash > 0) {
      const a = clamp(this.playerHitFlash / 0.3, 0, 1) * 0.35;
      ctx.strokeStyle = `rgba(239,68,68,${a})`;
      ctx.lineWidth = 18;
      ctx.strokeRect(0, 0, camera.viewW, camera.viewH);
    }
  }

  renderShop(): void {
    const { ctx } = this;
    const L = this.shopLayout();
    ctx.fillStyle = 'rgba(10,13,20,0.95)';
    this.roundRect(L.px, L.py, L.pw, L.ph, 12);
    ctx.fill();
    ctx.strokeStyle = '#2a3345';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    ctx.fillText('商店（点击购买 · 按 B 关闭）', L.px + L.pw / 2, L.py + 30);

    const catNames = { defense: '防御', bulletAttack: '子弹攻击', magicAttack: '魔法攻击' } as const;
    const catColors = { defense: '#38bdf8', bulletAttack: '#f87171', magicAttack: '#a78bfa' } as const;
    L.cats.forEach((cat, ci) => {
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillStyle = catColors[cat];
      ctx.fillText(catNames[cat], L.px + ci * L.colW + L.colW / 2, L.py + 60);
    });

    for (const r of L.rects) {
      const it = r.item;
      const owned = this.player?.items.some((x) => x.id === it.id);
      const afford = (this.player?.gold ?? 0) >= it.cost;
      const slotsFull = (this.player?.items.length ?? 0) >= MAX_ITEM_SLOTS;
      ctx.fillStyle = owned ? 'rgba(30,58,48,0.8)' : 'rgba(20,26,38,0.9)';
      this.roundRect(r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.strokeStyle = owned ? '#34d399' : '#2a3345';
      ctx.lineWidth = 1;
      ctx.stroke();
      // 图标色块
      ctx.fillStyle = it.color ?? catColors[it.category];
      ctx.fillRect(r.x + 8, r.y + 10, 34, 34);
      ctx.textAlign = 'left';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillStyle = owned ? '#34d399' : '#e8ecf4';
      ctx.fillText(owned ? '✓ ' + it.name : it.name, r.x + 50, r.y + 22);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#9aa4b8';
      ctx.fillText(it.desc, r.x + 50, r.y + 42);
      ctx.fillStyle = afford && !slotsFull ? '#fbbf24' : '#ef4444';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(owned ? '已购买' : `${it.cost} 金币`, r.x + 50, r.y + 64);
    }
  }

  private shopLayout() {
    const pw = 780;
    const ph = 510;
    const px = (this.camera.viewW - pw) / 2;
    const py = (this.camera.viewH - ph) / 2 - 10;
    const colW = pw / 3;
    const cats = ['defense', 'bulletAttack', 'magicAttack'] as const;
    const rects: { item: ItemDef; x: number; y: number; w: number; h: number }[] = [];
    for (let ci = 0; ci < 3; ci++) {
      const items = ITEMS.filter((i) => i.category === cats[ci]);
      for (let ri = 0; ri < items.length; ri++) {
        rects.push({ item: items[ri], x: px + ci * colW + 14, y: py + 78 + ri * 96, w: colW - 28, h: 86 });
      }
    }
    return { px, py, pw, ph, colW, cats, rects };
  }

  handleShopClick(): void {
    const { x, y } = this.input.mouse;
    const p = this.player;
    if (!p) return;
    for (const r of this.shopLayout().rects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        const it = r.item;
        if (p.items.some((k) => k.id === it.id)) return;
        if (p.items.length >= MAX_ITEM_SLOTS) return;
        if (p.gold >= it.cost) {
          p.gold -= it.cost;
          p.items.push(it);
        }
        return;
      }
    }
  }

  renderScoreboard(): void {
    const { ctx, camera } = this;
    const pw = 680;
    const ph = 360;
    const px = (camera.viewW - pw) / 2;
    const py = (camera.viewH - ph) / 2;
    ctx.fillStyle = 'rgba(8,11,18,0.94)';
    this.roundRect(px, py, pw, ph, 12);
    ctx.fill();
    ctx.strokeStyle = '#2a3345';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    ctx.fillText('计分板（Tab）', px + pw / 2, py + 26);

    const colW = (pw - 80) / 2;
    const headers = ['英雄', 'Lv', 'K/D', '补刀', '金币', '装备'];
    [0, 1].forEach((team) => {
      const ox = px + 24 + team * (colW + 32);
      ctx.textAlign = 'center';
      ctx.fillStyle = team === 0 ? TEAM_COLORS.blue.main : TEAM_COLORS.red.main;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`${TEAM_NAMES[team]}`, ox + colW / 2, py + 52);
      ctx.fillStyle = '#64748b';
      ctx.font = '11px system-ui, sans-serif';
      const hx = ox;
      headers.forEach((h, i) => ctx.fillText(h, hx + 16 + i * 92, py + 70));

      const members = this.heroes.filter((h) => h.team === team);
      members.forEach((h, ri) => {
        const y = py + 88 + ri * 56;
        if (ri % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          ctx.fillRect(ox, y - 16, colW, 48);
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = h === this.player ? '#ffffff' : '#c7cfdd';
        ctx.font = (h === this.player ? 'bold ' : '') + '13px system-ui, sans-serif';
        ctx.fillText(h.alive ? h.name : h.name + '（阵亡）', hx + 8, y);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7fd6ff';
        ctx.fillText(h.level + '', hx + 16 + 1 * 92, y);
        ctx.fillStyle = '#c7cfdd';
        ctx.fillText(`${h.kills}/${h.deaths}`, hx + 16 + 2 * 92, y);
        ctx.fillText(h.creepKills + '', hx + 16 + 3 * 92, y);
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(Math.floor(h.gold) + '', hx + 16 + 4 * 92, y);
        ctx.fillStyle = '#c7cfdd';
        ctx.fillText(h.items.length + ' 件', hx + 16 + 5 * 92, y);
      });
    });
  }

  renderDamageLog(): void {
    const { ctx, camera } = this;
    const pw = 720;
    const ph = 420;
    const px = (camera.viewW - pw) / 2;
    const py = 60;
    ctx.fillStyle = 'rgba(8,11,18,0.93)';
    this.roundRect(px, py, pw, ph, 10);
    ctx.fill();
    ctx.strokeStyle = '#2a3345';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    ctx.fillText('伤害日志（F3 关闭 · 控制台同步输出）', px + 16, py + 22);

    const rows = this.damageLog.slice(-16).reverse();
    ctx.font = '12px system-ui, sans-serif';
    rows.forEach((e, i) => {
      const y = py + 48 + i * 22;
      const col = e.type === 'bullet' ? DAMAGE_COLORS.bullet : DAMAGE_COLORS.magic;
      ctx.fillStyle = '#64748b';
      ctx.fillText(e.t.toFixed(1) + 's', px + 16, y);
      ctx.fillStyle = '#f87171';
      ctx.fillText(e.source, px + 76, y);
      ctx.fillStyle = '#c7cfdd';
      ctx.fillText('→ ' + e.target, px + 190, y);
      ctx.fillStyle = col;
      ctx.fillText(e.type + ' ' + e.raw + '/' + e.final, px + 330, y);
      ctx.fillStyle = '#64748b';
      ctx.fillText('@(' + e.x + ',' + e.y + ')', px + 520, y);
    });
  }

  renderEnded(): void {
    const { ctx, camera } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    ctx.textAlign = 'center';
    const win = this.winner === 0;
    ctx.fillStyle = win ? '#34d399' : '#ef4444';
    ctx.font = 'bold 60px system-ui, sans-serif';
    ctx.fillText(win ? '胜利！' : '失败', camera.viewW / 2, camera.viewH / 2 - 20);
    ctx.fillStyle = '#e8ecf4';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`摧毁了 ${TEAM_NAMES[this.winner ?? 0]}基地`, camera.viewW / 2, camera.viewH / 2 + 30);
    ctx.fillStyle = '#9aa4b8';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('按 [R] 返回主菜单', camera.viewW / 2, camera.viewH / 2 + 80);
  }

  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
