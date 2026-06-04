import React, { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { socket } from "@/lib/socket";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    CheckCircle, PlayCircle, Truck, XCircle, Warning, Clock, ChatCircle, ArrowRight,
    ForkKnife, ShoppingCart, Flag,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { PhosphorIcon } from "@/components/PhosphorIcon";
import { playEventSound, primeAudio, setSoundConfig } from "@/lib/sound";
import { ensureNotificationPermission, notifyBackground } from "@/lib/notify";
import NotificationsBanner from "@/components/NotificationsBanner";

const STATUS_PIPELINE = [
    { key: "requested", label: "Pending", color: "amber" },
    { key: "accepted", label: "Accepted", color: "blue" },
    { key: "in_progress", label: "In Progress", color: "violet" },
    { key: "delivered", label: "Ready", color: "emerald" },
    { key: "closed", label: "Closed", color: "gray" },
];

const PREORDER_PIPELINE = [
    { key: "pending", label: "Pending", color: "amber" },
    { key: "accepted", label: "Accepted", color: "blue" },
    { key: "preparing", label: "Preparing", color: "violet" },
    { key: "delivered", label: "Ready", color: "emerald" },
];

const NEXT_ACTION = {
    requested: { next: "accepted", label: "Accept", icon: CheckCircle, color: "bg-[#0055FF] hover:bg-[#0044CC]", sound: "accepted" },
    accepted: { next: "in_progress", label: "Start", icon: PlayCircle, color: "bg-violet-600 hover:bg-violet-700", sound: "started" },
    in_progress: { next: "delivered", label: "Ready", icon: Flag, color: "bg-emerald-600 hover:bg-emerald-700", sound: "ready" },
    delivered: { next: "closed", label: "Close", icon: XCircle, color: "bg-gray-700 hover:bg-gray-800" },
};

const PREORDER_NEXT_ACTION = {
    pending: { next: "accepted", label: "Accept", icon: CheckCircle, color: "bg-[#0055FF] hover:bg-[#0044CC]", sound: "accepted" },
    accepted: { next: "preparing", label: "Start", icon: PlayCircle, color: "bg-violet-600 hover:bg-violet-700", sound: "started" },
    preparing: { next: "delivered", label: "Ready", icon: Flag, color: "bg-emerald-600 hover:bg-emerald-700", sound: "ready" },
};

function elapsedSec(iso) {
    if (!iso) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

function formatElapsed(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function timerColor(sec, esc = 15) {
    const min = sec / 60;
    if (min < 5) return "text-emerald-600";
    if (min < esc) return "text-amber-600";
    return "text-red-600";
}

export default function StaffDashboard() {
    const { user } = useAuth();
    const { activeLocationId, loading: locLoading } = useLocation() || {};
    const [requests, setRequests] = useState([]);
    const [preorders, setPreorders] = useState([]);
    const [filter, setFilter] = useState("active");
    const [tick, setTick] = useState(0);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        // ticker for timers
        const t = setInterval(() => setTick((x) => x + 1), 1000);
        // prime audio on first user interaction so browser allows playback
        const prime = () => primeAudio();
        window.addEventListener("click", prime, { once: true });
        window.addEventListener("keydown", prime, { once: true });
        return () => {
            clearInterval(t);
            window.removeEventListener("click", prime);
            window.removeEventListener("keydown", prime);
        };
    }, []);

    // Track IDs we've already notified about (across socket + polling) so
    // refetches after idle don't double-buzz the user.
    const knownIdsRef = React.useRef({ requests: new Set(), preorders: new Set() });
    const firstLoadRef = React.useRef(true);

    const load = async () => {
        try {
            const [r, o] = await Promise.all([
                api.get("/requests"),
                api.get("/preorders"),
            ]);
            const newReqs = r.data || [];
            const newPos = o.data || [];

            // Detect items that the socket missed while we were idle so we
            // can still fire toast+sound+OS-notification for them.
            if (!firstLoadRef.current) {
                const reqIds = knownIdsRef.current.requests;
                const poIds = knownIdsRef.current.preorders;
                const arrivedReqs = newReqs.filter((x) => !reqIds.has(x.id));
                const arrivedPos = newPos.filter((x) => !poIds.has(x.id));
                arrivedReqs.forEach((req) => {
                    if (req.status !== "requested") return; // only fresh ones
                    playEventSound("new_request");
                    toast.info(`New request: ${req.category_name}`, {
                        description: req.room_name,
                        duration: 30000,
                    });
                    notifyBackground({
                        title: `New request: ${req.category_name}`,
                        body: req.room_name,
                        tag: `req-${req.id}`,
                    });
                });
                arrivedPos.forEach((po) => {
                    if (po.status !== "pending") return;
                    const itemCount = (po.items || []).reduce((a, b) => a + (b.qty || 1), 0);
                    playEventSound("new_order");
                    toast.info(`New food order: ${itemCount} item${itemCount === 1 ? "" : "s"}`, {
                        description: `${po.room_name} · ₹${po.total}`,
                        duration: 30000,
                    });
                    notifyBackground({
                        title: `New food order — ${po.room_name}`,
                        body: `${itemCount} item${itemCount === 1 ? "" : "s"} · ₹${po.total}`,
                        tag: `pre-${po.id}`,
                    });
                });
            }
            knownIdsRef.current.requests = new Set(newReqs.map((x) => x.id));
            knownIdsRef.current.preorders = new Set(newPos.map((x) => x.id));
            firstLoadRef.current = false;

            setRequests(newReqs);
            setPreorders(newPos);
        } catch {}
    };

    useEffect(() => {
        // Wait for LocationProvider to finish hydration before the first fetch.
        if (locLoading) return;
        // Clear any stale rows from a previous location before refetching.
        setHydrated(false);
        setRequests([]);
        setPreorders([]);
        // Reset the "known IDs" memory on location switch so the first poll
        // after switching is treated as a baseline (no flood of notifications).
        firstLoadRef.current = true;
        knownIdsRef.current = { requests: new Set(), preorders: new Set() };
        load().finally(() => setHydrated(true));

        // Ask once for browser notification permission so background tabs
        // still get OS-level alerts when the browser throttles them.
        ensureNotificationPermission().catch(() => {});

        // Safety-net polling: socket pushes can be missed if the browser
        // throttles a background tab or the socket silently dies. Polling
        // every 5 seconds guarantees every staff member feels "live" — the
        // toast + sound + OS notification will fire within 5s even if the
        // socket is broken.
        const intervalId = setInterval(() => { load(); }, 5000);
        const ensureConnected = () => {
            // socket.io claims "connected" even when the underlying transport
            // is dead. Disconnect+reconnect is the only reliable cure.
            try {
                if (!socket.connected) socket.connect();
            } catch {}
        };
        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                ensureConnected();
                load();
            }
        };
        const onFocus = () => { ensureConnected(); load(); };
        const onSocketDisconnect = () => {
            // Try immediate reconnect on any disconnect.
            try { socket.connect(); } catch {}
        };
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", onFocus);
        socket.on("disconnect", onSocketDisconnect);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("focus", onFocus);
            socket.off("disconnect", onSocketDisconnect);
        };
        // eslint-disable-next-line
    }, [activeLocationId, locLoading]);

    // One-shot: load global sound mapping (per active-location for super_admin)
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
        // Defense-in-depth: even if a stale socket-room subscription leaks an
        // event from another location, the dashboard MUST NOT render it. The
        // backend already filters via `emit_scoped`, but the UI doubles up the
        // guarantee so a hot-reload or reconnect race can never cause a bleed.
        const expectedLoc = user.role === "super_admin"
            ? activeLocationId            // null = "All locations" → accept anything
            : (user.location_id || null); // staff: pinned to their own location

        const sameLocation = (entity) => {
            if (!expectedLoc) return true; // null on super_admin = All locations
            return entity && entity.location_id === expectedLoc;
        };

        // Whether the currently-logged-in user should see notifications for a
        // given entity (request OR preorder). The rules the user asked for:
        //   - super_admin: sees ALL events across every department.
        //   - admin: sees ALL events within their location (admin role implies
        //     full visibility; this is intentional and confirmed by the user).
        //   - Other roles: must explicitly belong to one of the entity's target
        //     departments — i.e. `entity.department_id === user.department_id`
        //     OR `entity.department_ids` contains `user.department_id`. Both
        //     sides MUST be truthy (no null===null false-positive).
        const isMyDepartment = (entity) => {
            if (user.role === "super_admin" || user.role === "admin") return true;
            const myDept = user.department_id;
            if (!myDept) return false; // staff without a dept can't be routed to
            if (entity.department_id && entity.department_id === myDept) return true;
            if (Array.isArray(entity.department_ids) && entity.department_ids.includes(myDept)) return true;
            return false;
        };

        const onNew = (req) => {
            if (!sameLocation(req)) return;
            if (!isMyDepartment(req)) return;
            // Already notified via polling? Skip the duplicate toast/sound.
            if (knownIdsRef.current.requests.has(req.id)) {
                setRequests((prev) => [req, ...prev.filter((r) => r.id !== req.id)]);
                return;
            }
            knownIdsRef.current.requests.add(req.id);
            setRequests((prev) => [req, ...prev.filter((r) => r.id !== req.id)]);
            playEventSound("new_request");
            toast.info(`New request: ${req.category_name}`, {
                description: req.room_name,
                duration: 30000,
            });
            notifyBackground({
                title: `New request: ${req.category_name}`,
                body: req.room_name,
                tag: `req-${req.id}`,
            });
        };
        const onUpd = (req) => {
            if (!sameLocation(req)) return;
            if (!isMyDepartment(req)) return;
            setRequests((prev) => prev.map((r) => (r.id === req.id ? req : r)));
        };
        const onPreNew = (po) => {
            if (!sameLocation(po)) return;
            if (!isMyDepartment(po)) return;
            if (knownIdsRef.current.preorders.has(po.id)) {
                setPreorders((prev) => [po, ...prev.filter((p) => p.id !== po.id)]);
                return;
            }
            knownIdsRef.current.preorders.add(po.id);
            setPreorders((prev) => [po, ...prev.filter((p) => p.id !== po.id)]);
            playEventSound("new_order");
            const itemCount = (po.items || []).reduce((a, b) => a + (b.qty || 1), 0);
            toast.info(`New food order: ${itemCount} item${itemCount === 1 ? "" : "s"}`, {
                description: `${po.room_name} · ₹${po.total}`,
                duration: 30000,
            });
            notifyBackground({
                title: `New food order — ${po.room_name}`,
                body: `${itemCount} item${itemCount === 1 ? "" : "s"} · ₹${po.total}`,
                tag: `pre-${po.id}`,
            });
        };
        const onPreUpd = (po) => {
            if (!sameLocation(po)) return;
            if (!isMyDepartment(po)) return;
            setPreorders((prev) => prev.map((p) => (p.id === po.id ? po : p)));
        };

        socket.on("request:new", onNew);
        socket.on("request:update", onUpd);
        socket.on("preorder:new", onPreNew);
        socket.on("preorder:update", onPreUpd);
        return () => {
            socket.off("request:new", onNew);
            socket.off("request:update", onUpd);
            socket.off("preorder:new", onPreNew);
            socket.off("preorder:update", onPreUpd);
        };
    }, [user, activeLocationId]);

    // Unified list: tag each entity with `type` and sort by created_at desc
    const unified = useMemo(() => {
        const reqs = requests.map((r) => ({ ...r, _type: "request" }));
        const visiblePreorders = (user.role === "super_admin" || user.role === "admin" || user.role === "cafeteria")
            ? preorders : [];
        const pos = visiblePreorders.map((p) => ({ ...p, _type: "preorder" }));
        return [...reqs, ...pos].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    }, [requests, preorders, user]);

    const filtered = useMemo(() => {
        return unified.filter((entity) => {
            if (entity._type === "request") {
                if (filter === "active") return ["requested", "accepted", "in_progress"].includes(entity.status);
                if (filter === "delivered") return entity.status === "delivered";
                if (filter === "closed") return entity.status === "closed";
                return true;
            }
            // preorder — full pipeline: pending → accepted → preparing → delivered
            if (filter === "active") return ["pending", "accepted", "preparing", "out_for_delivery"].includes(entity.status);
            if (filter === "delivered") return entity.status === "delivered";
            if (filter === "closed") return entity.status === "cancelled";
            return true;
        });
    }, [unified, filter]);

    const stats = useMemo(() => {
        const s = { pending: 0, in_progress: 0, delivered: 0, escalated: 0 };
        requests.forEach((r) => {
            if (r.status === "requested" || r.status === "accepted") s.pending += 1;
            if (r.status === "in_progress") s.in_progress += 1;
            if (r.status === "delivered") s.delivered += 1;
            if (elapsedSec(r.created_at) > (r.escalation_minutes || 15) * 60 && r.status !== "closed" && r.status !== "delivered") {
                s.escalated += 1;
            }
        });
        preorders.forEach((p) => {
            if (p.status === "pending" || p.status === "accepted") s.pending += 1;
            if (p.status === "preparing" || p.status === "out_for_delivery") s.in_progress += 1;
            if (p.status === "delivered") s.delivered += 1;
        });
        return s;
    }, [requests, preorders, tick]);

    const transition = async (req, next, soundKey) => {
        try {
            const { data } = await api.patch(`/requests/${req.id}/status`, { status: next });
            setRequests((prev) => prev.map((r) => (r.id === req.id ? data : r)));
            if (soundKey) playEventSound(soundKey);
            toast.success(`Marked as ${next.replace("_", " ")}`);
        } catch (e) {
            toast.error("Failed to update");
        }
    };

    const transitionPreorder = async (po, next, soundKey) => {
        try {
            const { data } = await api.patch(`/preorders/${po.id}/status`, { status: next });
            setPreorders((prev) => prev.map((p) => (p.id === po.id ? data : p)));
            if (soundKey) playEventSound(soundKey);
            toast.success(`Order ${next.replace("_", " ")}`);
        } catch (e) {
            toast.error("Failed to update");
        }
    };

    return (
        <AppShell
            title="Live Request Queue"
            subtitle={user?.role === "super_admin" || user?.role === "admin" ? "All departments" : `${user?.role?.replace("_", " ")} desk`}
            actions={
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot" />
                        <span className="text-xs font-medium text-emerald-700">Live</span>
                    </div>
                </div>
            }
        >
            <div className="p-6 space-y-6">
                <NotificationsBanner />
                {/* Stat row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label="Pending" value={stats.pending} accent="amber" />
                    <StatCard label="In Progress" value={stats.in_progress} accent="violet" />
                    <StatCard label="Delivered Today" value={stats.delivered} accent="emerald" />
                    <StatCard label="At Risk / Escalated" value={stats.escalated} accent="red" />
                </div>

                {/* Filter tabs */}
                <Tabs value={filter} onValueChange={setFilter}>
                    <TabsList className="bg-white border border-gray-200 p-1">
                        <TabsTrigger value="active" data-testid="filter-active-tab">Active</TabsTrigger>
                        <TabsTrigger value="delivered" data-testid="filter-delivered-tab">Delivered</TabsTrigger>
                        <TabsTrigger value="closed" data-testid="filter-closed-tab">Closed</TabsTrigger>
                        <TabsTrigger value="all" data-testid="filter-all-tab">All</TabsTrigger>
                    </TabsList>
                </Tabs>

                {/* Request list */}
                <div className="space-y-3" data-testid="request-list">
                    {!hydrated && (
                        <Card className="p-12 border-dashed border-gray-200 bg-white text-center" data-testid="queue-loading">
                            <div className="text-gray-400 text-sm">Loading queue…</div>
                        </Card>
                    )}
                    {hydrated && filtered.length === 0 && (
                        <Card className="p-12 border-dashed border-gray-200 bg-white text-center">
                            <div className="text-gray-400 text-sm">No requests in this view.</div>
                        </Card>
                    )}

                    {hydrated && filtered.map((entity) => {
                        if (entity._type === "preorder") {
                            return (
                                <PreorderCard
                                    key={`po-${entity.id}`}
                                    po={entity}
                                    onAdvance={transitionPreorder}
                                />
                            );
                        }
                        const req = entity;
                        const sec = elapsedSec(req.created_at);
                        const esc = req.escalation_minutes || 15;
                        const isEscalated = sec > esc * 60 && !["delivered", "closed"].includes(req.status);
                        const action = NEXT_ACTION[req.status];

                        return (
                            <Card
                                key={req.id}
                                className="border-gray-200 bg-white p-5 transition-all hover:shadow-md"
                                data-testid={`request-card-${req.id}`}
                            >
                                <div className="flex items-start gap-4">
                                    <div
                                        className="w-12 h-12 rounded-lg grid place-items-center shrink-0"
                                        style={{ backgroundColor: `${req.category_color}15` }}
                                    >
                                        <PhosphorIcon name={req.category_icon} size={26} weight="duotone" color={req.category_color} />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <span className="font-display font-semibold text-gray-900">{req.category_name}</span>
                                            <span className="text-gray-300">·</span>
                                            <span className="text-sm text-gray-600">{req.room_name}</span>
                                            {req.priority === "urgent" && (
                                                <Badge className="bg-red-50 text-red-700 border border-red-200 hover:bg-red-50">URGENT</Badge>
                                            )}
                                            {req.priority === "high" && (
                                                <Badge className="bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-50">HIGH</Badge>
                                            )}
                                            <StatusBadge status={req.status} />
                                            {isEscalated && (
                                                <Badge className="bg-red-50 text-red-700 border border-red-200 hover:bg-red-50">
                                                    <Warning size={12} className="mr-1" /> ESCALATED
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                                            <span className="inline-flex items-center gap-1">
                                                <Clock size={12} />
                                                <span className={`font-mono font-medium ${timerColor(sec, esc)}`}>{formatElapsed(sec)}</span>
                                            </span>
                                            {req.assignee_name && (
                                                <span>Assignee: <span className="text-gray-700 font-medium">{req.assignee_name}</span></span>
                                            )}
                                            {req.note && (
                                                <span className="inline-flex items-center gap-1">
                                                    <ChatCircle size={12} /> {req.note}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {action && (
                                            <Button
                                                size="sm"
                                                onClick={() => transition(req, action.next, action.sound)}
                                                className={`${action.color} text-white h-9`}
                                                data-testid={`request-${req.id}-action-btn`}
                                            >
                                                <action.icon size={16} className="mr-1.5" /> {action.label}
                                            </Button>
                                        )}
                                        {req.status !== "closed" && req.status !== "delivered" && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => transition(req, "escalated")}
                                                className="h-9 text-red-700 border-red-200 hover:bg-red-50"
                                                data-testid={`request-${req.id}-escalate-btn`}
                                            >
                                                <Warning size={14} />
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                {/* Pipeline progress */}
                                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-1.5">
                                    {STATUS_PIPELINE.map((step, i) => {
                                        const reachedIdx = STATUS_PIPELINE.findIndex((s) => s.key === req.status);
                                        const done = i <= reachedIdx;
                                        return (
                                            <React.Fragment key={step.key}>
                                                <div className={`flex items-center gap-1.5 ${done ? "text-gray-900" : "text-gray-400"}`}>
                                                    <div className={`w-2 h-2 rounded-full ${done ? "bg-[#0055FF]" : "bg-gray-200"}`} />
                                                    <span className="text-[11px] uppercase tracking-wider font-semibold">{step.label}</span>
                                                </div>
                                                {i < STATUS_PIPELINE.length - 1 && (
                                                    <div className={`flex-1 h-px ${done ? "bg-[#0055FF]" : "bg-gray-200"}`} />
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </div>
        </AppShell>
    );
}

function StatCard({ label, value, accent }) {
    const colors = {
        amber: "text-amber-600",
        violet: "text-violet-600",
        emerald: "text-emerald-600",
        red: "text-red-600",
    };
    return (
        <Card className="bg-white border-gray-200 p-5">
            <div className="label-eyebrow text-gray-500">{label}</div>
            <div className={`font-display text-3xl font-bold mt-2 ${colors[accent]}`}>{value}</div>
        </Card>
    );
}

function StatusBadge({ status }) {
    const map = {
        requested: ["bg-amber-50 text-amber-700 border-amber-200", "Pending"],
        accepted: ["bg-blue-50 text-blue-700 border-blue-200", "Accepted"],
        in_progress: ["bg-violet-50 text-violet-700 border-violet-200", "In Progress"],
        delivered: ["bg-emerald-50 text-emerald-700 border-emerald-200", "Ready"],
        closed: ["bg-gray-100 text-gray-600 border-gray-200", "Closed"],
        escalated: ["bg-red-50 text-red-700 border-red-200", "Escalated"],
        pending: ["bg-amber-50 text-amber-700 border-amber-200", "Pending"],
        preparing: ["bg-violet-50 text-violet-700 border-violet-200", "Preparing"],
        cancelled: ["bg-gray-100 text-gray-600 border-gray-200", "Cancelled"],
    };
    const [klass, label] = map[status] || map.requested;
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${klass}`}>
            {label}
        </span>
    );
}

function PreorderCard({ po, onAdvance }) {
    const action = PREORDER_NEXT_ACTION[po.status];
    const sec = elapsedSec(po.created_at);
    const itemCount = (po.items || []).reduce((a, b) => a + (b.qty || 1), 0);
    return (
        <Card
            className="border-amber-200 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/10 p-5 transition-all hover:shadow-md"
            data-testid={`preorder-card-${po.id}`}
        >
            <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg grid place-items-center shrink-0 bg-amber-100 dark:bg-amber-900/40">
                    <ForkKnife size={26} weight="duotone" color="#B45309" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-display font-semibold text-gray-900 dark:text-gray-100">Food Order</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">{po.room_name}</span>
                        <Badge className="bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100">
                            <ShoppingCart size={11} className="mr-1" /> {itemCount} item{itemCount === 1 ? "" : "s"}
                        </Badge>
                        <Badge className="bg-white text-gray-700 border border-gray-200 hover:bg-white font-mono">
                            ₹ {po.total?.toFixed?.(0) ?? po.total}
                        </Badge>
                        <StatusBadge status={po.status} />
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                            <Clock size={12} />
                            <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{formatElapsed(sec)}</span>
                        </span>
                        <span className="truncate">
                            {(po.items || []).map((it) => `${it.qty}× ${it.name}`).join(" · ")}
                        </span>
                    </div>
                </div>
                {action && (
                    <Button
                        size="sm"
                        onClick={() => onAdvance(po, action.next, action.sound)}
                        className={`${action.color} text-white h-9`}
                        data-testid={`preorder-${po.id}-action-btn`}
                    >
                        <action.icon size={16} className="mr-1.5" /> {action.label}
                    </Button>
                )}
            </div>

            {/* Preorder pipeline */}
            <div className="mt-4 pt-4 border-t border-amber-200/60 dark:border-amber-900/30 flex items-center gap-1.5">
                {PREORDER_PIPELINE.map((step, i) => {
                    const reachedIdx = PREORDER_PIPELINE.findIndex((s) => s.key === po.status);
                    const done = i <= reachedIdx;
                    return (
                        <React.Fragment key={step.key}>
                            <div className={`flex items-center gap-1.5 ${done ? "text-gray-900 dark:text-gray-200" : "text-gray-400"}`}>
                                <div className={`w-2 h-2 rounded-full ${done ? "bg-amber-600" : "bg-gray-200"}`} />
                                <span className="text-[11px] uppercase tracking-wider font-semibold">{step.label}</span>
                            </div>
                            {i < PREORDER_PIPELINE.length - 1 && (
                                <div className={`flex-1 h-px ${done ? "bg-amber-600" : "bg-gray-200"}`} />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </Card>
    );
}
