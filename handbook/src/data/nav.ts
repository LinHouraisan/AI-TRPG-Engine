export type NavPage = { href: string; title: string };

export type NavGroup = {
  title: string;
  pages: NavPage[];
};

export const groups: NavGroup[] = [
  {
    title: "怎么玩",
    pages: [
      { href: "/", title: "总览" },
      { href: "/user-stories", title: "用户故事" },
      { href: "/session", title: "一晚怎么跑" },
    ],
  },
  {
    title: "世界",
    pages: [
      { href: "/rooms", title: "房间与出口" },
      { href: "/items", title: "道具总表" },
      { href: "/story", title: "剧情与标记" },
      { href: "/switches", title: "事件开关" },
      { href: "/conditions", title: "条件" },
    ],
  },
  {
    title: "裁定",
    pages: [
      { href: "/schema", title: "数据结构" },
      { href: "/tools", title: "数值与工具调用" },
      { href: "/save", title: "存档与读档" },
    ],
  },
  {
    title: "例子",
    pages: [{ href: "/scenario", title: "样例剧本" }],
  },
];

export const pages: NavPage[] = groups.flatMap((group) => group.pages);
