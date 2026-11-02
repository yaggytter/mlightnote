// The seam between the score viewer and whatever library actually draws
// notation. Nothing outside services/notation may import OSMD directly
// (APP_DESIGN.md §7.4 FR-VIEW-003, §8.2): renderer objects must never leak
// into domain types, API contracts, or the .mlight persistence format.

/** "Endless" = continuous scroll; the others paginate to a physical paper size. */
export type PageFormat = "Endless" | "A4_P" | "A4_L" | "Letter_P" | "Letter_L";

/** Page margin presets for paginated formats. */
export type PageMargins = "narrow" | "normal" | "wide";

export interface RenderOptions {
  pageFormat?: PageFormat;
  zoom?: number;
  margins?: PageMargins;
}

/** A measure's on-screen box, in pixels relative to the render container. */
export interface MeasureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where one part's staves sit in one system, in container pixels. */
export interface StaffLabel {
  name: string;
  top: number;
  bottom: number;
}

export interface NotationRenderer {
  /** Loads and draws musicXml into container, replacing any prior render. */
  render(container: HTMLElement, musicXml: string, options?: RenderOptions): Promise<void>;
  /** Sets the zoom factor (1.0 = 100%) and re-renders if already loaded. */
  setZoom(zoom: number): void;
  /**
   * Returns each measure's box (all staves of that measure's system),
   * indexed by measure position in the score, for the playback cursor and
   * click-to-seek. Empty until something is rendered.
   */
  measureRects(): MeasureRect[];
  /** Each part's staff span in every rendered system, for screen labels. */
  staffLabels(): StaffLabel[];
  /** Releases the underlying renderer instance. */
  dispose(): void;
}
