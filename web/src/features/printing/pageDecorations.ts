const SVG_NS = "http://www.w3.org/2000/svg";
const DECORATION_CLASS = "page-decoration";
// Text size and inset as fractions of the page height, so they scale with
// the page like the notation does.
const FONT_RATIO = 0.016;
const INSET_RATIO = 0.03;

export interface PageDecorations {
  header: string;
  footer: string;
  pageNumbers: boolean;
}

export function pageNumberLabel(page: number, total: number): string {
  return `${page} / ${total}`;
}

/** The page's coordinate box, adding a viewBox from width/height if missing. */
function pageBox(svg: SVGSVGElement): { width: number; height: number } | null {
  const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite)) return { width: vb[2], height: vb[3] };
  const width = parseFloat(svg.getAttribute("width") ?? "");
  const height = parseFloat(svg.getAttribute("height") ?? "");
  if (!(width > 0 && height > 0)) return null;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return { width, height };
}

function text(content: string, x: number, y: number, anchor: string, size: number): SVGTextElement {
  const el = document.createElementNS(SVG_NS, "text");
  el.setAttribute("class", DECORATION_CLASS);
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("text-anchor", anchor);
  el.setAttribute("font-size", String(size));
  el.setAttribute("font-family", "sans-serif");
  el.setAttribute("fill", "#333");
  el.textContent = content;
  return el;
}

/**
 * Draws header, footer, and page numbers into each rendered page's SVG
 * (APP_DESIGN.md §7.5), so they scale and print with the page instead of
 * being a separate HTML layer that could drift from it. Re-running
 * replaces earlier decorations.
 */
export function decoratePages(container: HTMLElement, decorations: PageDecorations): void {
  const pages = Array.from(container.querySelectorAll<SVGSVGElement>("svg")).filter((svg) => !svg.parentElement?.closest("svg"));
  pages.forEach((svg, i) => {
    svg.querySelectorAll(`.${DECORATION_CLASS}`).forEach((el) => el.remove());
    const box = pageBox(svg);
    if (!box) return;
    const size = box.height * FONT_RATIO;
    const inset = box.height * INSET_RATIO;
    const top = inset * 0.5 + size;
    const bottom = box.height - inset * 0.5;
    if (decorations.header) svg.append(text(decorations.header, box.width / 2, top, "middle", size));
    if (decorations.footer) svg.append(text(decorations.footer, box.width / 2, bottom, "middle", size));
    if (decorations.pageNumbers) svg.append(text(pageNumberLabel(i + 1, pages.length), box.width - inset, bottom, "end", size));
  });
}
