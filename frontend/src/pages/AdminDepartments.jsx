import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash, PencilSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function AdminDepartments() {
    const { activeLocationId, requireLocation } = useLocation() || {};
    const [depts, setDepts] = useState([]);
    const [show, setShow] = useState(false);
    const [edit, setEdit] = useState(null);
    const [form, setForm] = useState({ name: "", description: "" });

    const load = async () => {
        const { data } = await api.get("/departments");
        setDepts(data);
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeLocationId]);

    const submit = async () => {
        if (!form.name) return toast.error("Name required");
        try {
            if (edit) {
                await api.patch(`/departments/${edit.id}`, form);
                toast.success("Updated");
            } else {
                await api.post("/departments", form);
                toast.success("Created");
            }
            setShow(false); setEdit(null); setForm({ name: "", description: "" });
            load();
        } catch { toast.error("Failed"); }
    };

    const remove = async (id) => {
        if (!window.confirm("Delete department?")) return;
        try { await api.delete(`/departments/${id}`); load(); } catch { toast.error("Failed"); }
    };

    return (
        <AppShell
            title="Departments"
            subtitle="Configure operating teams"
            actions={
                <>
                    <Button
                        onClick={() => requireLocation && requireLocation(() => setShow(true), "a department")}
                        className="bg-[#0055FF] hover:bg-[#0044CC] text-white"
                        data-testid="depts-create-btn"
                    >
                        <Plus size={16} className="mr-1" /> New Department
                    </Button>
                    <Dialog open={show} onOpenChange={(o) => { setShow(o); if (!o) { setEdit(null); setForm({ name: "", description: "" }); } }}>
                        <DialogContent>
                            <DialogHeader><DialogTitle>{edit ? "Edit Department" : "New Department"}</DialogTitle></DialogHeader>
                            <div className="space-y-3">
                                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="dept-name-input" /></div>
                                <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                                <Button onClick={submit} className="w-full bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="dept-submit-btn">{edit ? "Save" : "Create"}</Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </>
            }
        >
            <div className="p-6">
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {depts.map((d) => (
                        <Card key={d.id} className="bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800 p-5" data-testid={`dept-card-${d.id}`}>
                            <div className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">{d.name}</div>
                            <div className="text-sm text-gray-500 mt-1">{d.description || "—"}</div>
                            <div className="mt-4 flex items-center gap-2">
                                <Button size="sm" variant="outline" onClick={() => { setEdit(d); setForm({ name: d.name, description: d.description || "" }); setShow(true); }} data-testid={`dept-${d.id}-edit-btn`}>
                                    <PencilSimple size={14} className="mr-1" /> Edit
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => remove(d.id)} className="text-red-600 hover:bg-red-50 ml-auto">
                                    <Trash size={14} />
                                </Button>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>
        </AppShell>
    );
}
