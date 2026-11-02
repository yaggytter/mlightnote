import type { PartSummary } from "../../services/api/projects";
import { PartPicker } from "./PartPicker";
import { Icon } from "../../shared/ui/Icon";

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.1;

interface ViewToolbarProps {
  parts: PartSummary[];
  selectedPartIds: string[];
  onSelectParts: (partIds: string[]) => void;
  concertPitch: boolean;
  onToggleConcertPitch: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onPrint: () => void;
  follow: boolean;
  onToggleFollow: () => void;
  showLabels: boolean;
  /** Present only when the score has several parts to label. */
  onToggleLabels?: () => void;
}

export function clampZoom(zoom: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 100) / 100;
}

export function ViewToolbar({
  parts,
  selectedPartIds,
  onSelectParts,
  concertPitch,
  onToggleConcertPitch,
  zoom,
  onZoom,
  onPrint,
  follow,
  onToggleFollow,
  showLabels,
  onToggleLabels,
}: ViewToolbarProps) {
  const hasTransposing = parts.some((p) => p.transposing);
  return (
    <div className="view-toolbar" role="toolbar" aria-label="表示設定">
      <PartPicker parts={parts} selected={selectedPartIds} onChange={onSelectParts} />
      <span className="view-toolbar__divider" aria-hidden="true" />
      <label className="switch" title={hasTransposing ? undefined : "移調楽器が無いため表示は変わりません"}>
        <input type="checkbox" checked={concertPitch} onChange={onToggleConcertPitch} />
        <span className="switch__track" aria-hidden="true" />
        実音表示
      </label>
      <label className="switch" title="再生中、演奏位置が見えるように自動でスクロールします">
        <input type="checkbox" checked={follow} onChange={onToggleFollow} />
        <span className="switch__track" aria-hidden="true" />
        再生位置に追従
      </label>
      {onToggleLabels && (
        <label className="switch" title="各段の左に、パートのフルネームを表示します（画面のみ・印刷されません）">
          <input type="checkbox" checked={showLabels} onChange={onToggleLabels} />
          <span className="switch__track" aria-hidden="true" />
          パート名ラベル
        </label>
      )}
      <span className="view-toolbar__spacer" />
      <span className="view-toolbar__zoom segmented">
        <button type="button" onClick={() => onZoom(clampZoom(zoom - ZOOM_STEP))} aria-label="縮小" title="縮小">
          <Icon name="zoomOut" />
        </button>
        <span className="view-toolbar__zoom-value" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" onClick={() => onZoom(clampZoom(zoom + ZOOM_STEP))} aria-label="拡大" title="拡大">
          <Icon name="zoomIn" />
        </button>
      </span>
      <button type="button" className="button" onClick={onPrint}>
        <Icon name="printer" />
        <span>印刷…</span>
      </button>
    </div>
  );
}
