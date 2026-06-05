import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, formatApiErrorDetail } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash, PencilSimple, MapPin, CheckCircle } from "@phosphor-icons/react";
import { toast } from "sonner";

const EMPTY = { name: "", code: "", address: "", timezone: "UTC", active: true };

export default function AdminLocations() {
    const { locations, refresh, activeLocationId, setActiveLocationId } = useLocation();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);
    const [saving, setSaving] = useState(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refresh(); }, []);

    const startCreate = () => {
        setEditing(null);
        setForm(EMPTY);
        setOpen(true);
    };

    const startEdit = (loc) => {
        setEditing(loc);
        setForm({
            name: loc.name || "",
            code: loc.code || "",
            address: loc.address || "",
            timezone: loc.timezone || "UTC",
            active: loc.active !== false,
        });
        setOpen(true);
    };

    const save = async () => {
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }
        setSaving(true);
        try {
            if (editing) {
                await api.patch(`/locations/${editing.id}`, form);
                toast.success("Location updated");
            } else {
                await api.post("/locations", form);
                toast.success("Location created");
            }
            await refresh();
            setOpen(false);
        } catch (e) {
            toast.error(formatApiErrorDetail(e?.response?.data?.detail));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (loc) => {
        if (!window.confirm(
            `Delete "${loc.name}"?\n\nThis will also delete ALL its rooms, categories, departments, ` +
            `menu items, routing rules, requests, and pre-orders. This action is IRREVERSIBLE.`
        )) return;
        try {
            await api.delete(`/locations/${loc.id}`, { params: { cascade: true } });
            toast.success("Deleted");
            await refresh();
            if (activeLocationId === loc.id) {
                setActiveLocationId(null);
            }
        } catch (e) {
            toast.error(formatApiErrorDetail(e?.response?.data?.detail));
        }
    };

    return (
        <AppShell
            title="Locations"
            subtitle="Tenant"
            actions={
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button
                            onClick={startCreate}
                            className="bg-[#0055FF] hover:bg-[#0044CC] text-white"
                            data-testid="locations-create-btn"
                        >
                            <Plus size={16} className="mr-1" /> New Location
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editing ? "Edit Location" : "Create Location"}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label>Name</Label>
                                <Input
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="e.g. London Office"
                                    data-testid="location-name-input"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>Code</Label>
                                    <Input
                                        value={form.code}
                                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                                        placeholder="LON"
                                        data-testid="location-code-input"
                                    />
                                </div>
                                <div>
                                    <Label>Timezone</Label>
                                    <Input
                                        value={form.timezone}
                                        onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                                        placeholder="UTC"
                                        data-testid="location-tz-input"
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>Address</Label>
                                <Input
                                    value={form.address}
                                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                                    placeholder="Building, City"
                                    data-testid="location-address-input"
                                />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-800 px-3 py-2">
                                <div>
                                    <Label htmlFor="loc-active">Active</Label>
                                    <div className="text-xs text-gray-500">Inactive locations stay listed but are skipped in defaults.</div>
                                </div>
                                <Switch
                                    id="loc-active"
                                    checked={form.active}
                                    onCheckedChange={(v) => setForm({ ...form, active: v })}
                                    data-testid="location-active-switch"
                                />
                            </div>
                            <Button
                                onClick={save}
                                disabled={saving}
                                className="w-full bg-[#0055FF] hover:bg-[#0044CC] text-white"
                                data-testid="location-save-btn"
                            >
                                {saving ? "Saving…" : editing ? "Save changes" : "Create"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            }
        >
            <div className="p-6">
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="locations-grid">
                    {locations.map((l) => {
                        const isActive = activeLocationId === l.id;
                        return (
                            <Card
                                key={l.id}
                                className={`border bg-white dark:bg-[#0B0D10] p-5 flex flex-col gap-3 ${
                                    isActive
                                        ? "border-[#0055FF] ring-2 ring-[#0055FF]/30"
                                        : "border-gray-200 dark:border-gray-800"
                                }`}
                                data-testid={`location-card-${l.id}`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="min-w-0">
                                        <div className="label-eyebrow text-gray-500 flex items-center gap-1.5">
                                            <MapPin size={12} weight="duotone" />
                                            {l.code || "—"} · {l.timezone || "UTC"}
                                        </div>
                                        <div className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1 truncate">
                                            {l.name}
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                            {l.address || "No address"}
                                        </div>
                                    </div>
                                    {isActive && (
                                        <span className="text-[10px] font-semibold tracking-wider uppercase text-[#0055FF] flex items-center gap-1">
                                            <CheckCircle size={12} weight="fill" /> Current
                                        </span>
                                    )}
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                    {!isActive && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setActiveLocationId(l.id)}
                                            className="text-xs"
                                            data-testid={`location-${l.id}-activate-btn`}
                                        >
                                            Switch to
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => startEdit(l)}
                                        className="text-xs"
                                        data-testid={`location-${l.id}-edit-btn`}
                                    >
                                        <PencilSimple size={14} className="mr-1" /> Edit
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => remove(l)}
                                        className="text-xs text-red-600 hover:bg-red-50 ml-auto"
                                        data-testid={`location-${l.id}-delete-btn`}
                                    >
                                        <Trash size={14} />
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
                {locations.length === 0 && (
                    <Card className="border-dashed border-2 border-gray-200 dark:border-gray-800 bg-transparent p-10 text-center">
                        <MapPin size={28} weight="duotone" className="mx-auto text-gray-400 mb-2" />
                        <div className="text-gray-700 dark:text-gray-300 font-medium">No locations yet</div>
                        <div className="text-xs text-gray-500 mt-1">Create your first location to get started.</div>
                    </Card>
                )}
            </div>
        </AppShell>
    );
}
