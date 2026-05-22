import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

function getIsMobile(): boolean {
    return globalThis.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(getIsMobile);

    useEffect(() => {
        const mql = globalThis.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
        const handler = () => setIsMobile(getIsMobile());
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);

    return isMobile;
}
