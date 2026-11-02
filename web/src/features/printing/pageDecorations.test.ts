import { describe, expect, test } from "vitest";
import { decoratePages } from "./pageDecorations";

function pages(count: number, withViewBox = true): HTMLElement {
  const root = document.createElement("div");
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (withViewBox) svg.setAttribute("viewBox", "0 0 800 1000");
    else {
      svg.setAttribute("width", "800");
      svg.setAttribute("height", "1000");
    }
    wrap.append(svg);
    root.append(wrap);
  }
  return root;
}

const texts = (root: HTMLElement) => Array.from(root.querySelectorAll("svg")).map((s) => Array.from(s.querySelectorAll("text")).map((t) => t.textContent));

describe("decoratePages", () => {
  test("numbers every page and repeats header and footer", () => {
    const root = pages(3);
    decoratePages(root, { header: "曲名", footer: "© 2026", pageNumbers: true });
    expect(texts(root)).toEqual([
      ["曲名", "© 2026", "1 / 3"],
      ["曲名", "© 2026", "2 / 3"],
      ["曲名", "© 2026", "3 / 3"],
    ]);
  });

  test("re-running replaces, rather than stacks, decorations", () => {
    const root = pages(2);
    decoratePages(root, { header: "A", footer: "", pageNumbers: true });
    decoratePages(root, { header: "", footer: "", pageNumbers: false });
    expect(texts(root)).toEqual([[], []]);
  });

  test("adds a viewBox from width/height so decorations scale with the page", () => {
    const root = pages(1, false);
    decoratePages(root, { header: "", footer: "", pageNumbers: true });
    const svg = root.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 800 1000");
    expect(Number(svg.querySelector("text")!.getAttribute("y"))).toBeGreaterThan(950);
  });
});
