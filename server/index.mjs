// 墨汁英雄 · 联机中继服务器（房间 + 槽位 + 消息转发）
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = Number(process.env.PORT || 8787);

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('墨汁英雄 联机中继服务器运行中');
});
const wss = new WebSocketServer({ server });

const clients = new Map(); // id -> { ws, name, room }
const rooms = new Map(); // code -> { code, hostId, slots[6], members: Map<id, ws> }
let nextId = 1;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randCode(len = 6) {
  let c = '';
  for (let i = 0; i < len; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function memberInfo(id) {
  const c = clients.get(id);
  return c ? { id, name: c.name } : { id, name: '?' };
}

function roomState(room) {
  return {
    type: 'roomState',
    code: room.code,
    hostId: room.hostId,
    slots: room.slots.map((s) => ({
      playerId: s.playerId,
      heroId: s.heroId,
      name: s.playerId ? (clients.get(s.playerId)?.name ?? '?') : null,
    })),
    members: [...room.members.keys()].map(memberInfo),
  };
}

function broadcast(room, obj) {
  for (const ws of room.members.values()) send(ws, obj);
}

function removeFromRoom(id, ws) {
  const client = clients.get(id);
  const code = client?.room;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) {
    client.room = null;
    return;
  }
  room.members.delete(id);
  for (const s of room.slots) {
    if (s.playerId === id) {
      s.playerId = null;
      s.heroId = null;
    }
  }
  if (room.members.size === 0) {
    rooms.delete(code);
  } else {
    if (room.hostId === id) room.hostId = room.members.keys().next().value;
    broadcast(room, roomState(room));
  }
  client.room = null;
}

wss.on('connection', (ws) => {
  const id = 'p' + nextId++;
  clients.set(id, { ws, name: '玩家' + String(nextId - 1).padStart(3, '0'), room: null });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const client = clients.get(id);
    if (!client) return;

    switch (msg.type) {
      case 'hello': {
        if (typeof msg.name === 'string' && msg.name.trim()) client.name = msg.name.trim().slice(0, 12);
        send(ws, { type: 'hello', id });
        break;
      }
      case 'createRoom': {
        if (client.room) removeFromRoom(id, ws);
        const code = randCode();
        const room = { code, hostId: id, slots: Array.from({ length: 6 }, () => ({ playerId: null, heroId: null })), members: new Map([[id, ws]]) };
        rooms.set(code, room);
        client.room = code;
        send(ws, { type: 'joined', code, hostId: id });
        broadcast(room, roomState(room));
        break;
      }
      case 'joinRoom': {
        const code = typeof msg.code === 'string' ? msg.code.toUpperCase() : '';
        const room = rooms.get(code);
        if (!room) {
          send(ws, { type: 'error', message: '房间不存在' });
          break;
        }
        if (client.room) removeFromRoom(id, ws);
        room.members.set(id, ws);
        client.room = code;
        send(ws, { type: 'joined', code, hostId: room.hostId });
        broadcast(room, roomState(room));
        break;
      }
      case 'updateSlot': {
        const room = client.room ? rooms.get(client.room) : null;
        if (!room) break;
        const idx = Number(msg.slot);
        if (!Number.isInteger(idx) || idx < 0 || idx >= 6) break;
        // 目标槽位被占用（非自己）则忽略
        if (room.slots[idx].playerId && room.slots[idx].playerId !== id) break;
        // 释放旧槽位
        for (const s of room.slots) {
          if (s.playerId === id) {
            s.playerId = null;
            s.heroId = null;
          }
        }
        room.slots[idx].playerId = id;
        room.slots[idx].heroId = typeof msg.heroId === 'string' ? msg.heroId : null;
        broadcast(room, roomState(room));
        break;
      }
      case 'startGame': {
        const room = client.room ? rooms.get(client.room) : null;
        if (!room || room.hostId !== id) break;
        // 补默认英雄，未选英雄的槽位交给 AI
        const slots = room.slots.map((s) => ({ playerId: s.playerId, heroId: s.heroId }));
        broadcast(room, { type: 'start', slots });
        break;
      }
      case 'input': {
        const room = client.room ? rooms.get(client.room) : null;
        if (!room) break;
        const hostWs = room.members.get(room.hostId);
        send(hostWs, { type: 'input', playerId: id, seq: msg.seq, move: msg.move, aim: msg.aim, shoot: msg.shoot, dive: msg.dive, jump: msg.jump, melee: msg.melee, skills: msg.skills });
        break;
      }
      case 'state': {
        const room = client.room ? rooms.get(client.room) : null;
        if (!room || room.hostId !== id) break; // 只有房主广播游戏状态
        broadcast(room, { type: 'state', time: msg.time, gameState: msg.gameState, winner: msg.winner, heroes: msg.heroes, minions: msg.minions, towers: msg.towers, bases: msg.bases, projectiles: msg.projectiles, money: msg.money, ink: msg.ink });
        break;
      }
      case 'buy': {
        const room = client.room ? rooms.get(client.room) : null;
        if (!room) break;
        const hostWs = room.members.get(room.hostId);
        send(hostWs, { type: 'buy', playerId: id, itemId: msg.itemId });
        break;
      }
      case 'leave': {
        removeFromRoom(id, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    removeFromRoom(id, ws);
    clients.delete(id);
  });
});

server.listen(PORT, () => {
  console.log(`[ink-moba] 联机中继服务器已启动: ws://localhost:${PORT}`);
});
