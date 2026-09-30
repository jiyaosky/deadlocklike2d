// 固定时间步游戏循环
import { FIXED_DT } from '../data/constants';

export class GameLoop {
  private last = 0;
  private acc = 0;
  private running = false;
  private rafId = 0;

  constructor(
    private update: (dt: number) => void,
    private render: () => void,
  ) {}

  start(): void {
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25; // 防止切后台后大步长
      this.acc += dt;
      while (this.acc >= FIXED_DT) {
        this.update(FIXED_DT);
        this.acc -= FIXED_DT;
      }
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
