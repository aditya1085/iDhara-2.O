import React, { useState } from 'react';

interface LogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  showSubtitle?: boolean;
  showBadge?: boolean;
  className?: string;
  onClick?: () => void;
}

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showText = true,
  showSubtitle = true,
  showBadge = true,
  className = '',
  onClick,
}) => {
  const [imageError, setImageError] = useState(false);

  // Dimension mapping
  const sizeMap = {
    xs: { img: 'w-5 h-5', title: 'text-xs', sub: 'text-[8px]', badge: 'text-[8.5px]' },
    sm: { img: 'w-7 h-7', title: 'text-sm', sub: 'text-[9px]', badge: 'text-[9.5px]' },
    md: { img: 'w-9 h-9', title: 'text-base', sub: 'text-[9.5px]', badge: 'text-[10px]' },
    lg: { img: 'w-12 h-12', title: 'text-lg', sub: 'text-[10.5px]', badge: 'text-[11px]' },
    xl: { img: 'w-16 h-16', title: 'text-2xl', sub: 'text-xs', badge: 'text-xs' },
  };

  const currentSize = sizeMap[size];

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 select-none ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {/* Logo Emblem Icon */}
      <div className="relative shrink-0 group">
        <div
          className={`${currentSize.img} rounded-full overflow-hidden border border-cyan-400/60 shadow-[0_0_10px_rgba(6,182,212,0.45)] bg-[#040810] flex items-center justify-center transition-transform duration-200 group-hover:scale-105`}
        >
          {!imageError ? (
            <img
              src="/src/assets/images/idhara_logo_1791523157624.jpg"
              alt="iDhara Logo"
              className="w-full h-full object-cover scale-105"
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
            />
          ) : (
            // High-fidelity vector SVG fallback
            <svg
              viewBox="0 0 100 100"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full h-full p-1"
            >
              <circle cx="50" cy="50" r="46" stroke="#06b6d4" strokeWidth="2.5" strokeDasharray="4 2" />
              <circle cx="50" cy="50" r="38" stroke="#0284c7" strokeWidth="1.5" />
              <path
                d="M18 58 C 28 42, 42 42, 52 58 C 62 74, 76 74, 84 58"
                stroke="#38bdf8"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M22 68 C 32 54, 44 54, 54 68 C 64 82, 74 82, 80 68"
                stroke="#06b6d4"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="50" cy="32" r="5" fill="#38bdf8" />
              <path d="M50 20 L50 26 M50 38 L50 44" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </div>
        {/* Radar live pulse ring */}
        <div className="absolute -inset-0.5 rounded-full border border-cyan-400/30 animate-ping pointer-events-none opacity-40" />
      </div>

      {/* Brand Typography & Subtitle */}
      {showText && (
        <div className="flex flex-col leading-none">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`${currentSize.title} font-bold tracking-tight text-white font-sans flex items-center`}
            >
              <span className="text-cyan-400 font-extrabold">i</span>
              <span>Dhara</span>
            </span>
            {showBadge && (
              <span
                className={`${currentSize.badge} font-mono font-bold text-cyan-400 px-1 py-0.2 bg-cyan-950/80 border border-cyan-500/40 rounded-xs`}
              >
                EOC
              </span>
            )}
          </div>
          {showSubtitle && (
            <span
              className={`${currentSize.sub} text-slate-400 font-mono font-medium tracking-wide mt-0.5 whitespace-nowrap`}
            >
              Urban Flood & Disaster Twin
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default Logo;
