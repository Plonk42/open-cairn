import { STAGE_LABELS, type LidarProgress, type LidarProgressStage } from '@/lib/lidarBrowser';

/** Progress stage ordering for the progress bar. */
const STAGE_ORDER: LidarProgressStage[] = ['wfs', 'tiles', 'normals', 'mesh', 'colors', 'done'];

/** Staged progress bar shown while a LiDAR cloud is loading. */
export function LidarProgressBar({ progress }: Readonly<{ progress: LidarProgress }>) {
    return (
        <div className="rounded-md bg-green-50 p-2.5 ring-1 ring-green-200 dark:bg-green-900/20 dark:ring-green-800">
            <div className="flex items-center gap-2 text-xs font-medium text-green-800 dark:text-green-300">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                <span>{STAGE_LABELS[progress.stage]}</span>
            </div>
            {progress.detail && (
                <p className="mt-1 text-[11px] text-green-700 dark:text-green-400">{progress.detail}</p>
            )}
            <div className="mt-2 flex gap-0.5">
                {STAGE_ORDER.slice(0, -1).map((stage) => {
                    const currentIdx = STAGE_ORDER.indexOf(progress.stage);
                    const stageIdx = STAGE_ORDER.indexOf(stage);
                    const isComplete = stageIdx < currentIdx;
                    const isCurrent = stageIdx === currentIdx;
                    let barClass = 'bg-gray-200 dark:bg-slate-700';
                    if (isComplete) barClass = 'bg-green-600';
                    else if (isCurrent) barClass = 'bg-green-400 dark:bg-green-500';
                    return (
                        <div key={stage} className="flex-1" title={STAGE_LABELS[stage]}>
                            <div
                                className={`h-1.5 rounded-full transition-all duration-300 ${barClass}`}
                                style={isCurrent && progress.progress !== undefined ? {
                                    background: `linear-gradient(to right, rgb(22 163 74) ${progress.progress * 100}%, rgb(229 231 235) ${progress.progress * 100}%)`
                                } : undefined}
                            />
                        </div>
                    );
                })}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-green-600/70 dark:text-green-400/60">
                <span>WFS</span>
                <span>Dalles</span>
                <span>Normales</span>
                <span>Maillage</span>
                <span>Couleurs</span>
            </div>
        </div>
    );
}
