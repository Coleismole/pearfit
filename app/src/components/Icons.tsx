// The line icons from the design, as inline SVG. They are decoration: the text next to them carries the meaning.
import type { ReactNode } from "react";

function Icon({ size = 22, width = 1.8, children }: { size?: number; width?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type Props = { size?: number };

export const HomeIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Icon>
);

export const HangerIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M10 5a2 2 0 1 1 2 2v1.5L3.4 15.6a1 1 0 0 0 .6 1.9h16a1 1 0 0 0 .6-1.9L12 8.5" />
  </Icon>
);

export const PersonIcon = ({ size }: Props) => (
  <Icon size={size}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Icon>
);

export const SearchIcon = ({ size = 18 }: Props) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);

export const BackIcon = ({ size }: Props) => (
  <Icon size={size} width={2}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const ChevronIcon = ({ size = 18 }: Props) => (
  <Icon size={size} width={2}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const CheckIcon = ({ size = 18 }: Props) => (
  <Icon size={size} width={2.2}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const PlusIcon = ({ size = 18 }: Props) => (
  <Icon size={size} width={2}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CompareIcon = ({ size = 20 }: Props) => (
  <Icon size={size}>
    <rect x="3" y="4" width="7" height="16" rx="1.5" />
    <rect x="14" y="4" width="7" height="16" rx="1.5" />
  </Icon>
);

export const CloseIcon = ({ size = 18 }: Props) => (
  <Icon size={size} width={2.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const AlertIcon = ({ size }: Props) => (
  <Icon size={size} width={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.5h.01" />
  </Icon>
);

export const InfoIcon = ({ size }: Props) => (
  <Icon size={size} width={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <path d="M12 7.5h.01" />
  </Icon>
);

export const ShirtIcon = ({ size }: Props) => (
  <Icon size={size} width={1.5}>
    <path d="M8.5 3 3 6.5 5 10l2.5-1.2V21h9V8.8L19 10l2-3.5L15.5 3c-.5 1.8-1.8 2.8-3.5 2.8S9 4.8 8.5 3Z" />
  </Icon>
);
