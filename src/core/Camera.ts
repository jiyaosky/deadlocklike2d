// 相机：跟随玩家，边界夹取
import type { Vec2 } from '../data/types';
import { MAP_W, MAP_H } from '../data/constants';

export class Camera {
  x = 0;
  y = 0;
  viewW = 1280;
  viewH = 720;
  zoom = 1;

  setView(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  follow(target: Vec2): void {
    // 目标置于屏幕中心
    let cx = target.x - this.viewW / 2;
    let cy = target.y - this.viewH / 2;
    cx = Math.max(0, Math.min(cx, MAP_W - this.viewW));
    cy = Math.max(0, Math.min(cy, MAP_H - this.viewH));
    this.x = cx;
    this.y = cy;
  }

  toWorld(sx: number, sy: number): Vec2 {
    return { x: this.x + sx, y: this.y + sy };
  }

  toScreen(wx: number, wy: number): Vec2 {
    return { x: wx - this.x, y: wy - this.y };
  }
}
