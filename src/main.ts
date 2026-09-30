// 入口
import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const loading = document.getElementById('loading');
if (loading) loading.remove();

const game = new Game(canvas);

// URL 参数 ?single 直接进入单机选人，跳过主菜单
const params = new URLSearchParams(window.location.search);
if (params.has('single')) {
  game.toSelect();
}
