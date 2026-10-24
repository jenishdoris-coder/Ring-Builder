import React from "react";

interface LoadingIndicatorProps {
  isLoading: boolean;
  message?: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  isLoading,
  message = "Refining Ring 3D Model...",
}) => {
  if (!isLoading) return null;

  return (
    <div className="atelier-loading-pill atelier-interactive">
      <div className="mini-spinner" />
      <span>{message}</span>
    </div>
  );
};
