import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import type { MeasureRect, NotationRenderer, PageMargins, RenderOptions, StaffLabel } from "./NotationRenderer";
import { describeRenderError } from "./renderError";

// OSMD lays out in "units"; one unit is 10 CSS pixels at zoom 1.
const PX_PER_UNIT = 10;

// Page margins in OSMD units (OSMD's own default is 5 on every side).
const MARGIN_UNITS: Record<PageMargins, number> = { narrow: 2.5, normal: 5, wide: 9 };

/** Converts OSMD units to container pixels (the SVG's offset and zoom). */
function frame(host: HTMLElement, svg: SVGSVGElement, zoom: number) {
  const hostBox = host.getBoundingClientRect();
  const svgBox = svg.getBoundingClientRect();
  return { offX: svgBox.left - hostBox.left, offY: svgBox.top - hostBox.top, scale: PX_PER_UNIT * zoom };
}

// OSMD must always receive MusicXML as a string, never a URL: OSMD.load()
// only issues an XHR when given a URL, and this app must make zero
// non-localhost runtime requests (APP_DESIGN.md §17.4, §19.3-7).
export function createOsmdNotationRenderer(): NotationRenderer {
  let osmd: OpenSheetMusicDisplay | null = null;
  let host: HTMLElement | null = null;

  return {
    async render(container, musicXml, options: RenderOptions = {}) {
      if (!osmd || host !== container) {
        container.innerHTML = "";
        osmd = new OpenSheetMusicDisplay(container, {
          autoResize: (options.pageFormat ?? "Endless") === "Endless",
          backend: "svg",
          drawTitle: true,
          drawSubtitle: true,
          drawComposer: true,
          drawPartNames: true,
        });
        host = container;
      }
      osmd.setOptions({ pageFormat: options.pageFormat ?? "Endless" });
      const margin = MARGIN_UNITS[options.margins ?? "normal"];
      const rules = osmd.EngravingRules;
      rules.PageTopMargin = rules.PageBottomMargin = rules.PageLeftMargin = rules.PageRightMargin = margin;
      try {
        await osmd.load(musicXml);
        osmd.zoom = options.zoom ?? 1;
        osmd.render();
      } catch (error) {
        throw new Error(describeRenderError(error));
      }
    },

    setZoom(zoom) {
      if (!osmd) return;
      osmd.zoom = zoom;
      try {
        osmd.render();
      } catch (error) {
        throw new Error(describeRenderError(error));
      }
    },

    staffLabels() {
      const svg = host?.querySelector("svg");
      if (!osmd || !host || !svg) return [];
      const { offY, scale } = frame(host, svg, osmd.zoom);
      const labels: StaffLabel[] = [];
      for (const page of osmd.GraphicSheet?.MusicPages ?? []) {
        for (const system of page.MusicSystems ?? []) {
          let current: { instrument: unknown; label: StaffLabel } | null = null;
          for (const line of system.StaffLines ?? []) {
            const instrument = line.ParentStaff?.ParentInstrument;
            const top = offY + line.PositionAndShape.AbsolutePosition.y * scale;
            const bottom = top + line.StaffHeight * scale;
            if (current && current.instrument === instrument) {
              current.label.bottom = bottom; // a grand staff: one label for both staves
              continue;
            }
            current = { instrument, label: { name: instrument?.Name ?? "", top, bottom } };
            labels.push(current.label);
          }
        }
      }
      return labels;
    },

    measureRects() {
      const list = osmd?.GraphicSheet?.MeasureList ?? [];
      const svg = host?.querySelector("svg");
      if (!osmd || !host || !svg) return [];
      const { offX, offY, scale } = frame(host, svg, osmd.zoom);
      return list.map((staves): MeasureRect => {
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const m of staves ?? []) {
          const box = m?.PositionAndShape;
          if (!box) continue;
          const { x, y } = box.AbsolutePosition;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x + box.Size.width);
          y1 = Math.max(y1, y + box.Size.height);
        }
        if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 };
        return { x: offX + x0 * scale, y: offY + y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale };
      });
    },

    dispose() {
      osmd?.clear();
      osmd = null;
      host = null;
    },
  };
}
