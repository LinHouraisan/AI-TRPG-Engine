# AI TRPG Engine 手册

这是用 Astro 写的中文作者手册，内容包括用户故事、房间与出口、剧情与标记、条件、工具调用、存档与读档，另外还有《寄宿公寓账本》的房间示意图和数据卡。

仓库根目录已经把手册收进工作区，Astro 装在 `handbook` 目录下面。

```bash
# 在仓库根目录执行
bun install
bun run handbook
```

或者：

```bash
cd handbook
bun ./node_modules/.bin/astro dev
```

构建用 `bun ./node_modules/.bin/astro build`，必须在 `handbook` 目录里执行。不要在这个目录直接跑 `bun run build`——Bun 会顺着工作区跑到仓库根目录的前端构建上去。
