import React from 'react';

export function PlanaLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Orange filled swoosh */}
      <path 
        d="M20 70 C 15 50, 40 30, 60 35 C 70 38, 50 60, 40 50 C 30 40, 25 60, 35 70 Z" 
        fill="#F26A00" 
      />
      {/* Outlined swoosh */}
      <path 
        d="M50 45 C 55 25, 80 25, 90 40 C 95 50, 75 60, 65 50 C 55 40, 50 55, 60 65 Z" 
        stroke="#94A3B8" 
        strokeWidth="1.5"
        fill="transparent"
      />
    </svg>
  );
}
