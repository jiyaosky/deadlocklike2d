// 远程玩家输入控制器（房主侧）：由网络消息驱动
import { makeController, type Controller } from '../entities/Hero';
import type { NetInput } from './protocol';

export class NetworkController {
  c: Controller = makeController();

  applyInput(input: NetInput): void {
    this.c.move = { x: input.move.x, y: input.move.y };
    this.c.aim = { x: input.aim.x, y: input.aim.y };
    this.c.shoot = input.shoot;
    this.c.dive = input.dive;
    // 边沿触发：由 Hero 每帧消费并清空
    this.c.jump = this.c.jump || input.jump;
    this.c.melee = this.c.melee || input.melee;
    for (let i = 0; i < 4; i++) this.c.skills[i] = this.c.skills[i] || (input.skills[i] ?? false);
  }
}
