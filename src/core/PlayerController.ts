// 玩家控制器：把键鼠输入转换为 Controller
import type { Input } from './Input';
import type { Camera } from './Camera';
import type { Controller } from '../entities/Hero';
import { makeController } from '../entities/Hero';
import { norm } from './vec';

export class PlayerController {
  c: Controller = makeController();

  constructor(
    private input: Input,
    private camera: Camera,
  ) {}

  update(): Controller {
    let mx = 0;
    let my = 0;
    if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) my -= 1;
    if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) my += 1;
    if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) mx -= 1;
    if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) mx += 1;
    const m = norm({ x: mx, y: my });
    this.c.move = m;

    this.c.aim = this.camera.toWorld(this.input.mouse.x, this.input.mouse.y);
    this.c.shoot = this.input.mouseDown;
    this.c.dive = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
    this.c.jump = this.input.justPressed('Space');
    this.c.melee = this.input.justPressed('KeyV');
    this.c.skills[0] = this.input.justPressed('KeyQ');
    this.c.skills[1] = this.input.justPressed('KeyE');
    this.c.skills[2] = this.input.justPressed('KeyF');
    this.c.skills[3] = this.input.justPressed('KeyR');
    return this.c;
  }
}
