// 联机协议类型

export interface SlotInfo {
  playerId: string | null;
  heroId: string | null;
  name: string | null;
}

export interface RoomStateMsg {
  type: 'roomState';
  code: string;
  hostId: string;
  slots: SlotInfo[];
  members: { id: string; name: string }[];
}

export interface JoinedMsg {
  type: 'joined';
  code: string;
  hostId: string;
}

export interface StartMsg {
  type: 'start';
  slots: { playerId: string | null; heroId: string | null }[];
}

export interface NetHero {
  id: number;
  owner: string; // 玩家 id 或 'ai'
  team: number;
  heroId: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ink: number;
  inkMax: number;
  facing: number;
  level: number;
  gold: number;
  kills: number;
  deaths: number;
  creepKills: number;
  alive: boolean;
  isDiving: boolean;
  shield: number;
  stealth: boolean;
  respawnTimer: number;
  items: string[];
  skillCooldowns: number[];
  ultCharge: number;
}

export interface NetUnit {
  id: number;
  team: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface NetState {
  type: 'state';
  time: number;
  gameState: 'playing' | 'ended';
  winner: number | null;
  heroes: NetHero[];
  minions: NetUnit[];
  towers: NetUnit[];
  bases: NetUnit[];
  projectiles: { x: number; y: number; r: number; color: string; team: number }[];
  money: { x: number; y: number; team: number }[];
  ink: string; // 下采样墨格编码
}

export interface NetInput {
  seq: number;
  move: { x: number; y: number };
  aim: { x: number; y: number };
  shoot: boolean;
  dive: boolean;
  jump: boolean;
  melee: boolean;
  skills: [boolean, boolean, boolean, boolean];
}
