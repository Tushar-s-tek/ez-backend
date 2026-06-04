import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle, X, ArrowLeft, Clock, House, ForkKnife, Lightbulb } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { PhosphorIcon } from "@/components/PhosphorIcon";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import BrandLogo from "@/components/BrandLogo";
import { useI18n } from "@/lib/i18n";
import { socket } from "@/lib/socket";
import { playEventSound, primeAudio, setSoundConfig } from "@/lib/sound";

export default function RoomKiosk() {
    const { pin } = useParams();
    const navigate = useNavigate();
    const { t } = useI18n();
    const [room, setRoom] = useState(null);
    const [categories, setCategories] = useState([]);
    const [activeGroup, setActiveGroup] = useState(null);
    const [now, setNow] = useState(new Date());
    const [confirmCat, setConfirmCat] = useState(null);
    const [busy, setBusy] = useState(false);
    const [recent, setRecent] = useState([]);
    const [activePreorders, setActivePreorders] = useState([]);
    const [readyAlert, setReadyAlert] = useState(null); // { title, sub, color, icon }

    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(t);
    }, []);

    // Load global sound config so the kiosk plays the super-admin-configured tones
    useEffect(() => {
        if (!room) return;
        (async () => {
            try {
                const { data } = await api.get("/settings/sounds", { params: { location_id: room.location_id } });
                const map = Object.fromEntries(
                    Object.entries(data || {}).filter(([_, v]) => v).map(([k, v]) => [k.replace(/^sound_/, ""), v])
                );
                if (Object.keys(map).length) setSoundConfig(map);
            } catch {}
        })();
    }, [room]);

    useEffect(() => {
        (async () => {
            if (!pin) {
                navigate("/");
                return;
            }
            try {
                const { data } = await api.post("/rooms/access", { pin });
                setRoom(data);
                // Join this location's socket room so we only receive scoped events
                const join = () => socket.emit("join_location", { location_id: data.location_id, super: false });
                join();
                socket.on("connect", join);
            } catch (e) {
                toast.error("Invalid room PIN");
                navigate("/");
            }
        })();
    }, [pin, navigate]);

    useEffect(() => {
        if (!room) return;
        (async () => {
            try {
                const { data } = await api.get("/categories", {
                    params: { active_only: true, location_id: room.location_id },
                });
                setCategories(data);
                const groups = Array.from(new Set(data.map((c) => c.group)));
                if (groups.length) setActiveGroup(groups[0]);
            } catch {}
        })();
    }, [room]);

    // Build a transition detector + persistent banner.
    // - Polls /requests-public and /preorders-public every 4s (resilient if socket drops).
    // - Also listens to socket events for instant updates.
    // - On any status transition (e.g., "preparing" → "delivered"), plays the configured sound
    //   AND shows a big banner that stays until the user dismisses it.
    useEffect(() => {
        if (!room) return;

        // Aggressively prime audio: on ANY interaction inside the kiosk
        const prime = () => primeAudio();
        const events = ["click", "touchstart", "touchend", "keydown", "pointerdown"];
        events.forEach((ev) => window.addEventListener(ev, prime, { passive: true }));

        // Prior-status maps (used to detect transitions across polls + socket events)
        const prevReqStatus = new Map();
        const prevPoStatus  = new Map();

        const FRIENDLY = {
            accepted:    { sound: "accepted", msg: "is being attended to", color: "#0055FF" },
            in_progress: { sound: "started",  msg: "is in progress",       color: "#7C3AED" },
            preparing:   { sound: "started",  msg: "is being prepared",    color: "#7C3AED" },
            delivered:   { sound: "ready",    msg: "is READY",             color: "#16A34A" },
            escalated:   { sound: "escalated",msg: "has been escalated",   color: "#DC2626" },
        };

        const handleReqTransition = (r) => {
            const prev = prevReqStatus.get(r.id);
            if (prev !== undefined && prev !== r.status) {
                const f = FRIENDLY[r.status];
                if (f) {
                    playEventSound(f.sound);
                    setReadyAlert({
                        kind: "request",
                        title: `${r.category_name} ${f.msg}`,
                        sub: `${room.name} · ${r.status.replace("_", " ").toUpperCase()}`,
                        color: f.color,
                    });
                }
            }
            prevReqStatus.set(r.id, r.status);
        };

        const handlePoTransition = (p) => {
            const prev = prevPoStatus.get(p.id);
            if (prev !== undefined && prev !== p.status) {
                const f = FRIENDLY[p.status];
                if (f) {
                    playEventSound(f.sound);
                    const itemTxt = (p.items || []).map((i) => `${i.qty || 1}× ${i.name}`).join(", ");
                    setReadyAlert({
                        kind: "preorder",
                        title: `Your food order ${f.msg}`,
                        sub: itemTxt || `₹${p.total}`,
                        color: f.color,
                    });
                }
            }
            prevPoStatus.set(p.id, p.status);
        };

        // Initial load + polling — also seeds the prior-status maps without firing
        let polling = true;
        const loadAll = async (firstTime = false) => {
            try {
                const [r, p] = await Promise.all([
                    api.get(`/requests-public/${room.id}`, { params: { limit: 12 } }),
                    api.get(`/preorders-public/${room.id}`, { params: { limit: 12 } }),
                ]);
                setRecent(r.data);
                setActivePreorders(p.data);

                if (firstTime) {
                    r.data.forEach((x) => prevReqStatus.set(x.id, x.status));
                    p.data.forEach((x) => prevPoStatus.set(x.id, x.status));
                } else {
                    r.data.forEach(handleReqTransition);
                    p.data.forEach(handlePoTransition);
                }
            } catch {}
        };
        loadAll(true);
        const poll = setInterval(() => { if (polling) loadAll(false); }, 4000);

        // Socket listeners (instant updates when connected)
        const onReqNew = (r) => {
            if (r.room_id !== room.id) return;
            // Seed initial status — DON'T fire a transition (the user just placed it)
            prevReqStatus.set(r.id, r.status);
            setRecent((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
        };
        const onPoNew = (p) => {
            if (p.room_id !== room.id) return;
            prevPoStatus.set(p.id, p.status);
            setActivePreorders((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
        };
        const onReqUpd = (r) => {
            if (r.room_id !== room.id) return;
            setRecent((prev) => prev.map((x) => (x.id === r.id ? r : x)));
            handleReqTransition(r);
        };
        const onPoUpd = (p) => {
            if (p.room_id !== room.id) return;
            setActivePreorders((prev) => prev.map((x) => (x.id === p.id ? p : x)));
            handlePoTransition(p);
        };
        // Reconnect → resync (don't fire transition for already-known items, just refetch)
        const onReconnect = () => { loadAll(false); };

        socket.on("request:new", onReqNew);
        socket.on("request:update", onReqUpd);
        socket.on("preorder:new", onPoNew);
        socket.on("preorder:update", onPoUpd);
        socket.on("connect", onReconnect);

        return () => {
            polling = false;
            clearInterval(poll);
            socket.off("request:new", onReqNew);
            socket.off("request:update", onReqUpd);
            socket.off("preorder:new", onPoNew);
            socket.off("preorder:update", onPoUpd);
            socket.off("connect", onReconnect);
            events.forEach((ev) => window.removeEventListener(ev, prime));
        };
    }, [room]);

    const groups = useMemo(() => Array.from(new Set(categories.map((c) => c.group))), [categories]);
    const grouped = useMemo(() => categories.filter((c) => c.group === activeGroup), [categories, activeGroup]);

    const submitRequest = async () => {
        if (!confirmCat || !room) return;
        setBusy(true);
        try {
            await api.post("/requests", { room_id: room.id, category_id: confirmCat.id, pin, note: "" });
            playEventSound("new_request");
            toast.success(`${confirmCat.name} request sent`);
            setConfirmCat(null);
            // refresh recent
            const { data } = await api.get(`/requests-public/${room.id}`, { params: { limit: 8 } });
            setRecent(data);
        } catch (e) {
            toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed");
        } finally {
            setBusy(false);
        }
    };

    if (!room) {
        return <div className="min-h-screen grid place-items-center text-gray-400">Loading room…</div>;
    }

    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dateStr = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

    return (
        <div className="min-h-screen bg-white dark:bg-[#0B0D10] flex flex-col">
            {/* Persistent READY/Status banner — only the user dismiss makes it go away */}
            {readyAlert && (
                <div
                    className="fixed inset-x-0 top-0 z-50 flex items-center justify-center px-4 pt-4"
                    data-testid="kiosk-ready-banner"
                >
                    <div
                        className="w-full max-w-3xl rounded-2xl shadow-2xl border-2 px-6 py-5 flex items-center gap-4 animate-pulse"
                        style={{
                            backgroundColor: `${readyAlert.color}15`,
                            borderColor: readyAlert.color,
                        }}
                    >
                        <div
                            className="w-14 h-14 rounded-xl grid place-items-center shrink-0"
                            style={{ backgroundColor: readyAlert.color }}
                        >
                            <CheckCircle size={32} weight="fill" color="#fff" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-display text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 truncate">
                                {readyAlert.title}
                            </div>
                            <div className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 truncate">{readyAlert.sub}</div>
                        </div>
                        <Button
                            onClick={() => { setReadyAlert(null); primeAudio(); }}
                            className="text-white shrink-0"
                            style={{ backgroundColor: readyAlert.color }}
                            data-testid="kiosk-ready-banner-dismiss"
                        >
                            Got it
                        </Button>
                    </div>
                </div>
            )}

            {/* Header */}
            <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0B0D10]">
                <div className="max-w-[1400px] mx-auto px-8 pt-5 pb-2 flex items-center justify-between">
                    <BrandLogo height={36} />
                    <div className="flex flex-col gap-1">
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </div>
                <div className="max-w-[1400px] mx-auto px-8 py-3 flex items-center justify-between">
                    <div>
                        <div className="label-eyebrow text-gray-500">Room · Floor {room.floor} · {room.location}</div>
                        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 mt-1">{room.name}</h1>
                    </div>
                    <div className="text-right">
                        <div className="font-mono text-3xl md:text-4xl font-medium text-gray-900 dark:text-gray-100 tabular-nums">{timeStr}</div>
                        <div className="text-xs text-gray-500 mt-1">{dateStr}</div>
                    </div>
                </div>
                {/* Mode switcher */}
                <div className="max-w-[1400px] mx-auto px-8 pb-4 flex gap-2">
                    <Button variant="default" className="bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="kiosk-mode-request">
                        {t("kiosk.mode_request")}
                    </Button>
                    <Button variant="outline" onClick={() => navigate(`/room/${pin}/order`)} data-testid="kiosk-mode-order">
                        <ForkKnife size={16} className="mr-1.5" /> {t("kiosk.mode_order")}
                    </Button>
                    <Button variant="outline" onClick={() => navigate(`/room/${pin}/controls`)} data-testid="kiosk-mode-controls">
                        <Lightbulb size={16} className="mr-1.5" /> {t("kiosk.mode_controls")}
                    </Button>
                </div>
            </header>

            {/* Body */}
            <main className="flex-1 max-w-[1400px] mx-auto px-8 py-8 w-full">
                <div className="flex items-end justify-between mb-6">
                    <div>
                        <div className="label-eyebrow mb-2">How can we help?</div>
                        <h2 className="font-display text-2xl md:text-3xl font-semibold text-gray-900">Tap to request</h2>
                    </div>
                    <Button
                        variant="ghost"
                        onClick={() => navigate("/")}
                        className="text-gray-500 hover:text-gray-900"
                        data-testid="kiosk-exit-btn"
                    >
                        <House size={18} className="mr-1" /> Exit
                    </Button>
                </div>

                <Tabs value={activeGroup || ""} onValueChange={setActiveGroup} className="w-full">
                    <TabsList className="bg-gray-100 p-1 rounded-lg flex flex-wrap h-auto justify-start">
                        {groups.map((g) => (
                            <TabsTrigger
                                key={g}
                                value={g}
                                className="px-4 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm"
                                data-testid={`kiosk-group-tab-${g.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                                {g}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <TabsContent value={activeGroup || ""} className="mt-6">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                            {grouped.map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => setConfirmCat(cat)}
                                    className="tile-press flex flex-col items-center justify-center gap-3 p-6 bg-white border border-gray-200 rounded-xl hover:border-[#0055FF] hover:shadow-md min-h-[170px]"
                                    style={{ boxShadow: "0 1px 0 rgba(0,0,0,0.02)" }}
                                    data-testid={`kiosk-cat-${cat.name.toLowerCase().replace(/\s+/g, "-")}-btn`}
                                >
                                    <div
                                        className="w-16 h-16 rounded-2xl grid place-items-center"
                                        style={{ backgroundColor: `${cat.color}15` }}
                                    >
                                        <PhosphorIcon name={cat.icon} size={36} weight="duotone" color={cat.color} />
                                    </div>
                                    <div className="font-display text-lg font-semibold text-gray-900 text-center">{cat.name}</div>
                                    {cat.priority === "urgent" && (
                                        <Badge className="bg-red-50 text-red-700 border border-red-200 hover:bg-red-50">URGENT</Badge>
                                    )}
                                </button>
                            ))}
                        </div>
                    </TabsContent>
                </Tabs>

                {/* Recent requests from this room */}
                {recent.length > 0 && (
                    <section className="mt-12">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-display text-lg font-semibold text-gray-900">Recent from this room</h3>
                            <span className="text-xs text-gray-500">Updates every 6s</span>
                        </div>
                        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white">
                            {recent.slice(0, 5).map((r) => (
                                <div key={r.id} className="flex items-center justify-between px-5 py-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-lg grid place-items-center" style={{ backgroundColor: `${r.category_color}15` }}>
                                            <PhosphorIcon name={r.category_icon} size={20} weight="duotone" color={r.category_color} />
                                        </div>
                                        <div>
                                            <div className="font-medium text-sm text-gray-900">{r.category_name}</div>
                                            <div className="text-xs text-gray-500 font-mono">{new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                                        </div>
                                    </div>
                                    <StatusPill status={r.status} />
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </main>

            {/* Confirmation dialog */}
            <Dialog open={!!confirmCat} onOpenChange={(o) => !o && setConfirmCat(null)}>
                <DialogContent className="max-w-md" data-testid="kiosk-confirm-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-display text-2xl">Confirm request</DialogTitle>
                    </DialogHeader>
                    {confirmCat && (
                        <div className="space-y-5">
                            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <div className="w-14 h-14 rounded-xl grid place-items-center" style={{ backgroundColor: `${confirmCat.color}15` }}>
                                    <PhosphorIcon name={confirmCat.icon} size={32} weight="duotone" color={confirmCat.color} />
                                </div>
                                <div>
                                    <div className="font-display font-semibold text-lg text-gray-900">{confirmCat.name}</div>
                                    <div className="text-sm text-gray-500">Will be routed automatically</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <Clock size={14} /> Typical response under 5 minutes
                            </div>
                            <div className="flex gap-3 pt-2">
                                <Button variant="outline" onClick={() => setConfirmCat(null)} className="flex-1 h-12" data-testid="kiosk-confirm-cancel-btn">
                                    Cancel
                                </Button>
                                <Button
                                    onClick={submitRequest}
                                    disabled={busy}
                                    className="flex-1 h-12 bg-[#0055FF] hover:bg-[#0044CC] text-white"
                                    data-testid="kiosk-confirm-submit-btn"
                                >
                                    {busy ? "Sending…" : <>Send request <CheckCircle size={18} className="ml-1" /></>}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function StatusPill({ status }) {
    const map = {
        requested: { label: "Pending", c: "bg-amber-50 text-amber-700 border-amber-200" },
        accepted: { label: "Accepted", c: "bg-blue-50 text-blue-700 border-blue-200" },
        in_progress: { label: "In Progress", c: "bg-violet-50 text-violet-700 border-violet-200" },
        delivered: { label: "Ready", c: "bg-emerald-50 text-emerald-700 border-emerald-200" },
        closed: { label: "Closed", c: "bg-gray-100 text-gray-600 border-gray-200" },
        escalated: { label: "Escalated", c: "bg-red-50 text-red-700 border-red-200" },
    };
    const v = map[status] || map.requested;
    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border ${v.c}`}>
            {v.label}
        </span>
    );
}
