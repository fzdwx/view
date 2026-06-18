const fontFallbackSample =
  "😀🎉✨📦🚀 中文 日本語 한국어 附件 截图 分支 提交 ∑∫√ ✓✗";

const fontFallbackPrewarmMark = "view:font-fallback-prewarm";

export function prewarmFontFallbacks(): void {
  const marker = document.createElement("span");
  marker.className = "font-fallback-prewarm";
  marker.dataset.viewFontPrewarm = "true";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = fontFallbackSample;

  document.body.append(marker);
  void marker.getBoundingClientRect();
  performance.mark(fontFallbackPrewarmMark);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      marker.remove();
    });
  });
}
