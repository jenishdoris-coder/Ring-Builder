export type IconName = "diamond" | "overview" | "band" | "head" | "metal" | "assets" | "settings" | "publish" | "arrow" | "plus" | "search" | "close" | "check" | "logout" | "external" | "upload" | "menu" | "edit" | "pricing" | "trash" | "undo";
const paths: Record<IconName, string> = {
  trash: "M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6",
  undo: "M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5",
  pricing: "M14 3H6v18h12V7Zm0 0v5h4M9 12h6M9 16h6",
  diamond: "m3 8 4-5h10l4 5-9 13Zm0 0h18M7 3l5 18 5-18",
  overview: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
  band: "M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM7 8l2-5h6l2 5M9 3l3 6 3-6",
  head: "m5 8 4-5h6l4 5-7 11Zm0 0h14M9 3l3 16 3-16",
  metal: "M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4",
  assets: "M3 7h7l2 2h9v11H3Zm0 0V4h7l2 3M7 14h10M7 17h6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3Z",
  publish: "M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  plus: "M12 5v14M5 12h14", search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6", close: "m6 6 12 12M18 6 6 18",
  check: "m5 12 4 4L19 6", logout: "M9 4H3v16h6m5-12 5 4-5 4M8 12h11", external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5", menu: "M4 6h16M4 12h16M4 18h16", edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z",
};
export const Icon = ({ name, size = 20 }: { name: IconName; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
