import { useEffect, useMemo } from "react";
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";

interface FileTreeResolvedIcon {
  height?: number;
  name: string;
  remappedFrom?: string;
  token?: string;
  viewBox?: string;
  width?: number;
}

/**
 * Dark-mode icon colors matching @pierre/trees built-in colored set.
 * token → hex color. Used as inline styles so they work outside Shadow DOM.
 */
const iconTokenColors: Record<string, string> = {
  astro: "#d568ea",
  babel: "#ffd452",
  bash: "#5ecc71",
  biome: "#69b1ff",
  bootstrap: "#9d6afb",
  browserslist: "#ffd452",
  bun: "#79697b",
  c: "#69b1ff",
  cpp: "#69b1ff",
  claude: "#ffa359",
  css: "#9d6afb",
  database: "#d568ea",
  default: "#adadb1",
  docker: "#69b1ff",
  eslint: "#9d6afb",
  git: "#d5512f",
  go: "#68cdf2",
  graphql: "#ff678d",
  html: "#ffa359",
  image: "#ff678d",
  javascript: "#ffd452",
  json: "#ffa359",
  markdown: "#5ecc71",
  mcp: "#64d1db",
  npm: "#ff6762",
  oxc: "#68cdf2",
  postcss: "#ff6762",
  prettier: "#64d1db",
  python: "#69b1ff",
  react: "#68cdf2",
  ruby: "#ff6762",
  rust: "#ffa359",
  sass: "#ff678d",
  svg: "#ffa359",
  svelte: "#ff6762",
  svgo: "#5ecc71",
  swift: "#ffa359",
  table: "#64d1db",
  text: "#adadb1",
  tailwind: "#68cdf2",
  terraform: "#9d6afb",
  typescript: "#69b1ff",
  vite: "#d568ea",
  vscode: "#69b1ff",
  vue: "#5ecc71",
  wasm: "#9d6afb",
  webpack: "#69b1ff",
  yml: "#ff6762",
  zig: "#ffa359",
  zip: "#ffa359",
};

let spriteInjected = false;

function injectSpriteSheet(): void {
  if (spriteInjected || typeof document === "undefined") return;
  const existing = document.getElementById("view-file-icons");
  if (existing) {
    spriteInjected = true;
    return;
  }
  const container = document.createElement("div");
  container.id = "view-file-icons";
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  container.innerHTML = getBuiltInSpriteSheet("complete");
  document.body.appendChild(container);
  spriteInjected = true;
}

const resolver = createFileTreeIconResolver({ set: "complete", colored: true });

export function useFileIcon(filePath: string): {
  name: string;
  viewBox?: string;
  token?: string;
  color: string;
} {
  useEffect(() => {
    injectSpriteSheet();
  }, []);
  return useMemo(() => {
    const icon = resolver.resolveIcon("file-tree-icon-file", filePath);
    return {
      name: icon.name,
      viewBox: icon.viewBox,
      token: icon.token,
      color: iconTokenColors[icon.token ?? "default"] ?? iconTokenColors.default,
    };
  }, [filePath]);
}

export { injectSpriteSheet };
