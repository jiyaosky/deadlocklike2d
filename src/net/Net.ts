// 联机客户端网络层
import type { RoomStateMsg, JoinedMsg, StartMsg, NetState, NetInput } from './protocol';

export type NetMessage =
  | { type: 'hello'; id: string }
  | JoinedMsg
  | RoomStateMsg
  | StartMsg
  | NetState
  | { type: 'error'; message: string }
  | { type: 'input'; playerId: string; seq: number; move: { x: number; y: number }; aim: { x: number; y: number }; shoot: boolean; dive: boolean; jump: boolean; melee: boolean; skills: boolean[] }
  | { type: 'buy'; playerId: string; itemId: string }
  | { type: 'disconnect' };

type Handler = (msg: NetMessage) => void;

export class Net {
  ws: WebSocket | null = null;
  id: string | null = null;
  name: string;
  private handlers: Handler[] = [];

  constructor(name: string) {
    this.name = name;
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        this.send({ type: 'hello', name: this.name });
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        reject(new Error('无法连接服务器'));
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data) as NetMessage;
          this.dispatch(m);
        } catch {
          /* 忽略坏消息 */
        }
      };
      ws.onclose = () => {
        this.ws = null;
        this.dispatch({ type: 'disconnect' });
      };
    });
  }

  on(handler: Handler): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  private dispatch(m: NetMessage): void {
    for (const h of this.handlers.slice()) h(m);
  }

  send(obj: unknown): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  createRoom(): void {
    this.send({ type: 'createRoom' });
  }
  joinRoom(code: string): void {
    this.send({ type: 'joinRoom', code });
  }
  updateSlot(slot: number, heroId: string | null): void {
    this.send({ type: 'updateSlot', slot, heroId });
  }
  startGame(): void {
    this.send({ type: 'startGame' });
  }
  sendInput(input: NetInput): void {
    this.send({ type: 'input', ...input });
  }
  buyItem(itemId: string): void {
    this.send({ type: 'buy', itemId });
  }
  sendState(state: Omit<NetState, 'type'>): void {
    this.send({ type: 'state', ...state });
  }
  leave(): void {
    this.send({ type: 'leave' });
  }
  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* 忽略 */
    }
    this.ws = null;
  }
}
