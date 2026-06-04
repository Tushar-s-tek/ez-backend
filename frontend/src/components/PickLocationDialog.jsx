import React, { useState, useEffect } from "react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MapPin, ArrowRight } from "@phosphor-icons/react";

/**
 * PickLocationDialog — modal shown when a super_admin tries to create a
 * tenant-scoped resource (Room, Category, Department, Menu item, User) while
 * the header LocationSwitcher is in "All locations" mode. The user picks a
 * target location inline; on Continue we mutate the active location and fire
 * the original create callback.
 *
 * Controlled entirely by LocationProvider — pages don't render it themselves.
 */
export default function PickLocationDialog({
    open,
    onOpenChange,
    locations,
    onConfirm,
    resourceLabel,
}) {
    const [picked, setPicked] = useState("");

    // Seed with first location when opened
    useEffect(() => {
        if (open && !picked && (locations || []).length > 0) {
            setPicked(locations[0].id);
        }
    }, [open, locations, picked]);

    const handleConfirm = () => {
        if (!picked) return;
        onConfirm(picked);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm" data-testid="pick-location-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MapPin size={20} weight="duotone" className="text-[#0055FF]" />
                        Pick a location
                    </DialogTitle>
                    <DialogDescription>
                        You're viewing <span className="font-semibold">All locations</span>.
                        Choose a specific location to create {resourceLabel || "this resource"} in.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                    <div>
                        <Select value={picked} onValueChange={setPicked}>
                            <SelectTrigger
                                className="h-10"
                                data-testid="pick-location-select"
                            >
                                <SelectValue placeholder="Choose a location…" />
                            </SelectTrigger>
                            <SelectContent>
                                {(locations || []).map((l) => (
                                    <SelectItem
                                        key={l.id}
                                        value={l.id}
                                        data-testid={`pick-location-option-${l.id}`}
                                    >
                                        {l.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                        <Button
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            data-testid="pick-location-cancel"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConfirm}
                            disabled={!picked}
                            className="bg-[#0055FF] hover:bg-[#0044CC] text-white"
                            data-testid="pick-location-confirm"
                        >
                            Continue <ArrowRight size={14} className="ml-1" />
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
