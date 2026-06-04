import React from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "@/lib/location";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MapPin } from "@phosphor-icons/react";

// Sentinel value for "All locations" used by Radix Select (which doesn't accept "").
const ALL_LOCATIONS = "__all__";

/**
 * Header switcher for super_admin: pick which Location to act on, or "All
 * locations" to see live updates from every location at once.
 * For non-super-admin users we just show their fixed location (read-only chip).
 */
export default function LocationSwitcher() {
    const { user } = useAuth();
    const { locations, activeLocationId, setActiveLocationId, active } = useLocation();

    if (!user) return null;

    // Non-super-admin: read-only chip
    if (user.role !== "super_admin") {
        const label = active?.name || (locations[0]?.name ?? "—");
        return (
            <div
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-xs text-gray-700 dark:text-gray-300"
                data-testid="location-chip"
                title="Your assigned location"
            >
                <MapPin size={14} weight="duotone" className="text-[#0055FF]" />
                <span className="font-medium truncate max-w-[140px]">{label}</span>
            </div>
        );
    }

    if (!locations || locations.length === 0) {
        return (
            <div className="text-xs text-gray-500 hidden sm:block" data-testid="location-empty">
                No locations
            </div>
        );
    }

    // For super_admin: null activeLocationId means "All locations"
    const value = activeLocationId || ALL_LOCATIONS;

    const handleChange = (v) => {
        if (v === ALL_LOCATIONS) {
            setActiveLocationId(null);
        } else {
            setActiveLocationId(v);
        }
    };

    return (
        <div className="flex items-center gap-1.5" data-testid="location-switcher">
            <MapPin size={14} weight="duotone" className="text-[#0055FF]" />
            <Select value={value} onValueChange={handleChange}>
                <SelectTrigger
                    className="h-8 min-w-[170px] text-xs border-gray-200 dark:border-gray-800 dark:bg-[#0B0D10] dark:text-gray-100"
                    data-testid="location-switcher-trigger"
                >
                    <SelectValue placeholder="Choose location" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem
                        value={ALL_LOCATIONS}
                        data-testid="location-option-all"
                    >
                        <span className="font-semibold text-[#0055FF]">All locations</span>
                    </SelectItem>
                    <div className="my-1 border-t border-gray-200 dark:border-gray-800" />
                    {locations.map((l) => (
                        <SelectItem
                            key={l.id}
                            value={l.id}
                            data-testid={`location-option-${l.id}`}
                        >
                            {l.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
