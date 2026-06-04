import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash, ArrowsClockwise, QrCode, Eye } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function AdminRooms() {
    const { activeLocationId, requireLocation } = useLocation() || {};
    const [rooms, setRooms] = useState([]);
    const [showCreate, setShowCreate] = useState(false);
    const [viewRoom, setViewRoom] = useState(null);
    const [form, setForm] = useState({ name: "", floor: "1", location: "Main Office" });

    const load = async () => {
        const { data } = await api.get("/rooms");
        setRooms(data);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeLocationId]);

    const create = async () => {
        if (!form.name) return toast.error("Room name required");
        try {
            await api.post("/rooms", form);
            toast.success("Room created");
            setShowCreate(false);
            setForm({ name: "", floor: "1", location: "Main Office" });
            load();
        } catch { toast.error("Failed"); }
    };

    const regenerate = async (id) => {
        try {
            const { data } = await api.post(`/rooms/${id}/regenerate-pin`);
            toast.success("PIN regenerated");
            setRooms((p) => p.map((r) => (r.id === id ? data : r)));
            if (viewRoom?.id === id) setViewRoom(data);
        } catch { toast.error("Failed"); }
    };

    const remove = async (id) => {
        if (!window.confirm("Delete this room?")) return;
        try {
            await api.delete(`/rooms/${id}`);
            toast.success("Deleted");
            load();
        } catch { toast.error("Failed"); }
    };

    return (
        <AppShell
            title="Rooms"
            subtitle="Manage room access"
            actions={
                <>
                    <Button
                        onClick={() => requireLocation && requireLocation(() => setShowCreate(true), "a room")}
                        className="bg-[#0055FF] hover:bg-[#0044CC] text-white"
                        data-testid="rooms-create-btn"
                    >
                        <Plus size={16} className="mr-1" /> New Room
                    </Button>
                    <Dialog open={showCreate} onOpenChange={setShowCreate}>
                        <DialogContent>
                            <DialogHeader><DialogTitle>Create Room</DialogTitle></DialogHeader>
                            <div className="space-y-4">
                                <div>
                                    <Label>Name</Label>
                                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Board Room 02" data-testid="room-name-input" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <Label>Floor</Label>
                                        <Input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} data-testid="room-floor-input" />
                                    </div>
                                    <div>
                                        <Label>Location</Label>
                                        <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="room-location-input" />
                                    </div>
                                </div>
                                <Button onClick={create} className="w-full bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="room-create-submit-btn">Create</Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </>
            }
        >
            <div className="p-6">
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="rooms-grid">
                {rooms.map((r) => {
                        // The QR encodes the short URL (e.g. /r/abc1) which
                        // redirects to /room/<pin>. We surface that short form
                        // on the card so people can type it manually if their
                        // phone can't scan the QR.
                        let shortHref = "";
                        let shortLabel = "";
                        try {
                            const u = new URL(r.qr_payload, window.location.origin);
                            shortHref = u.href;
                            shortLabel = `${u.host}${u.pathname}`;
                        } catch {
                            shortHref = r.qr_payload || "";
                            shortLabel = r.qr_payload || "";
                        }
                        return (
                        <Card key={r.id} className="border-gray-200 bg-white p-5" data-testid={`room-card-${r.id}`}>
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="label-eyebrow text-gray-500">Floor {r.floor} · {r.location}</div>
                                    <div className="font-display text-lg font-semibold text-gray-900 mt-1">{r.name}</div>
                                </div>
                                <div className="font-mono text-xs px-2 py-1 rounded bg-gray-50 border border-gray-200 text-gray-700">PIN {r.pin}</div>
                            </div>
                            <a
                                href={shortHref}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 block font-mono text-[11px] text-[#0055FF] hover:underline truncate"
                                title={shortHref}
                                data-testid={`room-${r.id}-short-url`}
                            >
                                {shortLabel}
                            </a>
                            <div className="mt-4 flex items-center gap-2">
                                <Button size="sm" variant="outline" onClick={() => setViewRoom(r)} className="text-xs" data-testid={`room-${r.id}-view-btn`}>
                                    <QrCode size={14} className="mr-1" /> View QR
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => regenerate(r.id)} className="text-xs" data-testid={`room-${r.id}-regen-btn`}>
                                    <ArrowsClockwise size={14} className="mr-1" /> Regenerate
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => remove(r.id)} className="text-xs text-red-600 hover:bg-red-50 ml-auto" data-testid={`room-${r.id}-delete-btn`}>
                                    <Trash size={14} />
                                </Button>
                            </div>
                        </Card>
                        );
                    })}
                </div>

                <Dialog open={!!viewRoom} onOpenChange={(o) => !o && setViewRoom(null)}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{viewRoom?.name}</DialogTitle></DialogHeader>
                        {viewRoom && (
                            <div className="space-y-4">
                                <div className="bg-white p-4 border border-gray-200 rounded-lg grid place-items-center">
                                    <img src={viewRoom.qr_image} alt="QR" className="w-64 h-64" />
                                </div>
                                <div className="text-center">
                                    <div className="label-eyebrow">PIN</div>
                                    <div className="font-mono text-4xl font-bold tracking-[0.3em] text-gray-900 dark:text-gray-100 mt-1">{viewRoom.pin}</div>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 text-center">
                                    <div className="label-eyebrow mb-1">Scanning opens</div>
                                    <a
                                        href={viewRoom.qr_payload}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-mono text-xs text-[#0055FF] hover:underline break-all"
                                        data-testid={`room-${viewRoom.id}-qr-url`}
                                    >
                                        {viewRoom.qr_payload}
                                    </a>
                                </div>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </AppShell>
    );
}
