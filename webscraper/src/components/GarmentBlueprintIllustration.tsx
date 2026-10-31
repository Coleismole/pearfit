import React from 'react';
import { ProductFitReport, ZoneBreakdown } from '../utils/fitAnalyzer';

interface Props {
  category: ProductFitReport['category'];
  anatomicalBreakdown: ZoneBreakdown[];
  selectedZone?: string | null;
  onSelectZone?: (zone: string | null) => void;
}

export const GarmentBlueprintIllustration: React.FC<Props> = ({
  category,
  anatomicalBreakdown,
  selectedZone,
  onSelectZone,
}) => {
  const getZoneColor = (zoneKey: string) => {
    const found = anatomicalBreakdown.find((z) => z.zone === zoneKey);
    if (!found || found.mentionCount === 0) return '#64748b'; // neutral slate
    if (found.netTensionScore <= -0.2) return '#d97706'; // amber-600: tight / runs small
    if (found.netTensionScore >= 0.2) return '#2563eb'; // blue-600: loose / runs large
    return '#16a34a'; // emerald-600: optimal / true to size
  };

  const getZoneTag = (zoneKey: string) => {
    const found = anatomicalBreakdown.find((z) => z.zone === zoneKey);
    if (!found || found.mentionCount === 0) return 'Standard';
    if (found.netTensionScore <= -0.2) return `Tight (${found.tightPct}%)`;
    if (found.netTensionScore >= 0.2) return `Roomy (${found.loosePct}%)`;
    return `Optimal (${found.optimalPct}%)`;
  };

  const renderGarmentOutline = () => {
    if (category === 'Trousers') {
      return (
        <g stroke="#1e293b" strokeWidth="2" fill="#f8fafc">
          {/* Waistband */}
          <path d="M85 40 L195 40 L198 62 L82 62 Z" fill="#f1f5f9" />
          {/* Left & Right Legs */}
          <path d="M82 62 L198 62 L210 250 L162 250 L140 125 L118 250 L70 250 Z" />
          {/* Center fly seam & cargo pockets */}
          <line x1="140" y1="40" x2="140" y2="125" strokeDasharray="3 2" />
          <rect x="73" y="125" width="22" height="36" rx="2" fill="#f1f5f9" />
          <rect x="185" y="125" width="22" height="36" rx="2" fill="#f1f5f9" />
        </g>
      );
    }

    if (category === 'Dresses') {
      return (
        <g stroke="#1e293b" strokeWidth="2" fill="#f8fafc">
          <path d="M105 38 C120 52, 160 52, 175 38 L190 85 L178 135 L196 248 L84 248 L102 135 L90 85 Z" />
          <line x1="102" y1="135" x2="178" y2="135" strokeDasharray="4 3" stroke="#94a3b8" />
        </g>
      );
    }

    if (category === 'T-Shirts & Tops') {
      return (
        <g stroke="#1e293b" strokeWidth="2" fill="#f8fafc">
          {/* Heavyweight Drop-Shoulder Boxy Crewneck T-Shirt */}
          <path d="M84 52 L114 38 C126 48, 154 48, 166 38 L196 52 L232 96 L204 118 L186 96 L186 228 L94 228 L94 96 L76 118 L48 96 Z" />
          {/* Thick ribbed crewneck collar band */}
          <path
            d="M114 38 C126 50, 154 50, 166 38 C156 56, 124 56, 114 38 Z"
            fill="#e2e8f0"
            stroke="#1e293b"
            strokeWidth="1.75"
          />
          {/* Dropped shoulder seam lines */}
          <line x1="84" y1="52" x2="94" y2="96" stroke="#64748b" strokeDasharray="3 2" />
          <line x1="196" y1="52" x2="186" y2="96" stroke="#64748b" strokeDasharray="3 2" />
          {/* Straight-cut twin-needle bottom hem */}
          <line x1="94" y1="221" x2="186" y2="221" stroke="#94a3b8" strokeDasharray="3 2" />
        </g>
      );
    }

    // Outerwear / Knitwear / Hoodies / Shirting
    return (
      <g stroke="#1e293b" strokeWidth="2" fill="#f8fafc">
        {/* Main torso + sleeves */}
        <path d="M92 48 L118 38 C130 48, 150 48, 162 38 L188 48 L236 115 L212 132 L186 92 L186 232 L94 232 L94 92 L68 132 L44 115 Z" />
        {/* Collar or Hood detail */}
        {category === 'Fleece & Hoodies' ? (
          <path
            d="M114 38 C110 14, 170 14, 166 38"
            fill="none"
            stroke="#1e293b"
            strokeWidth="2"
          />
        ) : (
          <path d="M118 38 L140 58 L162 38" fill="none" stroke="#475569" strokeWidth="1.75" />
        )}
        {/* Center placket for Outerwear / Shirting */}
        {(category === 'Outerwear' || category === 'Shirting') && (
          <line x1="140" y1="54" x2="140" y2="232" stroke="#64748b" strokeDasharray="4 3" />
        )}
      </g>
    );
  };

  const hotspots =
    category === 'Trousers'
      ? [
          { zone: 'waist', label: 'Waist', x: 140, y: 52, lineX1: 82, lineX2: 198 },
          { zone: 'hips', label: 'Hips & Seat', x: 140, y: 96, lineX1: 78, lineX2: 202 },
          { zone: 'length', label: 'Inseam Length', x: 196, y: 195, lineX1: 170, lineX2: 210 },
        ]
      : [
          { zone: 'shoulders', label: 'Shoulders', x: 140, y: 48, lineX1: 92, lineX2: 188 },
          { zone: 'chest', label: 'Chest / Bust', x: 140, y: 98, lineX1: 94, lineX2: 186 },
          { zone: 'sleeves', label: 'Sleeves', x: 64, y: 108, lineX1: 48, lineX2: 88 },
          { zone: 'waist', label: 'Waist', x: 140, y: 152, lineX1: 94, lineX2: 186 },
          { zone: 'length', label: 'Torso Length', x: 140, y: 218, lineX1: 94, lineX2: 186 },
        ];

  return (
    <div className="bg-stone-100/80 border border-stone-200 rounded-lg p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
        <span className="font-medium text-slate-900">Technical Fit Tension Spec</span>
        <span>{category} Pattern Block</span>
      </div>

      <svg
        viewBox="0 0 280 270"
        className="w-full h-56 select-none"
        role="img"
        aria-label={`Technical fit diagram for ${category} showing tension across garment zones`}
      >
        {/* Subtle technical grid */}
        <defs>
          <pattern id="techGrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="#e7e5e4"
              strokeWidth="0.75"
            />
          </pattern>
        </defs>
        <rect width="280" height="270" fill="url(#techGrid)" rx="6" />

        {renderGarmentOutline()}

        {/* Dimension measurement lines and interactive callouts */}
        {hotspots.map((h) => {
          const color = getZoneColor(h.zone);
          const isSelected = selectedZone === h.zone;
          return (
            <g
              key={h.zone}
              onClick={() => onSelectZone && onSelectZone(isSelected ? null : h.zone)}
              className="cursor-pointer"
            >
              <line
                x1={h.lineX1}
                y1={h.y}
                x2={h.lineX2}
                y2={h.y}
                stroke={color}
                strokeWidth={isSelected ? '2.5' : '1.75'}
                strokeDasharray="3 2"
              />
              <circle
                cx={h.x}
                cy={h.y}
                r={isSelected ? 6 : 4.5}
                fill={color}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              <rect
                x={h.x - 46}
                y={h.y - 21}
                width="92"
                height="15"
                rx="3"
                fill="#0f172a"
                fillOpacity={isSelected ? '0.95' : '0.82'}
              />
              <text
                x={h.x}
                y={h.y - 11}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="8.5"
                fontFamily="JetBrains Mono, monospace"
              >
                {h.label}: {getZoneTag(h.zone)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 pt-2 border-t border-stone-200 flex items-center justify-between text-[11px] text-slate-600">
        <span>Amber: Tight / Runs Small</span>
        <span aria-hidden="true">·</span>
        <span>Green: True to Size</span>
        <span aria-hidden="true">·</span>
        <span>Blue: Loose / Large</span>
      </div>
    </div>
  );
};
