/**
 * Visitor badge — print-friendly card (A6/A7 size).
 *
 * Usage:
 *   <VisitorBadge visitor={visitor} />
 *
 * Page-level CSS in `index.css` hides everything except `.print-badge`
 * when window.print() runs, so any caller can trigger a clean print.
 */
import React from "react";
import { IdentificationCard, User } from "@phosphor-icons/react";

function formatTime(iso) {
    if (!iso) return "—";
    try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch {
        return iso;
    }
}

export default function VisitorBadge({ visitor }) {
    if (!visitor) return null;
    const photo = visitor.photo_data_url;
    const qr = visitor.badge_qr || visitor.checkin_qr;

    return (
        <div
            className="print-badge bg-white text-gray-900 rounded-xl border-2 border-[#0055FF] shadow-lg overflow-hidden"
            style={{ width: "100%", maxWidth: 380, aspectRatio: "5 / 7" }}
            data-testid="visitor-badge"
        >
            {/* Header band */}
            <div className="bg-[#0055FF] text-white px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <IdentificationCard size={18} weight="duotone" />
                    <span className="font-display font-semibold text-sm tracking-wide">VISITOR</span>
                </div>
                <span className="text-[10px] font-mono opacity-90">PIN {visitor.pin || "—"}</span>
            </div>

            {/* Body */}
            <div className="p-4 flex flex-col h-[calc(100%-40px)]">
                <div className="flex gap-3">
                    <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 grid place-items-center shrink-0">
                        {photo ? (
                            <img src={photo} alt={visitor.name} className="w-full h-full object-cover" />
                        ) : (
                            <User size={42} weight="duotone" className="text-gray-300" />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-display text-base font-bold leading-tight">{visitor.name}</div>
                        {visitor.company && <div className="text-xs text-gray-600 mt-0.5">{visitor.company}</div>}
                        <div className="mt-2 text-[11px] uppercase tracking-wider text-gray-500">Host</div>
                        <div className="text-sm font-medium leading-snug">{visitor.host_room_name}</div>
                    </div>
                </div>

                {visitor.purpose && (
                    <div className="mt-3">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500">Purpose</div>
                        <div className="text-sm text-gray-800 line-clamp-2">{visitor.purpose}</div>
                    </div>
                )}

                <div className="mt-auto pt-3 grid grid-cols-2 gap-2 items-end">
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-gray-500">Valid until</div>
                        <div className="text-xs font-medium">{formatTime(visitor.valid_until)}</div>
                        {visitor.nda_signed_at && (
                            <div className="mt-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 uppercase tracking-wider">
                                NDA Accepted
                            </div>
                        )}
                    </div>
                    {qr && (
                        <img
                            src={qr}
                            alt="badge QR"
                            className="w-28 h-28 ml-auto rounded border border-gray-200 bg-white p-1"
                            data-testid="visitor-badge-qr"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
