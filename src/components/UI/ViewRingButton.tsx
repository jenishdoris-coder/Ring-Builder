import { useEffect, useId, useState } from "react";

export const ViewRingButton = ({ visible, onClick }: { visible: boolean; onClick: () => void }) => {
  const [collapsed, setCollapsed] = useState(false);
  const arcId = `view-ring-arc-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    setCollapsed(false);
    if (!visible) return;
    const timer = window.setTimeout(() => setCollapsed(true), 2000);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return <button type="button"
    className={`product-view-ring-floating ${visible ? "is-visible" : ""} ${collapsed ? "is-collapsed" : ""}`}
    aria-label="View your ring" aria-hidden={!visible} tabIndex={visible ? 0 : -1}
    aria-controls="ring-gallery" onClick={onClick}>
    <svg className="product-view-ring-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 9.2a7 7 0 1 0 9 0" /><path d="m8 3-3 4 7 6 7-6-3-4H8Z" />
      <path d="M5 7h14M9 3l3 10 3-10" strokeWidth="1.1" />
    </svg>
    <span className="product-view-ring-label" aria-hidden="true">View your ring</span>
    <svg className="product-view-ring-curve" viewBox="0 0 76 76" aria-hidden="true">
      <defs><path id={arcId} d="M12 44a26 26 0 0 1 52 0" /></defs>
      <text><textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">View your ring</textPath></text>
    </svg>
  </button>;
};
