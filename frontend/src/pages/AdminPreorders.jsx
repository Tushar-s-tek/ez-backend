import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocation } from "@/lib/location";
import { socket } from "@/lib/socket";
import { playEventSound, setSoundConfig } from "@/lib/sound";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const FLOW = ["pending", "accepted", "preparing", "delivered"];
const STATUS_LABEL = {
    pending: { c: "bg-amber-50 text-amber-700 border-amber-200", label: "Pending", next: "Accept" },
    accepted: { c: "bg-blue-50 text-blue-700 border-blue-200", label: "Accepted", next: "Start" },
    preparing: { c: "bg-violet-50 text-violet-700 border-violet-200", label: "Preparing", next: "Ready" },
    delivered: { c: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Ready", next: null },
    cancelled: { c: "bg-gray-100 text-gray-600 border-gray-200", label: "Cancelled", next: null },
};

export default function AdminPreorders() {
    const { user } = useAuth();
    const { activeLocationId } = useLocation() || {};
    const [orders, setOrders] = useState([]);

    const load = async () => {
        const { data } = await api.get("/preorders");
        setOrders(data);
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeLocationId]);

    useEffect(() => {
        (async () => {
            try {
                const params = activeLocationId ? { location_id: activeLocationId } : {};
                const { data } = await api.get("/settings/sounds", { params });
                const map = Object.fromEntries(
                    Object.entries(data || {}).filter(([_, v]) => v).map(([k, v]) => [k.replace(/^sound_/, ""), v])
                );
                if (Object.keys(map).length) setSoundConfig(map);
            } catch {}
        })();
    }, [activeLocationId]);

    useEffect(() => {
        // Same department-filter rules as StaffDashboard so visitors of /orders
        // also only see preorders intended for them.
        const expectedLoc = user?.role === "super_admin"
            ? activeLocationId
            : (user?.location_id || null);
        const sameLocation = (e) => !expectedLoc || (e && e.location_id === expectedLoc);
        const isMyDepartment = (e) => {
            if (user?.role === "super_admin" || user?.role === "admin") return true;
            const myDept = user?.department_id;
            if (!myDept) return false;
            if (e.department_id && e.department_id === myDept) return true;
            if (Array.isArray(e.department_ids) && e.department_ids.includes(myDept)) return true;
            return false;
        };

        const onNew = (o) => {
            if (!sameLocation(o) || !isMyDepartment(o)) return;
            setOrders((p) => [o, ...p.filter((x) => x.id !== o.id)]);
            playEventSound("new_order");
            toast.info(`New food order: ${o.room_name}`);
        };
        const onUpd = (o) => {
            if (!sameLocation(o) || !isMyDepartment(o)) return;
            setOrders((p) => p.map((x) => (x.id === o.id ? o : x)));
        };
        socket.on("preorder:new", onNew);
        socket.on("preorder:update", onUpd);
        return () => { socket.off("preorder:new", onNew); socket.off("preorder:update", onUpd); };
    }, [user, activeLocationId]);

    const advance = async (o) => {
        const idx = FLOW.indexOf(o.status);
        if (idx < 0 || idx >= FLOW.length - 1) return;
        try {
            await api.patch(`/preorders/${o.id}/status`, { status: FLOW[idx + 1] });
        } catch { toast.error("Failed"); }
    };

    return (
        <AppShell title="Pre-orders" subtitle="Cafeteria queue">
            <div className="p-6 space-y-3" data-testid="preorder-list">
                {orders.length === 0 && <Card className="p-12 border-dashed text-center text-gray-400">No pre-orders yet.</Card>}
                {orders.map((o) => {
                    const st = STATUS_LABEL[o.status] || STATUS_LABEL.pending;
                    return (
                        <Card key={o.id} className="bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800 p-5" data-testid={`preorder-card-${o.id}`}>
                            <div className="flex items-start gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-display font-semibold text-gray-900 dark:text-gray-100">{o.room_name}</span>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${st.c}`}>{st.label}</span>
                                        <span className="font-mono text-xs text-gray-500">{new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                    </div>
                                    <ul className="mt-2 text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                                        {(o.items || []).map((it, i) => (
                                            <li key={i} className="flex items-center gap-2">
                                                <span className="font-mono text-gray-500 w-8">×{it.qty}</span>
                                                <span>{it.name}</span>
                                                <span className="font-mono text-gray-500 ml-auto">₹{(it.price * it.qty).toFixed(0)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="font-display font-bold text-xl text-gray-900 dark:text-gray-100">₹ {o.total?.toFixed?.(0)}</div>
                                    {o.status !== "delivered" && o.status !== "cancelled" && (
                                        <Button size="sm" onClick={() => advance(o)} className="bg-[#0055FF] hover:bg-[#0044CC] text-white mt-2" data-testid={`preorder-${o.id}-advance-btn`}>
                                            → {STATUS_LABEL[FLOW[FLOW.indexOf(o.status) + 1]]?.label}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </AppShell>
    );
}
