import {
    RESOLUTION_OPTIONS,
    readResolution,
    writeResolution,
    type ExportResolutionScale,
} from '@/lib/screenshot';
import { useState } from 'react';
import { createPortal } from 'react-dom';

export type { ExportResolutionScale } from '@/lib/screenshot';

/** Persisted export destination choice (survives across exports). */
const TARGET_KEY = 'open-cairn-export-target';

export interface ExportTarget {
    local: boolean;
    download: boolean;
}

function readTarget(): ExportTarget {
    try {
        const raw = localStorage.getItem(TARGET_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<ExportTarget>;
            return { local: parsed.local ?? true, download: parsed.download ?? false };
        }
    } catch { /* ignore */ }
    return { local: true, download: false };
}

function writeTarget(target: ExportTarget): void {
    try {
        localStorage.setItem(TARGET_KEY, JSON.stringify(target));
    } catch { /* ignore quota */ }
}

function ExportChoice({
    checked,
    onChange,
    title,
    desc,
}: Readonly<{ checked: boolean; onChange: (v: boolean) => void; title: string; desc: string }>) {
    return (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10 transition hover:bg-white/10 hover:ring-emerald-400/50">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                aria-label={title}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-emerald-500"
            />
            <span>
                <span className="block text-sm font-medium text-white">{title}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{desc}</span>
            </span>
        </label>
    );
}

/**
 * Modal prompting for a scene title/description and export destination
 * (local "Mes vues" and/or downloaded .zip). Self-contained: owns the form
 * state and persists the destination choice; calls back when the user
 * confirms an export or asks for a one-off .png frame.
 */
export function ExportDialog({
    onExport,
    onDownloadImage,
    onClose,
}: Readonly<{
    onExport: (title: string, description: string, target: ExportTarget) => void;
    onDownloadImage: (resolution: ExportResolutionScale) => void;
    onClose: () => void;
}>) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [target, setTarget] = useState<ExportTarget>(() => readTarget());
    const [resolution, setResolution] = useState<ExportResolutionScale>(() => readResolution());

    const updateTarget = (patch: Partial<ExportTarget>) => {
        setTarget((prev) => {
            const next = { ...prev, ...patch };
            writeTarget(next);
            return next;
        });
    };

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className="dark w-full max-w-sm rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
                <h3 className="text-sm font-semibold text-white">Exporter cette vue</h3>
                <p className="mt-1 text-xs text-slate-400">
                    Donnez un titre et une description, puis choisissez où enregistrer la scène.
                </p>
                <div className="mt-4 space-y-3">
                    <label className="block">
                        <span className="text-xs font-medium text-slate-300">Titre</span>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Ex. Rocher de Chalves"
                            autoFocus
                            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white ring-1 ring-white/15 placeholder:text-slate-500 focus:outline-none focus:ring-emerald-400/60"
                        />
                    </label>
                    <label className="block">
                        <span className="text-xs font-medium text-slate-300">Description <span className="text-slate-500">(optionnel)</span></span>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Ex. Les Rochers de Chalves, au coucher du soleil."
                            rows={2}
                            className="mt-1 w-full resize-none rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white ring-1 ring-white/15 placeholder:text-slate-500 focus:outline-none focus:ring-emerald-400/60"
                        />
                    </label>
                </div>
                <p className="mt-4 text-xs font-medium text-slate-400">Enregistrer&nbsp;:</p>
                <div className="mt-2 space-y-2">
                    <ExportChoice
                        checked={target.local}
                        onChange={(v) => updateTarget({ local: v })}
                        title="Stocker dans « Mes vues »"
                        desc="Enregistre la scène dans le navigateur pour la rouvrir instantanément."
                    />
                    <ExportChoice
                        checked={target.download}
                        onChange={(v) => updateTarget({ download: v })}
                        title="Télécharger"
                        desc="Télécharge un fichier .zip (à publier dans la galerie showcase)."
                    />
                </div>
                <div className="mt-4 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/15 transition hover:bg-white/10"
                    >
                        Annuler
                    </button>
                    <button
                        type="button"
                        onClick={() => { onExport(title, description, target); }}
                        disabled={!target.local && !target.download}
                        className="flex-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-emerald-400 disabled:opacity-40"
                    >
                        Exporter
                    </button>
                </div>
                <label className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-300">Résolution de l’image</span>
                    <select
                        value={resolution}
                        onChange={(e) => {
                            const v = Number(e.target.value) as ExportResolutionScale;
                            setResolution(v);
                            writeResolution(v);
                        }}
                        className="rounded-md bg-white/5 px-2 py-1 text-xs text-white ring-1 ring-white/15 focus:outline-none focus:ring-emerald-400/60"
                    >
                        {RESOLUTION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value} className="bg-slate-900">
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    onClick={() => { onDownloadImage(resolution); }}
                    className="mt-2 w-full rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
                >
                    Télécharger seulement l’image (.png)
                </button>
            </div>
        </div>,
        document.body,
    );
}
