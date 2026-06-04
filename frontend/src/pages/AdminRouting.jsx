import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FloppyDisk, CaretDown, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PhosphorIcon } from "@/components/PhosphorIcon";

export default function AdminRouting() {
    const { activeLocationId } = useLocation() || {};
    const [cats, setCats] = useState([]);
    const [depts, setDepts] = useState([]);
    const [rules, setRules] = useState([]);
    const [menu, setMenu] = useState([]);
    const [menuEdits, setMenuEdits] = useState({});
    const [edits, setEdits] = useState({});

    const load = async () => {
        const [c, d, r, m] = await Promise.all([
            api.get("/categories"),
            api.get("/departments"),
            api.get("/routing-rules"),
            api.get("/menu"),
        ]);
        setCats(c.data); setDepts(d.data); setRules(r.data); setMenu(m.data);
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeLocationId]);

    const getRule = (cat_id) => rules.find((r) => r.category_id === cat_id) || {};
    const deptName = (id) => depts.find((d) => d.id === id)?.name || id;

    // Departments available for routing a given category — must belong to the
    // same location as the category itself, so admins on the "All locations"
    // view never accidentally route a Bengalore category to a Vizag department.
    const deptsForCategory = (c) => {
        if (!c?.location_id) return depts;
        return depts.filter((d) => !d.location_id || d.location_id === c.location_id);
    };

    // Returns the currently-selected department ids for a category, considering
    // pending edits, falling back to the saved rule, then the category's own dept.
    const currentDeptIds = (c) => {
        const rule = getRule(c.id);
        const cur = edits[c.id] || {};
        if (cur.department_ids) return cur.department_ids;
        if (rule.department_ids && rule.department_ids.length > 0) return rule.department_ids;
        if (rule.department_id) return [rule.department_id];
        return c.department_id ? [c.department_id] : [];
    };

    const setDeptIds = (cat_id, ids) => {
        setEdits((p) => ({ ...p, [cat_id]: { ...(p[cat_id] || {}), department_ids: ids } }));
    };

    const toggleDept = (cat_id, dept_id) => {
        const cur = currentDeptIds(cats.find((c) => c.id === cat_id) || { id: cat_id });
        const has = cur.includes(dept_id);
        setDeptIds(cat_id, has ? cur.filter((x) => x !== dept_id) : [...cur, dept_id]);
    };

    const save = async (cat_id) => {
        const c = cats.find((x) => x.id === cat_id);
        const ids = currentDeptIds(c);
        const rule = getRule(cat_id);
        const cur = edits[cat_id] || {};
        const escalation_minutes = parseInt(cur.escalation_minutes ?? rule.escalation_minutes ?? 15, 10);
        if (!ids || ids.length === 0) return toast.error("Pick at least one department");
        try {
            await api.post("/routing-rules", {
                category_id: cat_id,
                department_ids: ids,
                escalation_minutes,
            });
            toast.success(`Routed to ${ids.length} department${ids.length === 1 ? "" : "s"}`);
            setEdits((p) => ({ ...p, [cat_id]: undefined }));
            load();
        } catch {
            toast.error("Failed");
        }
    };

    // ---- Menu-item routing helpers (parallel to category helpers above) ----
    // Each menu item carries a `department_ids` array; if empty the order
    // falls back to the location's Cafeteria department. The same multi-select
    // UI lets admins extend or override that default.
    const cafeteriaDeptForLoc = (locId) => {
        const d = depts.find((d) => d.location_id === locId && d.name.toLowerCase().includes("cafet"));
        return d?.id || null;
    };
    const deptsForMenuItem = (m) => {
        if (!m?.location_id) return depts;
        return depts.filter((d) => !d.location_id || d.location_id === m.location_id);
    };
    const currentMenuDeptIds = (m) => {
        const e = menuEdits[m.id];
        if (e?.department_ids) return e.department_ids;
        if (Array.isArray(m.department_ids) && m.department_ids.length > 0) return m.department_ids;
        const cafe = cafeteriaDeptForLoc(m.location_id);
        return cafe ? [cafe] : [];
    };
    const toggleMenuDept = (mid, did) => {
        const m = menu.find((x) => x.id === mid);
        const cur = currentMenuDeptIds(m);
        const has = cur.includes(did);
        setMenuEdits((p) => ({
            ...p,
            [mid]: { department_ids: has ? cur.filter((x) => x !== did) : [...cur, did] },
        }));
    };
    const saveMenu = async (mid) => {
        const m = menu.find((x) => x.id === mid);
        const ids = currentMenuDeptIds(m);
        if (!ids || ids.length === 0) return toast.error("Pick at least one department");
        try {
            await api.patch(`/menu/${mid}`, { department_ids: ids });
            toast.success(`"${m.name}" routed to ${ids.length} department${ids.length === 1 ? "" : "s"}`);
            setMenuEdits((p) => ({ ...p, [mid]: undefined }));
            load();
        } catch {
            toast.error("Failed");
        }
    };

    return (
        <AppShell title="Routing Rules" subtitle="Map every category and menu item to one or more departments — any of them can pick it up">
            <div className="p-6 space-y-6">
                <div>
                    <div className="label-eyebrow text-gray-500 mb-3">Service request categories</div>
                    <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Category</TableHead>
                                <TableHead>Group</TableHead>
                                <TableHead className="min-w-[280px]">Routed to Department(s)</TableHead>
                                <TableHead>Escalation (min)</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {cats.map((c) => {
                                const rule = getRule(c.id);
                                const cur = edits[c.id] || {};
                                const ids = currentDeptIds(c);
                                const esc = cur.escalation_minutes ?? rule.escalation_minutes ?? 15;
                                return (
                                    <TableRow key={c.id} data-testid={`routing-row-${c.id}`}>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <PhosphorIcon name={c.icon} size={18} weight="duotone" color={c.color} />
                                                <span className="font-medium">{c.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-gray-500">{c.group}</TableCell>
                                        <TableCell>
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <button
                                                        className="w-full min-h-[36px] border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-left text-sm bg-white dark:bg-[#0B0D10] hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center justify-between gap-2"
                                                        data-testid={`routing-${c.id}-depts-trigger`}
                                                    >
                                                        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                                                            {ids.length === 0 ? (
                                                                <span className="text-gray-400">Select departments…</span>
                                                            ) : (
                                                                ids.map((id) => (
                                                                    <span
                                                                        key={id}
                                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900"
                                                                        data-testid={`routing-${c.id}-chip-${id}`}
                                                                    >
                                                                        {deptName(id)}
                                                                        <span
                                                                            role="button"
                                                                            tabIndex={0}
                                                                            onClick={(e) => { e.stopPropagation(); toggleDept(c.id, id); }}
                                                                            className="hover:text-red-600 cursor-pointer"
                                                                            data-testid={`routing-${c.id}-chip-${id}-remove`}
                                                                        >
                                                                            <X size={10} />
                                                                        </span>
                                                                    </span>
                                                                ))
                                                            )}
                                                        </div>
                                                        <CaretDown size={14} className="text-gray-400 shrink-0" />
                                                    </button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-64 p-2" align="start">
                                                    <div className="space-y-0.5 max-h-64 overflow-y-auto" data-testid={`routing-${c.id}-depts-list`}>
                                                        {deptsForCategory(c).length === 0 && (
                                                            <div className="text-xs text-gray-400 px-2 py-1.5">No departments in this location.</div>
                                                        )}
                                                        {deptsForCategory(c).map((d) => {
                                                            const checked = ids.includes(d.id);
                                                            return (
                                                                <label
                                                                    key={d.id}
                                                                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
                                                                    data-testid={`routing-${c.id}-dept-${d.id}`}
                                                                >
                                                                    <Checkbox
                                                                        checked={checked}
                                                                        onCheckedChange={() => toggleDept(c.id, d.id)}
                                                                    />
                                                                    <span className="text-gray-700 dark:text-gray-300">{d.name}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                </PopoverContent>
                                            </Popover>
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number" min={1}
                                                value={esc}
                                                onChange={(e) => setEdits((p) => ({
                                                    ...p,
                                                    [c.id]: { ...(p[c.id] || {}), escalation_minutes: e.target.value },
                                                }))}
                                                className="h-9 w-24"
                                                data-testid={`routing-${c.id}-esc-input`}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                onClick={() => save(c.id)}
                                                className="bg-[#0055FF] hover:bg-[#0044CC] text-white h-9"
                                                data-testid={`routing-${c.id}-save-btn`}
                                            >
                                                <FloppyDisk size={14} className="mr-1" /> Save
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </Card>
                </div>

                {/* ---- Menu items (food / cafeteria orders) ---- */}
                <div>
                    <div className="label-eyebrow text-gray-500 mb-3">Menu items (food orders)</div>
                    <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Category</TableHead>
                                    <TableHead className="min-w-[280px]">Routed to Department(s)</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {menu.length === 0 && (
                                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-gray-400 py-6">No menu items in this location.</TableCell></TableRow>
                                )}
                                {menu.map((m) => {
                                    const ids = currentMenuDeptIds(m);
                                    return (
                                        <TableRow key={m.id} data-testid={`menu-routing-row-${m.id}`}>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <PhosphorIcon name={m.icon} size={18} weight="duotone" color={m.color} />
                                                    <span className="font-medium">{m.name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-gray-500">{m.category}</TableCell>
                                            <TableCell>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <button
                                                            className="w-full min-h-[36px] border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-left text-sm bg-white dark:bg-[#0B0D10] hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center justify-between gap-2"
                                                            data-testid={`menu-routing-${m.id}-depts-trigger`}
                                                        >
                                                            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                                                                {ids.length === 0 ? (
                                                                    <span className="text-gray-400">Select departments…</span>
                                                                ) : (
                                                                    ids.map((id) => (
                                                                        <span
                                                                            key={id}
                                                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900"
                                                                            data-testid={`menu-routing-${m.id}-chip-${id}`}
                                                                        >
                                                                            {deptName(id)}
                                                                            <span
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={(e) => { e.stopPropagation(); toggleMenuDept(m.id, id); }}
                                                                                className="hover:text-red-600 cursor-pointer"
                                                                            >
                                                                                <X size={10} />
                                                                            </span>
                                                                        </span>
                                                                    ))
                                                                )}
                                                            </div>
                                                            <CaretDown size={14} className="text-gray-400 shrink-0" />
                                                        </button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-64 p-2" align="start">
                                                        <div className="space-y-0.5 max-h-64 overflow-y-auto">
                                                            {deptsForMenuItem(m).length === 0 && (
                                                                <div className="text-xs text-gray-400 px-2 py-1.5">No departments in this location.</div>
                                                            )}
                                                            {deptsForMenuItem(m).map((d) => {
                                                                const checked = ids.includes(d.id);
                                                                return (
                                                                    <label
                                                                        key={d.id}
                                                                        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
                                                                        data-testid={`menu-routing-${m.id}-dept-${d.id}`}
                                                                    >
                                                                        <Checkbox checked={checked} onCheckedChange={() => toggleMenuDept(m.id, d.id)} />
                                                                        <span className="text-gray-700 dark:text-gray-300">{d.name}</span>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    size="sm"
                                                    onClick={() => saveMenu(m.id)}
                                                    className="bg-[#0055FF] hover:bg-[#0044CC] text-white h-9"
                                                    data-testid={`menu-routing-${m.id}-save-btn`}
                                                >
                                                    <FloppyDisk size={14} className="mr-1" /> Save
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </Card>
                </div>
            </div>
        </AppShell>
    );
}
