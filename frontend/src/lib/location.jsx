import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { socket } from "./socket";
import { setActiveLocationIdHolder, setUserRoleHolder } from "./location_holder";
import PickLocationDialog from "@/components/PickLocationDialog";

const STORAGE_KEY = "sw_active_location";
// Sentinel value persisted when super_admin picks "All locations". We keep it
// in localStorage so the choice survives a page refresh, while the React
// state surfaces `activeLocationId = null` (which the axios interceptor reads
// as "do not inject a location_id filter").
const ALL_LOCATIONS = "__all__";

const LocationCtx = createContext(null);

export function LocationProvider({ children }) {
    const { user } = useAuth();
    const [locations, setLocations] = useState([]);
    const [activeLocationId, setActiveLocationIdState] = useState(() => {
        try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
    });
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        if (!user) {
            setLocations([]);
            setLoading(false);
            return [];
        }
        try {
            const { data } = await api.get("/locations");
            setLocations(data || []);
            return data || [];
        } catch {
            setLocations([]);
            return [];
        } finally {
            setLoading(false);
        }
    }, [user]);

    // Keep module-level holder in sync (so the axios interceptor sees the latest)
    useEffect(() => {
        setActiveLocationIdHolder(activeLocationId);
    }, [activeLocationId]);

    useEffect(() => {
        setUserRoleHolder(user?.role || null);
    }, [user]);

    // Subscribe to the per-location socket room so this client only receives
    // events for the location it's currently viewing.
    //   - super_admin viewing "All locations" (activeLocationId is null) →
    //     joins SUPER_ROOM so they get events across every location.
    //   - super_admin viewing a SPECIFIC location → joins ONLY that location's
    //     room. SUPER_ROOM is NOT joined, so other locations' events do not
    //     leak in (critical for accurate "Bengalore only" notifications).
    //   - any other role → joins ONLY its own primary location's room.
    // Re-emits whenever activeLocationId or user changes, AND on socket reconnect.
    useEffect(() => {
        if (!user) return;
        const isSuper = user.role === "super_admin";
        const loc = isSuper ? activeLocationId : (user.location_id || null);
        // SUPER_ROOM is only for the cross-location aggregate view.
        const joinSuper = isSuper && !loc;

        const join = () => socket.emit("join_location", { location_id: loc, super: joinSuper });
        join();
        socket.on("connect", join);
        // When the tab regains focus after long idle, reconnect (if needed)
        // and re-emit the join so we never silently lose our room membership.
        const onVisible = () => {
            if (document.visibilityState === "visible") {
                if (!socket.connected) socket.connect();
                join();
            }
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            socket.off("connect", join);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [user, activeLocationId]);

    // Load locations whenever the user changes
    useEffect(() => {
        // While AuthProvider is still resolving (user === null), don't touch state.
        // Only react when user is explicitly false (anon) or an authenticated object.
        if (user === null) return;
        if (user === false) {
            setLocations([]);
            setActiveLocationIdState(null);
            setLoading(false);
            return;
        }
        (async () => {
            setLoading(true);
            const data = await refresh();
            if (user.role === "super_admin") {
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored === ALL_LOCATIONS) {
                    // Honour the persisted "All locations" choice
                    setActiveLocationIdState(null);
                } else if (stored && data.some((l) => l.id === stored)) {
                    setActiveLocationIdState(stored);
                } else if (data.length > 0) {
                    setActiveLocationIdState(data[0].id);
                    localStorage.setItem(STORAGE_KEY, data[0].id);
                } else {
                    setActiveLocationIdState(null);
                }
            } else {
                setActiveLocationIdState(user.location_id || null);
            }
        })();
    }, [user, refresh]);

    const setActiveLocationId = (id) => {
        // Update the module-level holder synchronously so that any
        // refetch (triggered by the AppShell remount key) sees the new value.
        setActiveLocationIdHolder(id || null);
        setActiveLocationIdState(id);
        if (id) {
            localStorage.setItem(STORAGE_KEY, id);
        } else {
            // null means "All locations" for super_admin → persist sentinel
            localStorage.setItem(STORAGE_KEY, ALL_LOCATIONS);
        }
    };

    const active = locations.find((l) => l.id === activeLocationId) || null;

    // ---- requireLocation: guard create-flows when "All locations" is active ----
    // Pages call requireLocation(callback, "user"/"room"/...). If a specific
    // location is already picked, callback runs immediately. Otherwise we open
    // a dialog asking the super_admin which location to use; after they pick,
    // we set it active and then fire the callback.
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerLabel, setPickerLabel] = useState("");
    const pendingCallbackRef = useRef(null);

    const requireLocation = useCallback((callback, resourceLabel) => {
        // Non-super-admins always have a location (their own).
        if (user?.role !== "super_admin" || activeLocationId) {
            callback();
            return;
        }
        pendingCallbackRef.current = callback;
        setPickerLabel(resourceLabel || "this resource");
        setPickerOpen(true);
    }, [user, activeLocationId]);

    const handlePickerConfirm = (locId) => {
        setActiveLocationId(locId);
        const cb = pendingCallbackRef.current;
        pendingCallbackRef.current = null;
        // Defer to next tick so the activeLocationId update is reflected in
        // the axios interceptor (location_holder) before the callback fires.
        if (cb) setTimeout(cb, 0);
    };

    return (
        <LocationCtx.Provider
            value={{
                locations, activeLocationId, setActiveLocationId, active,
                refresh, loading, requireLocation,
            }}
        >
            {children}
            <PickLocationDialog
                open={pickerOpen}
                onOpenChange={(v) => {
                    setPickerOpen(v);
                    if (!v) pendingCallbackRef.current = null;
                }}
                locations={locations}
                onConfirm={handlePickerConfirm}
                resourceLabel={pickerLabel}
            />
        </LocationCtx.Provider>
    );
}

export const useLocation = () => useContext(LocationCtx);
