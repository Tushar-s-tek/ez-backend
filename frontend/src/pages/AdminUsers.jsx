import React, { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocation } from "@/lib/location";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import SelectWithAdd from "@/components/SelectWithAdd";
import {
    Plus, Trash, PencilSimple, MagnifyingGlass, X, CaretUp, CaretDown, MapPin,
} from "@phosphor-icons/react";
import { toast } from "sonner";

const EMPTY = { email: "", name: "", password: "", role: "reception", department_id: "", location_id: "", extra_location_ids: [] };

export default function AdminUsers() {
    const { user: me } = useAuth();
    const { activeLocationId, locations, requireLocation } = useLocation() || { locations: [] };
    const isSuperAdmin = me?.role === "super_admin";

    const [users, setUsers] = useState([]);
    const [depts, setDepts] = useState([]);
    const [roles, setRoles] = useState([]);
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);

    // Filters & sort
    const [locFilter, setLocFilter] = useState("__all__");
    const [deptFilter, setDeptFilter] = useState("__all__");
    const [roleFilter, setRoleFilter] = useState("__all__");
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState("name");
    const [sortDir, setSortDir] = useState("asc");

    const load = async () => {
        const params = {};
        if (locFilter !== "__all__") params.location_id = locFilter;
        if (deptFilter !== "__all__") params.department_id = deptFilter;
        if (roleFilter !== "__all__") params.role = roleFilter;
        if (search.trim()) params.q = search.trim();
        params.sort = sortKey;
        params.order = sortDir;

        const [u, d, r] = await Promise.all([
            api.get("/users", { params }),
            api.get("/departments"),
            api.get("/roles"),
        ]);
        setUsers(u.data); setDepts(d.data); setRoles(r.data);
    };
    // Refresh whenever any filter changes (debounced for search via effect timing)
    useEffect(() => {
        const t = setTimeout(() => { load(); }, search ? 250 : 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line
    }, [activeLocationId, locFilter, deptFilter, roleFilter, search, sortKey, sortDir]);

    const locName = (id) => (locations || []).find((l) => l.id === id)?.name || "—";
    const deptName = (id) => depts.find((d) => d.id === id)?.name || "—";
    const roleLabel = (v) => (roles.find((r) => r.value === v)?.label || v.replace(/_/g, " "));

    const addRole = async (label) => {
        const { data } = await api.post("/roles", { label });
        setRoles((p) => [...p, data]);
        return data; // {value, label}
    };
    const addDepartment = async (name) => {
        const { data } = await api.post("/departments", { name, description: "" });
        setDepts((p) => [...p, data]);
        return { value: data.id, label: data.name };
    };

    const openCreate = () => {
        setEditing(null);
        setForm({
            ...EMPTY,
            location_id: isSuperAdmin ? (activeLocationId || "") : (me?.location_id || ""),
        });
        setShow(true);
    };

    const openEdit = (u) => {
        setEditing(u);
        setForm({
            email: u.email,
            name: u.name,
            password: "",
            role: u.role,
            department_id: u.department_id || "",
            location_id: u.location_id || "",
            extra_location_ids: u.extra_location_ids || [],
        });
        setShow(true);
    };

    const submit = async () => {
        if (!editing) {
            if (!form.email || !form.password || !form.name) return toast.error("Name, email, and password are required");
        }
        try {
            const payload = {
                ...form,
                department_id: form.department_id || null,
                // Don't send primary location for super_admin role
                location_id: form.role === "super_admin" ? null : (form.location_id || null),
                extra_location_ids: form.role === "super_admin" ? [] : (form.extra_location_ids || []),
            };
            if (editing) {
                if (!payload.password) delete payload.password;
                delete payload.email;
                await api.patch(`/users/${editing.id}`, payload);
                toast.success("Updated");
            } else {
                await api.post("/users", payload);
                toast.success("Created");
            }
            setShow(false); setEditing(null);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || "Failed");
        }
    };

    const remove = async (id) => {
        if (!window.confirm("Delete this user?")) return;
        try { await api.delete(`/users/${id}`); load(); } catch { toast.error("Failed"); }
    };

    const toggleExtra = (locId) => {
        const has = form.extra_location_ids.includes(locId);
        setForm({
            ...form,
            extra_location_ids: has
                ? form.extra_location_ids.filter((x) => x !== locId)
                : [...form.extra_location_ids, locId],
        });
    };

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key); setSortDir("asc");
        }
    };

    const sortIcon = (key) => {
        if (sortKey !== key) return <CaretUp size={12} className="opacity-30 ml-1" />;
        return sortDir === "asc" ? <CaretUp size={12} className="ml-1" /> : <CaretDown size={12} className="ml-1" />;
    };

    const SortableHead = ({ k, children, className = "" }) => (
        <TableHead className={className}>
            <button onClick={() => handleSort(k)} className="flex items-center gap-0.5 hover:text-[#0055FF]" data-testid={`users-sort-${k}`}>
                {children} {sortIcon(k)}
            </button>
        </TableHead>
    );

    const totalCount = users.length;
    const activeFilterCount = useMemo(() =>
        [locFilter, deptFilter, roleFilter].filter((v) => v !== "__all__").length + (search ? 1 : 0),
    [locFilter, deptFilter, roleFilter, search]);

    return (
        <AppShell
            title="Users & Roles"
            subtitle="Manage staff access"
            actions={
                <Button onClick={() => requireLocation ? requireLocation(openCreate, "a user") : openCreate()} className="bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="users-create-btn">
                    <Plus size={16} className="mr-1" /> New User
                </Button>
            }
        >
            <div className="p-6 space-y-4">
                {/* Filter bar */}
                <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800 p-4" data-testid="users-filter-bar">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="relative flex-1 min-w-[200px]">
                            <Label className="text-xs">Search by name or email</Label>
                            <div className="relative mt-1">
                                <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 pr-8 h-9" placeholder="alice@…" data-testid="users-search-input" />
                                {search && (
                                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" data-testid="users-search-clear">
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="min-w-[180px]">
                            <Label className="text-xs">Location</Label>
                            <Select value={locFilter} onValueChange={setLocFilter}>
                                <SelectTrigger className="h-9 mt-1" data-testid="users-filter-location"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">All locations</SelectItem>
                                    {(locations || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="min-w-[160px]">
                            <Label className="text-xs">Department</Label>
                            <Select value={deptFilter} onValueChange={setDeptFilter}>
                                <SelectTrigger className="h-9 mt-1" data-testid="users-filter-department"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">All departments</SelectItem>
                                    {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="min-w-[140px]">
                            <Label className="text-xs">Role</Label>
                            <Select value={roleFilter} onValueChange={setRoleFilter}>
                                <SelectTrigger className="h-9 mt-1" data-testid="users-filter-role"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">All roles</SelectItem>
                                    {roles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        {activeFilterCount > 0 && (
                            <Button
                                variant="ghost"
                                onClick={() => { setLocFilter("__all__"); setDeptFilter("__all__"); setRoleFilter("__all__"); setSearch(""); }}
                                className="text-xs text-gray-600 h-9"
                                data-testid="users-filter-clear"
                            >
                                Clear filters
                            </Button>
                        )}
                    </div>
                    <div className="mt-2 text-xs text-gray-500" data-testid="users-result-count">
                        Showing {totalCount} user{totalCount === 1 ? "" : "s"}{activeFilterCount > 0 && ` (${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active)`}
                    </div>
                </Card>

                <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800 overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <SortableHead k="name">Name</SortableHead>
                                <SortableHead k="email">Email</SortableHead>
                                <SortableHead k="role">Role</SortableHead>
                                <TableHead>Department</TableHead>
                                <TableHead>Location</TableHead>
                                <SortableHead k="created_at">Created</SortableHead>
                                <TableHead className="w-20 text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.length === 0 && (
                                <TableRow><TableCell colSpan={7} className="text-center py-12 text-gray-400">No users match these filters.</TableCell></TableRow>
                            )}
                            {users.map((u) => (
                                <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                                    <TableCell className="font-medium text-gray-900 dark:text-gray-100">{u.name}</TableCell>
                                    <TableCell className="font-mono text-xs text-gray-700 dark:text-gray-300">{u.email}</TableCell>
                                    <TableCell><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900">{roleLabel(u.role)}</span></TableCell>
                                    <TableCell className="text-gray-500">{deptName(u.department_id)}</TableCell>
                                    <TableCell>
                                        {u.role === "super_admin" ? (
                                            <span className="text-xs text-gray-400 italic">all locations</span>
                                        ) : (
                                            <div className="flex flex-wrap gap-1 items-center" data-testid={`user-${u.id}-locations`}>
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900">
                                                    <MapPin size={10} weight="duotone" /> {locName(u.location_id)}
                                                </span>
                                                {(u.extra_location_ids || []).map((id) => (
                                                    <span key={id} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700" title="Read-only extra access">
                                                        + {locName(id)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-xs text-gray-500 tabular-nums">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</TableCell>
                                    <TableCell>
                                        <div className="flex justify-end gap-1">
                                            <Button size="sm" variant="ghost" onClick={() => openEdit(u)} data-testid={`user-${u.id}-edit-btn`}>
                                                <PencilSimple size={14} />
                                            </Button>
                                            <Button size="sm" variant="ghost" onClick={() => remove(u.id)} className="text-red-600 hover:bg-red-50" data-testid={`user-${u.id}-delete-btn`}>
                                                <Trash size={14} />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Card>
            </div>

            {/* Create/Edit dialog */}
            <Dialog open={show} onOpenChange={setShow}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editing ? `Edit ${editing.name}` : "New User"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="user-name-input" /></div>
                        {!editing && (
                            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="user-email-input" /></div>
                        )}
                        <div>
                            <Label>{editing ? "New password (leave blank to keep)" : "Password"}</Label>
                            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-pwd-input" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label>Role</Label>
                                <SelectWithAdd
                                    value={form.role}
                                    onValueChange={(v) => setForm({ ...form, role: v })}
                                    options={roles}
                                    onAdd={addRole}
                                    addLabel="Add new role"
                                    placeholder="Pick a role"
                                    testid="user-role-select"
                                />
                            </div>
                            <div>
                                <Label>Department</Label>
                                <SelectWithAdd
                                    value={form.department_id || "_none"}
                                    onValueChange={(v) => setForm({ ...form, department_id: v === "_none" ? "" : v })}
                                    options={[
                                        { value: "_none", label: "— None —" },
                                        ...depts.map((d) => ({ value: d.id, label: d.name })),
                                    ]}
                                    onAdd={addDepartment}
                                    addLabel="Add new department"
                                    placeholder="Pick a department"
                                    testid="user-dept-select"
                                />
                            </div>
                        </div>
                        {form.role !== "super_admin" && (
                            <>
                                <div>
                                    <Label>Primary location <span className="text-[10px] text-gray-500 ml-1">(where they're stationed — can mutate)</span></Label>
                                    <Select
                                        value={form.location_id || ""}
                                        onValueChange={(v) => setForm({ ...form, location_id: v })}
                                        disabled={!isSuperAdmin}
                                    >
                                        <SelectTrigger data-testid="user-primary-loc-select"><SelectValue placeholder="Pick primary location" /></SelectTrigger>
                                        <SelectContent>
                                            {(locations || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    {!isSuperAdmin && (
                                        <div className="text-[11px] text-gray-500 mt-1.5 flex items-start gap-1">
                                            <MapPin size={11} weight="duotone" className="text-[#0055FF] mt-0.5 shrink-0" />
                                            <span>New users you create here will be assigned to <span className="font-semibold">{locName(me?.location_id)}</span> automatically.</span>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <Label>Extra locations <span className="text-[10px] text-gray-500 ml-1">(read-only monitoring access)</span></Label>
                                    <div className="space-y-1.5 mt-1 max-h-44 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-800 p-2 bg-white dark:bg-[#0B0D10]" data-testid="user-extras-list">
                                        {(locations || []).filter((l) => l.id !== form.location_id).map((l) => (
                                            <label key={l.id} className="flex items-center gap-2 cursor-pointer text-sm py-0.5 px-1 hover:bg-gray-50 dark:hover:bg-gray-900/40 rounded" data-testid={`user-extra-${l.id}`}>
                                                <Checkbox
                                                    checked={form.extra_location_ids.includes(l.id)}
                                                    onCheckedChange={() => toggleExtra(l.id)}
                                                />
                                                <span className="text-gray-700 dark:text-gray-300">{l.name}</span>
                                            </label>
                                        ))}
                                        {(locations || []).filter((l) => l.id !== form.location_id).length === 0 && (
                                            <div className="text-xs text-gray-400 italic py-1 px-1">No other locations to grant access to.</div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                        <Button onClick={submit} className="w-full bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="user-submit-btn">
                            {editing ? "Save changes" : "Create"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </AppShell>
    );
}
