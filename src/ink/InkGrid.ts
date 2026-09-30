// 墨水网格：记录每格归属与墨量
import { INK_CELL, MAP_W, MAP_H } from '../data/constants';
import type { Team } from '../data/types';

export class InkGrid {
  cols: number;
  rows: number;
  owner: Int8Array; // -1 无, 0 蓝, 1 红
  amount: Float32Array; // 0..1

  constructor() {
    this.cols = Math.ceil(MAP_W / INK_CELL);
    this.rows = Math.ceil(MAP_H / INK_CELL);
    this.owner = new Int8Array(this.cols * this.rows).fill(-1);
    this.amount = new Float32Array(this.cols * this.rows);
  }

  private idx(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  private clampCell(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  get(x: number, y: number): { owner: number; amount: number } {
    const cx = Math.floor(x / INK_CELL);
    const cy = Math.floor(y / INK_CELL);
    if (!this.clampCell(cx, cy)) return { owner: -1, amount: 0 };
    const i = this.idx(cx, cy);
    return { owner: this.owner[i], amount: this.amount[i] };
  }

  ownerAt(x: number, y: number): number {
    const cx = Math.floor(x / INK_CELL);
    const cy = Math.floor(y / INK_CELL);
    if (!this.clampCell(cx, cy)) return -1;
    return this.owner[this.idx(cx, cy)];
  }

  // 以 (x,y) 为圆心涂墨
  paint(x: number, y: number, radius: number, team: Team, add: number): void {
    const minCx = Math.max(0, Math.floor((x - radius) / INK_CELL));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / INK_CELL));
    const minCy = Math.max(0, Math.floor((y - radius) / INK_CELL));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / INK_CELL));
    const r2 = radius * radius;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const wx = cx * INK_CELL + INK_CELL / 2;
        const wy = cy * INK_CELL + INK_CELL / 2;
        const dx = wx - x;
        const dy = wy - y;
        if (dx * dx + dy * dy > r2) continue;
        const i = this.idx(cx, cy);
        this.owner[i] = team;
        const na = this.amount[i] + add;
        this.amount[i] = na > 1 ? 1 : na;
      }
    }
  }
}
