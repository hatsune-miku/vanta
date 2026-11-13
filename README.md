# VANTA

横版高速动作网页游戏（纯战斗）。Phaser 4 + Vite + TypeScript，所有美术、特效、音效均为程序生成，没有素材文件。

线上地址：https://vanta.eggtartc.com

## 操作

| 按键 | 动作 |
|---|---|
| A / D | 移动 |
| 空格 | 跳跃（可二段跳，↓ + 空格 下平台） |
| J | 轻攻击（连按五段，空中三段） |
| I | 重攻击（连按三段：横扫 → 升斩 → 跃斩；↑ + I 挑空；轻击后接 I 为派生技；空中 I 为下砸） |
| O / Shift | 闪避（八方向瞬移）。在敌人攻击即将命中的瞬间闪避即为极限闪避：免除这次受击并对攻击者造成伤害（没有提示，靠读敌人动作）。三分之二屏内有锚点时，闪避会直接到最近的锚点 |
| L | 处决（敌人头顶出现金色准星时，屏幕内任意距离可发动） |
| U | 能量斩（消耗 40 能量） |
| Esc / P | 暂停 |

支持手柄（标准映射）。

## 开发

```
pnpm dev            # 本地开发 http://127.0.0.1:5173
pnpm build          # 类型检查 + 构建到 dist/
pnpm run deploy     # 构建并同步到 /var/www/vanta（线上）
```

调试参数：`?arena=2` 从指定封锁区开始（0–3，3 为 Boss）；`?gallery&set=0..3` 美术与姿势预览。

## 自动化测试

逻辑以固定 60Hz 步进，`?test` 模式下由脚本手动推进，不依赖实时帧率，适合无 GPU 的机器。

```
node tools/play.mjs test tools/bot.mjs            # 自动对战打通全程，检查运行时错误
node tools/play.mjs test tools/exec-capture.mjs   # 抓取处决演出各分镜截图到 tools/out/
node tools/live.mjs                                # 对生产构建做实时启动检查
```

## 结构

- `src/art/` 程序化贴图、骨骼绑定（切片式骨骼动画）、姿势库、场景背景
- `src/game/` 角色、敌人与 Boss、特效（含水波纹）、处决演出
- `src/scenes/` 启动、标题、战斗主场景、HUD
- `.claude/skills/` Phaser 官方 Agent Skills（随 phaser 包分发）
