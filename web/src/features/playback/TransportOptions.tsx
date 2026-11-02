import { Icon } from "../../shared/ui/Icon";

export const RATE_OPTIONS = [25, 50, 60, 70, 75, 80, 90, 100, 110, 120, 125, 150, 175, 200];

interface TransportOptionsProps {
  ratePercent: number;
  onRate: (percent: number) => void;
  metronome: boolean;
  onToggleMetronome: () => void;
  metronomeVolume: number;
  onMetronomeVolume: (volume: number) => void;
  masterVolume: number;
  onMasterVolume: (volume: number) => void;
  loopLabel: string | null;
  loopEnabled: boolean;
  onSetLoopStart: () => void;
  onSetLoopEnd: () => void;
  onToggleLoop: () => void;
  onClearLoop: () => void;
}

export function TransportOptions(props: TransportOptionsProps) {
  const { loopLabel, loopEnabled } = props;
  return (
    <div className="transport-options" role="group" aria-label="再生設定">
      <label className="field field--inline">
        <span className="field__label">テンポ</span>
        <select value={props.ratePercent} onChange={(e) => props.onRate(Number(e.target.value))}>
          {RATE_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}%
            </option>
          ))}
        </select>
      </label>
      <span className="transport-options__group">
        <button type="button" className="toggle" aria-pressed={props.metronome} onClick={props.onToggleMetronome} title="メトロノーム (M)">
          <Icon name="metronome" />
          <span>メトロノーム</span>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={props.metronomeVolume}
          onChange={(e) => props.onMetronomeVolume(Number(e.target.value))}
          aria-label="メトロノーム音量"
        />
      </span>
      <span className="transport-options__group" role="group" aria-label="A-Bループ">
        <span className="segmented">
          <button type="button" onClick={props.onSetLoopStart} title="現在の小節をループ開始に">
            A
          </button>
          <button type="button" onClick={props.onSetLoopEnd} title="現在の小節をループ終了に">
            B
          </button>
        </span>
        <button type="button" className="toggle" aria-pressed={loopEnabled} onClick={props.onToggleLoop} title="ループ切替 (L)">
          <Icon name="loop" />
          <span>ループ</span>
        </button>
        <span className="transport-options__loop" aria-live="polite">
          {loopLabel ? `${loopLabel}${loopEnabled ? "" : "（オフ）"}` : "未設定"}
        </span>
        {loopLabel && (
          <button type="button" className="icon-button icon-button--small" onClick={props.onClearLoop} aria-label="ループを解除">
            <Icon name="close" size={14} />
          </button>
        )}
      </span>
      <label className="field field--inline transport-options__volume">
        <Icon name="volume" />
        <span className="visually-hidden">全体音量</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={props.masterVolume}
          onChange={(e) => props.onMasterVolume(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
