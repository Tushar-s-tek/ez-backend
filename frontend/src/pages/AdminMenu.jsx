import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PhosphorIcon } from "@/components/PhosphorIcon";

export default function AdminMenu() {
    const { activeLocationId, requireLocation } = useLocation() || {};
    const [items, setItems] = useState([]);
    const [show, setShow] = useState(false);
    const [form, setForm] = useState({
        name: "", category: "Lunch", description: "", price: 100, icon: "ForkKnife", color: "#B45309", available: true,
    });

    const load = async () => {
        const { data } = await api.get("/menu");
        setItems(data);
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeLocationId]);

    const create = async () => {
        if (!form.name) return toast.error("Name required");
        try {
            await api.post("/menu", { ...form, price: parseFloat(form.price) });
            toast.success("Item added");
            setShow(false);
            setForm({ name: "", category: "Lunch", description: "", price: 100, icon: "ForkKnife", color: "#B45309", available: true });
            load();
        } catch { toast.error("Failed"); }
    };

    const toggle = async (item) => {
        try { await api.patch(`/menu/${item.id}`, { available: !item.available }); load(); } catch { toast.error("Failed"); }
    };

    const remove = async (id) => {
        if (!window.confirm("Delete item?")) return;
        try { await api.delete(`/menu/${id}`); load(); } catch { toast.error("Failed"); }
    };

    const grouped = items.reduce((acc, i) => { (acc[i.category] = acc[i.category] || []).push(i); return acc; }, {});

    return (
        <AppShell
            title="Cafeteria Menu"
            subtitle="Pre-order items"
            actions={
                <>
                    <Button
                        onClick={() => requireLocation && requireLocation(() => setShow(true), "a menu item")}
                        className="bg-[#0055FF] hover:bg-[#0044CC] text-white"
                        data-testid="menu-create-btn"
                    >
                        <Plus size={16} className="mr-1" /> New Item
                    </Button>
                    <Dialog open={show} onOpenChange={setShow}>
                        <DialogContent>
                            <DialogHeader><DialogTitle>New Menu Item</DialogTitle></DialogHeader>
                            <div className="space-y-3">
                                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="menu-name-input" /></div>
                                <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
                                    <div><Label>Price (₹)</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
                                    <div><Label>Phosphor Icon</Label><Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></div>
                                    <div><Label>Color</Label><Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
                                </div>
                                <Button onClick={create} className="w-full bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="menu-submit-btn">Add</Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </>
            }
        >
            <div className="p-6 space-y-8">
                {Object.entries(grouped).map(([cat, list]) => (
                    <section key={cat}>
                        <div className="label-eyebrow mb-3">{cat}</div>
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {list.map((m) => (
                                <Card key={m.id} className="bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800 p-4 flex items-center gap-3" data-testid={`menu-card-${m.id}`}>
                                    <div className="w-11 h-11 rounded-lg grid place-items-center" style={{ backgroundColor: `${m.color}15` }}>
                                        <PhosphorIcon name={m.icon} size={22} weight="duotone" color={m.color} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{m.name}</div>
                                        <div className="text-xs text-gray-500 truncate">{m.description}</div>
                                        <div className="font-mono text-xs text-gray-700 dark:text-gray-300 mt-0.5">₹ {m.price.toFixed(0)}</div>
                                    </div>
                                    <Switch checked={m.available} onCheckedChange={() => toggle(m)} />
                                    <Button size="sm" variant="ghost" onClick={() => remove(m.id)} className="text-red-600 hover:bg-red-50">
                                        <Trash size={14} />
                                    </Button>
                                </Card>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </AppShell>
    );
}
