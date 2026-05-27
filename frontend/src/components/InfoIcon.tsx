import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { INFO } from "../data/infoContent";

interface Props {
  id: string;
  extraContent?: ReactNode;
}

export function InfoIcon({ id, extraContent }: Props) {
  const [open, setOpen] = useState(false);
  const content = INFO[id];

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!content) return null;

  return (
    <>
      <button
        className="info-icon-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Xem giải thích chỉ số"
        aria-label="Xem giải thích chỉ số"
      >
        ⓘ
      </button>

      {open && (
        <div className="info-modal-overlay" onClick={() => setOpen(false)}>
          <div className="info-modal" onClick={(e) => e.stopPropagation()}>
            <div className="info-modal-header">
              <h3 className="info-modal-title">{content.title}</h3>
              <button className="info-modal-close" onClick={() => setOpen(false)} aria-label="Đóng">✕</button>
            </div>
            <div className="info-modal-body">
              <p className="info-modal-desc">{content.description}</p>

              {content.metrics && content.metrics.length > 0 && (
                <div className="info-modal-metrics">
                  <h4 className="info-modal-section-title">📊 Các chỉ số</h4>
                  <table className="info-metrics-table">
                    <thead>
                      <tr>
                        <th>Chỉ số</th>
                        <th>Ý nghĩa</th>
                        <th>Ví dụ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {content.metrics.map((m) => (
                        <tr key={m.name}>
                          <td className="info-metric-name">{m.name}</td>
                          <td>{m.desc}</td>
                          <td className="info-metric-example">{m.example || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {content.tip && (
                <div className="info-modal-tip">
                  <span className="info-tip-icon">💡</span>
                  <span>{content.tip}</span>
                </div>
              )}

              {extraContent && (
                <div className="info-modal-extra">
                  {extraContent}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Renders a chart/table card title row with an optional info icon */
export function ChartTitle({ text, infoKey }: { text: string; infoKey?: string }) {
  return (
    <div className="chart-title-row">
      <h4 className="chart-title-text">{text}</h4>
      {infoKey && <InfoIcon id={infoKey} />}
    </div>
  );
}
