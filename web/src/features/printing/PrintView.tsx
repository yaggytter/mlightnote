import { useEffect, useRef, useState } from "react";
import { fetchRenderMusicXml } from "../../services/api/projects";
import { createOsmdNotationRenderer } from "../../services/notation/OsmdNotationRenderer";
import type { PageFormat, PageMargins } from "../../services/notation/NotationRenderer";
import { decoratePages } from "./pageDecorations";

type Paper = "A4" | "Letter";
type Orientation = "portrait" | "landscape";

/** Staff size choices, 60–140% (APP_DESIGN.md §7.5). */
export const STAFF_SIZES = [60, 70, 80, 90, 100, 110, 120, 140];
const DEFAULT_STAFF_SIZE = 80;

interface PrintViewProps {
  projectId: string;
  partIds: string[];
  concertPitch: boolean;
  onClose: () => void;
}

export function pageFormatFor(paper: Paper, orientation: Orientation): PageFormat {
  return `${paper}_${orientation === "portrait" ? "P" : "L"}` as PageFormat;
}

// Print preview (APP_DESIGN.md §7.5). The same paginated SVG pages shown
// here are what the browser prints — the print stylesheet hides every UI
// element and forces a page break after each rendered page, so preview and
// output share one page layout. Full score defaults to landscape and a
// single part to portrait (§7.5 FR-PRINT-002); several selected parts are
// a reduced score, so they default to landscape too.
export function PrintView({ projectId, partIds, concertPitch, onClose }: PrintViewProps) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [paper, setPaper] = useState<Paper>("A4");
  const [orientation, setOrientation] = useState<Orientation>(partIds.length === 1 ? "portrait" : "landscape");
  const [staffSize, setStaffSize] = useState(DEFAULT_STAFF_SIZE);
  const [margins, setMargins] = useState<PageMargins>("normal");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [pageNumbers, setPageNumbers] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const renderer = createOsmdNotationRenderer();
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      const xml = await fetchRenderMusicXml(projectId, { partIds, concertPitch, view: "print" });
      if (cancelled || !pagesRef.current) return;
      await renderer.render(pagesRef.current, xml, { pageFormat: pageFormatFor(paper, orientation), zoom: staffSize / 100, margins });
      // Enable printing only after fonts and every page are laid out
      // (§7.5 FR-PRINT-003), so the dialog never captures a half-drawn page.
      await document.fonts.ready;
      if (!cancelled) setReady(true);
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "印刷プレビューの生成に失敗しました。");
    });
    return () => {
      cancelled = true;
      renderer.dispose();
    };
  }, [projectId, partIds, concertPitch, paper, orientation, staffSize, margins]);

  // Header, footer, and page numbers are drawn into the finished pages, so
  // editing them never re-lays out the score.
  useEffect(() => {
    if (ready && pagesRef.current) decoratePages(pagesRef.current, { header, footer, pageNumbers });
  }, [ready, header, footer, pageNumbers]);

  const pageSize = `${paper === "A4" ? "A4" : "letter"} ${orientation}`;

  // The @page rule is installed as a constructable stylesheet, not an
  // inline <style>: nginx's CSP (default-src 'self', no 'unsafe-inline')
  // blocks inline styles, which would silently drop paper size and
  // orientation in the deployed app while working fine in dev.
  useEffect(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`@page { size: ${pageSize}; margin: 0; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }, [pageSize]);

  return (
    <div className="print-view">
      <div className="print-view__toolbar" role="toolbar" aria-label="印刷設定">
        <label>
          用紙{" "}
          <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
          </select>
        </label>
        <label>
          向き{" "}
          <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
            <option value="portrait">縦</option>
            <option value="landscape">横</option>
          </select>
        </label>
        <label>
          譜表サイズ{" "}
          <select value={staffSize} onChange={(e) => setStaffSize(Number(e.target.value))}>
            {STAFF_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}%
              </option>
            ))}
          </select>
        </label>
        <label>
          余白{" "}
          <select value={margins} onChange={(e) => setMargins(e.target.value as PageMargins)}>
            <option value="narrow">狭い</option>
            <option value="normal">標準</option>
            <option value="wide">広い</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={pageNumbers} onChange={(e) => setPageNumbers(e.target.checked)} /> ページ番号
        </label>
        <label>
          ヘッダー <input type="text" value={header} onChange={(e) => setHeader(e.target.value)} maxLength={200} size={16} />
        </label>
        <label>
          フッター <input type="text" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={200} size={16} />
        </label>
        <button type="button" onClick={() => window.print()} disabled={!ready}>
          {ready ? "印刷" : "準備中…"}
        </button>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
        {error && <span role="alert">{error}</span>}
      </div>
      <div ref={pagesRef} className="print-view__pages" data-testid="print-pages" />
    </div>
  );
}
