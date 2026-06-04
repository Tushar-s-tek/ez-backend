import React, { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { socket } from "@/lib/socket";
import { playEventSound, setSoundConfig } from "@/lib/sound";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import VisitorBadge from "@/components/VisitorBadge";
import {
    UserPlus, CheckCircle, BellRinging, SignOut as SignOutIcon, EnvelopeSimple,
    Printer, IdentificationCard, Copy, X, Camera, User,
} from "@phosphor-icons/react";
import { toast } from "sonner";

const STATUS_LABEL = {
    expected: { c: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-900", label: "Expected" },
    waiting: { c: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900", label: "Waiting" },
    notified: { c: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900", label: "Host notified" },
    checked_in: { c: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900", label: "Checked in" },
    checked_out: { c: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-900/40 dark:text-gray-400 dark:border-gray-800", label: "Checked out" },
    blocked: { c: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900", label: "Blocked" },
};

const EMPTY_FORM = { name: "", company: "", purpose: "", host_room_id: "", phone: "", expected_at: "" };

export default function AdminVisitors() {
    const { activeLocationId } = useLocation() || {};
    const [visitors, setVisitors] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [filter, setFilter] = useState("all");
    const [show, setShow] = useState(false);
    const [mode, setMode] = useState("walk_in"); // walk_in | pre_register
    const [form, setForm] = useState(EMPTY_FORM);
    const [registered, setRegistered] = useState(null); // newly pre-registered visitor (PIN + QR)
    const [badgeVisitor, setBadgeVisitor] = useState(null);

    const load = async () => {
        const [v, r] = await Promise.all([api.get("/visitors"), api.get("/rooms")]);
        setVisitors(v.data); setRooms(r.data);
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
        const onNew = (v) => {
            setVisitors((p) => [v, ...p.filter((x) => x.id !== v.id)]);
            if (v.status !== "expected") {
                playEventSound("visitor");
                toast.info(`Visitor: ${v.name}`, { description: `${v.host_room_name} · ${STATUS_LABEL[v.status]?.label || v.status}` });
            }
        };
        const onUpd = (v) => setVisitors((p) => p.map((x) => (x.id === v.id ? v : x)));
        socket.on("visitor:new", onNew);
        socket.on("visitor:update", onUpd);
        return () => { socket.off("visitor:new", onNew); socket.off("visitor:update", onUpd); };
    }, []);

    const create = async () => {
        if (!form.name || !form.host_room_id) return toast.error("Name and host room are required");
        try {
            if (mode === "pre_register") {
                const { data } = await api.post("/visitors/pre-register", form);
                setRegistered(data);
                toast.success("Visitor pre-registered");
                await load();
            } else {
                await api.post("/visitors", form);
                toast.success("Visitor logged");
                setShow(false);
                setForm(EMPTY_FORM);
            }
        } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    };

    const setStatus = async (id, status) => {
        try { await api.patch(`/visitors/${id}/status`, { status }); }
        catch { toast.error("Failed"); }
    };

    const openBadge = async (v) => {
        try {
            const { data } = await api.get(`/visitors/badge/${v.id}`);
            setBadgeVisitor(data);
        } catch { toast.error("Failed to load badge"); }
    };

    const copy = async (txt) => {
        // navigator.clipboard requires a secure context (HTTPS) AND the document
        // to be focused — both of which break in iframes (e.g. preview), some
        // browsers in non-secure contexts, or after toast focus shifts. Fall
        // back to a hidden <textarea> + execCommand("copy") so the button
        // works reliably across every browser/setup.
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(txt);
                toast.success("Copied");
                return;
            }
            throw new Error("clipboard api unavailable");
        } catch {
            try {
                const ta = document.createElement("textarea");
                ta.value = txt;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                ta.style.left = "-9999px";
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand("copy");
                document.body.removeChild(ta);
                if (ok) toast.success("Copied");
                else toast.error("Couldn't copy — please long-press the link and copy it manually.");
            } catch {
                toast.error("Couldn't copy — please long-press the link and copy it manually.");
            }
        }
    };

    const checkinUrl = (v) => `${window.location.origin}/visitors/checkin?pin=${v.pin}`;

    const filteredVisitors = useMemo(() => {
        if (filter === "all") return visitors;
        if (filter === "active") return visitors.filter((v) => ["expected", "waiting", "notified", "checked_in"].includes(v.status));
        return visitors.filter((v) => v.status === filter);
    }, [visitors, filter]);

    return (
        <AppShell
            title="Visitor Management"
            subtitle="Reception desk"
            actions={
                <Button
                    onClick={() => { setMode("walk_in"); setForm(EMPTY_FORM); setRegistered(null); setShow(true); }}
                    className="bg-[#0055FF] hover:bg-[#0044CC] text-white"
                    data-testid="visitors-create-btn"
                >
                    <UserPlus size={16} className="mr-1" /> Check-in Visitor
                </Button>
            }
        >
            <div className="p-6 space-y-4">
                {/* Filter tabs + secondary action */}
                <div className="flex items-center gap-2 flex-wrap">
                    {[
                        { k: "all", label: "All" },
                        { k: "active", label: "Active" },
                        { k: "expected", label: "Expected" },
                        { k: "checked_in", label: "Checked in" },
                        { k: "checked_out", label: "Checked out" },
                    ].map((t) => (
                        <button
                            key={t.k}
                            onClick={() => setFilter(t.k)}
                            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                                filter === t.k
                                    ? "bg-[#0055FF] text-white border-[#0055FF]"
                                    : "bg-white dark:bg-[#0B0D10] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:border-[#0055FF]"
                            }`}
                            data-testid={`visitor-filter-${t.k}`}
                        >
                            {t.label}
                        </button>
                    ))}
                    <Button
                        variant="outline"
                        onClick={() => { setMode("pre_register"); setForm(EMPTY_FORM); setRegistered(null); setShow(true); }}
                        className="ml-auto"
                        data-testid="visitors-preregister-btn"
                    >
                        <EnvelopeSimple size={14} className="mr-1" /> Pre-register visitor
                    </Button>
                </div>

                <div className="space-y-3" data-testid="visitor-list">
                    {filteredVisitors.length === 0 && (
                        <Card className="p-12 border-dashed border-2 border-gray-200 dark:border-gray-800 bg-transparent text-center text-gray-400">No visitors here.</Card>
                    )}
                    {filteredVisitors.map((v) => {
                        const st = STATUS_LABEL[v.status] || STATUS_LABEL.waiting;
                        return (
                            <Card
                                key={v.id}
                                className="bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800 p-5 flex items-center gap-4"
                                data-testid={`visitor-card-${v.id}`}
                            >
                                <div className="w-12 h-12 rounded-full grid place-items-center bg-blue-50 dark:bg-blue-950/40 text-[#0055FF] font-display font-semibold shrink-0 overflow-hidden">
                                    {v.has_photo ? <User size={22} weight="fill" /> : v.name[0]?.toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-display font-semibold text-gray-900 dark:text-gray-100">{v.name}</span>
                                        {v.company && <span className="text-sm text-gray-500">· {v.company}</span>}
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${st.c}`}>
                                            {st.label}
                                        </span>
                                        {v.kind === "pre_registered" && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900">
                                                Pre-registered
                                            </span>
                                        )}
                                        {v.nda_signed_at && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                                                NDA ✓
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        Host: <span className="text-gray-700 dark:text-gray-300 font-medium">{v.host_room_name}</span>
                                        {v.purpose && <> · {v.purpose}</>}
                                        {v.phone && <> · {v.phone}</>}
                                        {v.pin && <> · PIN <span className="font-mono">{v.pin}</span></>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {v.kind === "pre_registered" && v.status === "expected" && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => copy(checkinUrl(v))}
                                            data-testid={`visitor-${v.id}-copy-link-btn`}
                                            title="Copy check-in link"
                                        >
                                            <Copy size={14} className="mr-1" /> Link
                                        </Button>
                                    )}
                                    {v.status === "waiting" && (
                                        <Button size="sm" onClick={() => setStatus(v.id, "notified")} className="bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid={`visitor-${v.id}-notify-btn`}>
                                            <BellRinging size={14} className="mr-1" /> Notify host
                                        </Button>
                                    )}
                                    {v.status !== "checked_in" && v.status !== "checked_out" && v.status !== "blocked" && (
                                        <Button size="sm" variant="outline" onClick={() => setStatus(v.id, "checked_in")} data-testid={`visitor-${v.id}-checkin-btn`}>
                                            <CheckCircle size={14} className="mr-1" /> Check-in
                                        </Button>
                                    )}
                                    {(v.status === "checked_in" || v.has_photo) && (
                                        <Button size="sm" variant="outline" onClick={() => openBadge(v)} data-testid={`visitor-${v.id}-badge-btn`}>
                                            <IdentificationCard size={14} className="mr-1" /> Badge
                                        </Button>
                                    )}
                                    {v.status !== "checked_out" && v.status !== "blocked" && (
                                        <Button size="sm" variant="ghost" onClick={() => setStatus(v.id, "checked_out")} className="text-gray-500" data-testid={`visitor-${v.id}-checkout-btn`}>
                                            <SignOutIcon size={14} />
                                        </Button>
                                    )}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {/* Create/Pre-register dialog */}
            <Dialog open={show} onOpenChange={(o) => { setShow(o); if (!o) { setRegistered(null); setForm(EMPTY_FORM); } }}>
                <DialogContent className="max-w-md">
                    {!registered ? (
                        <>
                            <DialogHeader>
                                <DialogTitle>
                                    {mode === "pre_register" ? "Pre-register a visitor" : "Walk-in check-in"}
                                </DialogTitle>
                            </DialogHeader>
                            <div className="flex border border-gray-200 dark:border-gray-800 rounded-md overflow-hidden text-xs mb-3">
                                <button onClick={() => setMode("walk_in")} className={`flex-1 px-3 py-1.5 ${mode === "walk_in" ? "bg-[#0055FF] text-white" : "text-gray-600 dark:text-gray-400"}`} data-testid="visitor-mode-walkin">Walk-in</button>
                                <button onClick={() => setMode("pre_register")} className={`flex-1 px-3 py-1.5 ${mode === "pre_register" ? "bg-[#0055FF] text-white" : "text-gray-600 dark:text-gray-400"}`} data-testid="visitor-mode-prereg">Pre-register</button>
                            </div>
                            <div className="space-y-3">
                                <div><Label>Visitor name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="visitor-name-input" autoFocus /></div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><Label>Company</Label><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
                                    <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                                </div>
                                <div><Label>Purpose</Label><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
                                <div>
                                    <Label>Host (room)</Label>
                                    <Select value={form.host_room_id} onValueChange={(v) => setForm({ ...form, host_room_id: v })}>
                                        <SelectTrigger data-testid="visitor-host-select"><SelectValue placeholder="Pick room" /></SelectTrigger>
                                        <SelectContent>{rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                {mode === "pre_register" && (
                                    <div>
                                        <Label>Expected arrival (optional)</Label>
                                        <Input
                                            type="datetime-local"
                                            value={form.expected_at}
                                            onChange={(e) => setForm({ ...form, expected_at: e.target.value })}
                                            data-testid="visitor-expected-input"
                                        />
                                    </div>
                                )}
                                <Button onClick={create} className="w-full bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="visitor-submit-btn">
                                    {mode === "pre_register" ? "Pre-register & get invite" : "Log visitor"}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <CheckCircle size={20} weight="fill" className="text-emerald-600" /> Visitor invited
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 text-sm">
                                <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/30 p-4">
                                    <div className="label-eyebrow text-indigo-700 dark:text-indigo-300 mb-1">Send this to {registered.name}</div>
                                    <div className="font-mono text-2xl font-bold text-indigo-900 dark:text-indigo-200 tracking-[0.3em]" data-testid="visitor-pin-display">{registered.pin}</div>
                                </div>
                                <div className="flex flex-col items-center gap-3">
                                    <img
                                        src={registered.checkin_qr}
                                        alt="check-in QR"
                                        className="w-56 h-56 rounded-lg border border-gray-200 dark:border-gray-800 bg-white p-2"
                                        data-testid="visitor-qr-display"
                                    />
                                    <div className="text-xs space-y-1 w-full">
                                        <div className="text-gray-500 text-center">Check-in link</div>
                                        <div
                                            className="text-gray-900 dark:text-gray-100 text-center break-all px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-[11px] font-mono"
                                            data-testid="visitor-checkin-url"
                                        >{checkinUrl(registered)}</div>
                                        <div className="flex justify-center pt-1">
                                            <Button size="sm" variant="outline" onClick={() => copy(checkinUrl(registered))} data-testid="visitor-copy-link-btn">
                                                <Copy size={14} className="mr-1" /> Copy link
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                <Button onClick={() => { setShow(false); setRegistered(null); setForm(EMPTY_FORM); }} className="w-full" data-testid="visitor-done-prereg-btn">Done</Button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Badge view + print */}
            <Dialog open={!!badgeVisitor} onOpenChange={(o) => { if (!o) setBadgeVisitor(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader><DialogTitle>Visitor badge</DialogTitle></DialogHeader>
                    {badgeVisitor && (
                        <>
                            <div className="flex justify-center"><VisitorBadge visitor={badgeVisitor} /></div>
                            <Button onClick={() => window.print()} className="w-full mt-4 bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="visitor-badge-print-btn">
                                <Printer size={16} className="mr-1" /> Print
                            </Button>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </AppShell>
    );
}
