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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PhosphorIcon } from "@/components/PhosphorIcon";

const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"];

export default function AdminCategories() {
    const { activeLocationId, requireLocation } = useLocation() || {};
    const [cats, setCats] = useState([]);
    const [depts, setDepts] = useState([]);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({
        name: "", icon: "Coffee", department_id: "", color: "#0055FF", priority: "normal", group: "Hospitality", active: true,
    });
    const [groupMode, setGroupMode] = useState("existing"); // "existing" | "new"
    const [newGroup, setNewGroup] = useState("");

    const load = async () => {
        const [c, d] = await Promise.all([api.get("/categories"), api.get("/departments")]);
        setCats(c.data);
        setDepts(d.data);
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeLocationId]);

    const create = async () => {
        if (!form.name || !form.department_id) return toast.error("Name and department required");
        const finalGroup = groupMode === "new" ? newGroup.trim() : form.group;
        if (!finalGroup) return toast.error("Group is required");
        try {
            await api.post("/categories", { ...form, group: finalGroup });
            toast.success("Category created");
            setShowCreate(false);
            setForm({ name: "", icon: "Coffee", department_id: "", color: "#0055FF", priority: "normal", group: finalGroup, active: true });
            setGroupMode("existing");
            setNewGroup("");
            load();
        } catch { toast.error("Failed"); }
    };

    const toggle = async (cat) => {
        try {
            await api.patch(`/categories/${cat.id}`, { active: !cat.active });
            load();
        } catch { toast.error("Failed"); }
    };

    const remove = async (id) => {
        if (!window.confirm("Delete this category?")) return;
        try {
            await api.delete(`/categories/${id}`);
            toast.success("Deleted");
            load();
        } catch { toast.error("Failed"); }
    };

    const grouped = cats.reduce((acc, c) => {
        (acc[c.group] = acc[c.group] || []).push(c);
        return acc;
    }, {});

    // Derive existing group options from current categories
    const existingGroups = Array.from(new Set(cats.map((c) => c.group).filter(Boolean))).sort();

    return (
        <AppShell
            title="Categories"
            subtitle="Request buttons & routing"
            actions={
                <>
                    <Button
                        onClick={() => requireLocation && requireLocation(() => setShowCreate(true), "a category")}
                        className="bg-[#0055FF] hover:bg-[#0044CC] text-white"
                        data-testid="categories-create-btn"
                    >
                        <Plus size={16} className="mr-1" /> New Category
                    </Button>
                    <Dialog open={showCreate} onOpenChange={setShowCreate}>
                        <DialogContent>
                        <DialogHeader><DialogTitle>New Category</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                            <div>
                                <Label>Name</Label>
                                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="cat-name-input" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>Group</Label>
                                    {groupMode === "existing" ? (
                                        <Select
                                            value={form.group}
                                            onValueChange={(v) => {
                                                if (v === "__new__") {
                                                    setGroupMode("new");
                                                    setNewGroup("");
                                                } else {
                                                    setForm({ ...form, group: v });
                                                }
                                            }}
                                        >
                                            <SelectTrigger data-testid="cat-group-select"><SelectValue placeholder="Select group" /></SelectTrigger>
                                            <SelectContent>
                                                {existingGroups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                                                <SelectItem value="__new__" data-testid="cat-group-new-option">
                                                    <span className="text-[#0055FF] font-medium">+ Add new group…</span>
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <div className="flex gap-2">
                                            <Input
                                                value={newGroup}
                                                onChange={(e) => setNewGroup(e.target.value)}
                                                placeholder="New group name"
                                                autoFocus
                                                data-testid="cat-group-new-input"
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => { setGroupMode("existing"); setNewGroup(""); }}
                                                className="shrink-0 text-xs"
                                                data-testid="cat-group-cancel-new-btn"
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <Label>Phosphor Icon</Label>
                                    <Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="Coffee" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>Color</Label>
                                    <Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
                                </div>
                                <div>
                                    <Label>Priority</Label>
                                    <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div>
                                <Label>Department</Label>
                                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                                    <SelectTrigger data-testid="cat-dept-select"><SelectValue placeholder="Select department" /></SelectTrigger>
                                    <SelectContent>
                                        {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button onClick={create} className="w-full bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="cat-create-submit-btn">Create</Button>
                        </div>
                    </DialogContent>
                </Dialog>
                </>
            }
        >
            <div className="p-6 space-y-8">
                {Object.entries(grouped).map(([group, items]) => (
                    <section key={group}>
                        <div className="label-eyebrow mb-3">{group}</div>
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {items.map((c) => (
                                <Card key={c.id} className="border-gray-200 bg-white p-4 flex items-center gap-3" data-testid={`cat-card-${c.id}`}>
                                    <div className="w-11 h-11 rounded-lg grid place-items-center" style={{ backgroundColor: `${c.color}15` }}>
                                        <PhosphorIcon name={c.icon} size={22} weight="duotone" color={c.color} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-gray-900 truncate">{c.name}</div>
                                        <div className="text-xs text-gray-500 capitalize">{c.priority}</div>
                                    </div>
                                    <Switch checked={c.active} onCheckedChange={() => toggle(c)} data-testid={`cat-${c.id}-toggle`} />
                                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)} className="text-red-600 hover:bg-red-50">
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
