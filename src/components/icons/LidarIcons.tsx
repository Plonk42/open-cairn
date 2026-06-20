import type { ReactElement } from 'react';

export type IconProps = Readonly<{ className?: string }>;

// Shared LiDAR Studio glyphs (20×20 / 24×24, heroicons-mini style).
// Consolidated here so the bottom bar, gallery and export dialog share one set.

export function OpacityIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className={className} aria-hidden="true">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10 3a7 7 0 0 0 0 14V3Z" fill="currentColor" />
        </svg>
    );
}

export function ClassesIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10 1.5 2 5.5l8 4 8-4-8-4Z" />
            <path d="M2.5 9.5 10 13.25 17.5 9.5l1.5.75-9 4.5-9-4.5 1.5-.75Z" opacity="0.55" />
        </svg>
    );
}

export function ShaderIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M10 2a8 8 0 1 0 0 16c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.36-.6-.36-.99 0-.83.67-1.5 1.5-1.5H14a4 4 0 0 0 4-4c0-3.87-3.58-6-8-6Zm-4.5 8a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm2.5-3.5A1.25 1.25 0 1 1 8 4a1.25 1.25 0 0 1 0 2.5Zm4 0A1.25 1.25 0 1 1 12 4a1.25 1.25 0 0 1 0 2.5Zm2.5 3.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" clipRule="evenodd" />
        </svg>
    );
}

export function SizeIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <circle cx="5.5" cy="14.5" r="1.2" />
            <circle cx="10" cy="11" r="1.8" />
            <circle cx="15" cy="6" r="2.6" />
        </svg>
    );
}

export function LightIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.06ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.06a.75.75 0 1 0-1.061 1.06l1.06 1.06Z" />
        </svg>
    );
}

export function ShadowIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className={className} aria-hidden="true">
            <ellipse cx="12.5" cy="14" rx="5.5" ry="2" fill="currentColor" opacity="0.4" />
            <circle cx="8" cy="8" r="5" fill="currentColor" />
        </svg>
    );
}

export function EffectsIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
        </svg>
    );
}

export function CaptureIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
            <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
            <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
            <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
            <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
    );
}

export function OrbitIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
            <ellipse cx="10" cy="10" rx="8" ry="3.4" stroke="currentColor" strokeWidth="1.4" transform="rotate(-30 10 10)" />
            <circle cx="10" cy="10" r="3" fill="currentColor" />
            <circle cx="16.5" cy="6.2" r="1.3" fill="currentColor" />
        </svg>
    );
}

export function ResetIcon({ className }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h1.103a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v2.715a.75.75 0 0 0 1.5 0v-.964l.31.311a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V4.456a.75.75 0 0 0-1.5 0v.964l-.31-.311A7 7 0 0 0 3.239 8.247a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.17l.311.31h-1.103a.75.75 0 0 0 0 1.5h2.716a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
        </svg>
    );
}

export function PopoverCloseIcon({ className = 'h-4 w-4' }: IconProps): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
    );
}
