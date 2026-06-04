import React, { useState } from "react";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Check, X } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * SelectWithAdd — a Radix Select that supports inline creation of new options.
 *
 * Props:
 *   value, onValueChange       — same as <Select>
 *   options: [{value, label, builtin?}]   — list to render
 *   onAdd(label) → newOption   — async function called when user adds; should
 *                                return the new option which we'll auto-select
 *   placeholder, addLabel, testid (prefix)
 */
export default function SelectWithAdd({
    value, onValueChange, options, onAdd,
    placeholder = "Pick one…", addLabel = "Add new",
    testid = "select-with-add",
    disabled = false,
}) {
    const [open, setOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);

    const confirmAdd = async () => {
        const label = draft.trim();
        if (!label) return;
        setBusy(true);
        try {
            const created = await onAdd(label);
            if (created?.value) {
                onValueChange(created.value);
                toast.success(`Added "${created.label || label}"`);
            }
            setDraft(""); setAdding(false); setOpen(false);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Could not add");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Select value={value} onValueChange={onValueChange} open={open} onOpenChange={setOpen} disabled={disabled}>
            <SelectTrigger data-testid={testid}><SelectValue placeholder={placeholder} /></SelectTrigger>
            <SelectContent>
                {options.map((o) => (
                    <SelectItem key={o.value} value={o.value} data-testid={`${testid}-opt-${o.value}`}>
                        <span className="flex items-center gap-2">
                            <span>{o.label}</span>
                            {o.builtin === false && (
                                <span className="text-[9px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold">
                                    Custom
                                </span>
                            )}
                        </span>
                    </SelectItem>
                ))}
                <div className="border-t border-gray-200 dark:border-gray-800 mt-1 pt-1 px-1 pb-0.5">
                    {!adding ? (
                        <button
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[#0055FF] hover:bg-blue-50 dark:hover:bg-blue-950/30 font-medium"
                            // Stop the SelectItem's auto-close behaviour
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAdding(true); }}
                            data-testid={`${testid}-add-btn`}
                        >
                            <Plus size={12} /> {addLabel}
                        </button>
                    ) : (
                        <div
                            className="flex items-center gap-1 px-1.5 py-1"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Input
                                autoFocus
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); confirmAdd(); }
                                    if (e.key === "Escape") { setAdding(false); setDraft(""); }
                                }}
                                placeholder="New name…"
                                className="h-7 text-xs"
                                data-testid={`${testid}-add-input`}
                            />
                            <Button
                                size="sm"
                                onClick={confirmAdd}
                                disabled={busy || !draft.trim()}
                                className="h-7 px-2 bg-[#0055FF] hover:bg-[#0044CC] text-white"
                                data-testid={`${testid}-add-confirm`}
                            >
                                <Check size={12} />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => { setAdding(false); setDraft(""); }}
                                className="h-7 px-2"
                                data-testid={`${testid}-add-cancel`}
                            >
                                <X size={12} />
                            </Button>
                        </div>
                    )}
                </div>
            </SelectContent>
        </Select>
    );
}
