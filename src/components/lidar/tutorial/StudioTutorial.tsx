import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SpotlightMask } from './SpotlightMask';
import { TutorialCard } from './TutorialCard';
import { STUDIO_TUTORIAL_STEPS, type TutorialStep } from './steps';
import { useTargetRect } from './useTargetRect';

/** Keeps only steps whose target is currently in the DOM (anchor-less and reveal steps always pass). */
function visibleSteps(): TutorialStep[] {
    return STUDIO_TUTORIAL_STEPS.filter(
        (s) => s.selector === null || s.reveal !== undefined || document.querySelector(s.selector) !== null,
    );
}

/** Name of the event the studio listens to so a step can open/close a surface (e.g. the Capture menu). */
export const STUDIO_REVEAL_EVENT = 'open-cairn-studio-reveal';

export interface StudioTutorialProps {
    open: boolean;
    /** Called when the user finishes the last step or presses « Passer ». */
    onClose: () => void;
}

/**
 * Interactive onboarding overlay for the LiDAR Studio. Dims the screen and
 * spotlights each real control in turn, with a guidance card the user can
 * advance, rewind, or skip. Rendered through a portal on `document.body` —
 * required because the studio top bar uses `backdrop-filter`, which would
 * otherwise become the containing block for this `fixed` overlay.
 */
export function StudioTutorial({ open, onClose }: Readonly<StudioTutorialProps>) {
    const [stepIndex, setStepIndex] = useState(0);
    const [steps, setSteps] = useState<TutorialStep[]>([]);

    // Resolve which steps to show each time the overlay opens (after a frame so
    // freshly-mounted targets have laid out), and restart at the first step.
    useEffect(() => {
        if (!open) return;
        setStepIndex(0);
        const frame = requestAnimationFrame(() => setSteps(visibleSteps()));
        return () => cancelAnimationFrame(frame);
    }, [open]);

    const step = steps[stepIndex] ?? null;
    const rect = useTargetRect(step?.selector ?? null, stepIndex);

    // Ask the studio to open the surface this step needs (e.g. the Capture
    // menu) while it is active, and close it again on leaving / closing.
    useEffect(() => {
        if (!open) return;
        const reveal = step?.reveal ?? null;
        globalThis.dispatchEvent(new CustomEvent(STUDIO_REVEAL_EVENT, { detail: reveal }));
        return () => {
            globalThis.dispatchEvent(new CustomEvent(STUDIO_REVEAL_EVENT, { detail: null }));
        };
    }, [open, step?.id, step?.reveal]);

    // Escape skips the tutorial.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        globalThis.addEventListener('keydown', onKey);
        return () => globalThis.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open || !step) return null;

    const isLast = stepIndex >= steps.length - 1;
    const handleNext = () => (isLast ? onClose() : setStepIndex((i) => i + 1));
    const handlePrev = () => setStepIndex((i) => Math.max(0, i - 1));

    return createPortal(
        <div className="dark fixed inset-0 z-[70]">
            <SpotlightMask rect={rect} />
            <TutorialCard
                rect={rect}
                placement={step.placement}
                title={step.title}
                body={step.body}
                lines={step.lines}
                gesture={step.gesture}
                stepIndex={stepIndex}
                stepCount={steps.length}
                isFirst={stepIndex === 0}
                isLast={isLast}
                onPrev={handlePrev}
                onNext={handleNext}
                onSkip={onClose}
            />
        </div>,
        document.body,
    );
}
