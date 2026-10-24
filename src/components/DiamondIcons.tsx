import React from "react";

export const DiamondIcon: React.FC<{
  shapeId: string;
  size?: number;
  className?: string;
  color?: string;
}> = ({ shapeId, size = 28, className = "", color = "currentColor" }) => {
  const normId = shapeId.toLowerCase();

  switch (normId) {
    case "round":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <circle cx="12" cy="12" r="9" />
          <polygon points="12,6 17,9 15,15 9,15 7,9" />
          <line x1="12" y1="3" x2="12" y2="6" />
          <line x1="20.5" y1="8" x2="17" y2="9" />
          <line x1="18.5" y1="17.5" x2="15" y2="15" />
          <line x1="5.5" y1="17.5" x2="9" y2="15" />
          <line x1="3.5" y1="8" x2="7" y2="9" />
        </svg>
      );

    case "oval":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <ellipse cx="12" cy="12" rx="7" ry="9.5" />
          <polygon points="12,5.5 16,9 14,15 10,15 8,9" />
          <line x1="12" y1="2.5" x2="12" y2="5.5" />
          <line x1="12" y1="18.5" x2="12" y2="21.5" />
          <line x1="5" y1="12" x2="8" y2="12" />
          <line x1="16" y1="12" x2="19" y2="12" />
        </svg>
      );

    case "emerald":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <polygon points="6,3 18,3 21,7 21,17 18,21 6,21 3,17 3,7" />
          <rect x="7" y="6" width="10" height="12" />
          <line x1="3" y1="7" x2="7" y2="6" />
          <line x1="21" y1="7" x2="17" y2="6" />
          <line x1="21" y1="17" x2="17" y2="18" />
          <line x1="3" y1="17" x2="7" y2="18" />
        </svg>
      );

    case "cushion":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <rect x="7.5" y="7.5" width="9" height="9" rx="2" />
          <line x1="3.5" y1="3.5" x2="7.5" y2="7.5" />
          <line x1="20.5" y1="3.5" x2="16.5" y2="7.5" />
          <line x1="20.5" y1="20.5" x2="16.5" y2="16.5" />
          <line x1="3.5" y1="20.5" x2="7.5" y2="16.5" />
        </svg>
      );

    case "pear":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M12 3 C12 3 5 11 5 16 A7 7 0 0 0 19 16 C19 11 12 3 12 3 Z" />
          <polygon points="12,7 15.5,13 13.5,18 10.5,18 8.5,13" />
        </svg>
      );

    case "princess":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <rect x="4" y="4" width="16" height="16" />
          <polygon points="12,4 20,12 12,20 4,12" />
          <line x1="4" y1="4" x2="20" y2="20" />
          <line x1="20" y1="4" x2="4" y2="20" />
        </svg>
      );

    case "radiant":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <polygon points="6,3 18,3 21,6 21,18 18,21 6,21 3,18 3,6" />
          <polygon points="12,3 21,12 12,21 3,12" />
          <rect x="8" y="8" width="8" height="8" />
        </svg>
      );

    case "asscher":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <polygon points="7,3 17,3 21,7 21,17 17,21 7,21 3,17 3,7" />
          <polygon points="9,6 15,6 18,9 18,15 15,18 9,18 6,15 6,9" />
          <rect x="8.5" y="8.5" width="7" height="7" />
          <line x1="3" y1="3" x2="8.5" y2="8.5" />
          <line x1="21" y1="3" x2="15.5" y2="8.5" />
          <line x1="21" y1="21" x2="15.5" y2="15.5" />
          <line x1="3" y1="21" x2="8.5" y2="15.5" />
        </svg>
      );

    case "marquise":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M12 2 C18 7 19 17 12 22 C5 17 6 7 12 2 Z" />
          <polygon points="12,6 16,12 12,18 8,12" />
          <line x1="6" y1="12" x2="18" y2="12" />
        </svg>
      );

    case "heart":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          <polygon points="12,7 16,11 12,16 8,11" />
        </svg>
      );

    default:
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <polygon points="6,3 18,3 22,9 12,22 2,9" />
          <polyline points="2,9 12,9 22,9" />
          <polyline points="6,3 12,9 18,3" />
          <polyline points="12,9 12,22" />
        </svg>
      );
  }
};
