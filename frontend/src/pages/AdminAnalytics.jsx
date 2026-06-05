import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, API } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocation } from "@/lib/location";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Download, ChartBar, Scales } from "@phosphor-icons/react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#0055FF", "#00B368", "#F5A623", "#7C3AED", "#E53935", "#0891B2", "#EC4899"];

function formatSec(s) {
    if (!s) return "—";
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${(s / 3600).toFixed(1)}h`;
}

export default function AdminAnalytics() {
    const { user } = useAuth();
    const isSuperAdmin = user?.role === "super_admin";
    const { activeLocationId } = useLocation() || {};
    const [data, setData] = useState(null);
    const [compare, setCompare] = useState(null);
    const [view, setView] = useState("current"); // "current" | "compare"
    const [days, setDays] = useState("7");

    const load = async () => {
        try {
            const { data } = await api.get("/analytics/overview", { params: { days: parseInt(days, 10) } });
            setData(data);
        } catch {}
        if (isSuperAdmin) {
            try {
                const { data: cmp } = await api.get("/analytics/compare", { params: { days: parseInt(days, 10) } });
                setCompare(cmp);
            } catch {}
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [days, activeLocationId]);

    const exportCsv = () => {
        // Open in new tab; cookies included automatically
        const url = `${API}/analytics/export.csv?days=${days}`;
        window.open(url, "_blank");
    };

    return (
        <AppShell
            title="Analytics"
            subtitle="Operational insights"
            actions={
                <div className="flex items-center gap-2">
                    {isSuperAdmin && (
                        <div className="flex border border-gray-200 dark:border-gray-800 rounded-md overflow-hidden text-xs">
                            <button
                                onClick={() => setView("current")}
                                className={`px-3 py-1.5 flex items-center gap-1 ${view === "current" ? "bg-[#0055FF] text-white" : "bg-white dark:bg-[#0B0D10] text-gray-700 dark:text-gray-300"}`}
                                data-testid="analytics-view-current"
                            >
                                <ChartBar size={14} /> Current location
                            </button>
                            <button
                                onClick={() => setView("compare")}
                                className={`px-3 py-1.5 flex items-center gap-1 ${view === "compare" ? "bg-[#0055FF] text-white" : "bg-white dark:bg-[#0B0D10] text-gray-700 dark:text-gray-300"}`}
                                data-testid="analytics-view-compare"
                            >
                                <Scales size={14} /> Compare all
                            </button>
                        </div>
                    )}
                    <Select value={days} onValueChange={setDays}>
                        <SelectTrigger className="w-32" data-testid="analytics-range-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">Last 24h</SelectItem>
                            <SelectItem value="7">Last 7 days</SelectItem>
                            <SelectItem value="30">Last 30 days</SelectItem>
                            <SelectItem value="90">Last 90 days</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={exportCsv} variant="outline" data-testid="analytics-export-btn">
                        <Download size={16} className="mr-1" /> CSV
                    </Button>
                </div>
            }
        >
            <div className="p-6 space-y-6">
                {view === "compare" && isSuperAdmin && compare && (
                    <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800 p-5" data-testid="analytics-compare-card">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <div className="label-eyebrow text-gray-500">All locations · last {compare.days} day{compare.days === 1 ? "" : "s"}</div>
                                <div className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100">Per-location comparison</div>
                            </div>
                            <div className="text-xs text-gray-500">Aggregate: <span className="font-semibold text-gray-900 dark:text-gray-100">{compare.aggregate.total}</span> requests · {compare.aggregate.delivered_pct}% delivered</div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm" data-testid="analytics-compare-table">
                                <thead className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200 dark:border-gray-800">
                                    <tr>
                                        <th className="py-2 pr-4">Location</th>
                                        <th className="py-2 pr-4 text-right">Total</th>
                                        <th className="py-2 pr-4 text-right">Pending</th>
                                        <th className="py-2 pr-4 text-right">Delivered</th>
                                        <th className="py-2 pr-4 text-right">Delivered %</th>
                                        <th className="py-2 pr-4 text-right">Escalated</th>
                                        <th className="py-2 pr-4 text-right">Avg Response</th>
                                        <th className="py-2 pr-4 text-right">Avg Delivery</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {compare.locations.map((l) => (
                                        <tr key={l.id} className="border-b border-gray-100 dark:border-gray-900" data-testid={`compare-row-${l.id}`}>
                                            <td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-gray-100">{l.name}</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums">{l.total}</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums">{l.pending > 0 ? <span className="text-amber-600 font-semibold">{l.pending}</span> : 0}</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums text-emerald-700">{l.delivered}</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums">{l.delivered_pct}%</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums">{l.escalated > 0 ? <span className="text-red-600 font-semibold">{l.escalated}</span> : 0}</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums text-gray-600">{formatSec(l.avg_response_seconds)}</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums text-gray-600">{formatSec(l.avg_delivery_seconds)}</td>
                                        </tr>
                                    ))}
                                    <tr className="font-semibold bg-gray-50 dark:bg-gray-900/30">
                                        <td className="py-2.5 pr-4">All locations</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">{compare.aggregate.total}</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">{compare.aggregate.pending}</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums text-emerald-700">{compare.aggregate.delivered}</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">{compare.aggregate.delivered_pct}%</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">{compare.aggregate.escalated}</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">{formatSec(compare.aggregate.avg_response_seconds)}</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">{formatSec(compare.aggregate.avg_delivery_seconds)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}

                {view === "current" && (<>
                {/* KPI row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Kpi label="Total Requests" value={data?.total ?? 0} />
                    <Kpi label="Pending" value={data?.pending ?? 0} accent="amber" />
                    <Kpi label="Avg Response" value={formatSec(data?.avg_response_seconds)} accent="violet" />
                    <Kpi label="Avg Delivery" value={formatSec(data?.avg_delivery_seconds)} accent="emerald" />
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Hourly */}
                    <Card className="bg-white border-gray-200 p-5">
                        <div className="label-eyebrow mb-3">Requests by hour</div>
                        <div className="h-64">
                            <ResponsiveContainer>
                                <BarChart data={data?.by_hour || []}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                                    <XAxis dataKey="hour" stroke="#71717A" fontSize={12} />
                                    <YAxis stroke="#71717A" fontSize={12} />
                                    <Tooltip contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12 }} />
                                    <Bar dataKey="count" fill="#0055FF" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>

                    {/* Top categories */}
                    <Card className="bg-white border-gray-200 p-5">
                        <div className="label-eyebrow mb-3">Top categories</div>
                        <div className="h-64">
                            <ResponsiveContainer>
                                <PieChart>
                                    <Pie
                                        data={(data?.top_categories || []).map(([name, count]) => ({ name, value: count }))}
                                        dataKey="value"
                                        nameKey="name"
                                        innerRadius={50}
                                        outerRadius={90}
                                        paddingAngle={2}
                                    >
                                        {(data?.top_categories || []).map((_, i) => (
                                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12 }} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>

                    {/* Daily trend */}
                    <Card className="bg-white border-gray-200 p-5 lg:col-span-2">
                        <div className="label-eyebrow mb-3">Daily trend</div>
                        <div className="h-64">
                            <ResponsiveContainer>
                                <LineChart data={data?.by_day || []}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                                    <XAxis dataKey="day" stroke="#71717A" fontSize={11} />
                                    <YAxis stroke="#71717A" fontSize={12} />
                                    <Tooltip contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12 }} />
                                    <Line type="monotone" dataKey="count" stroke="#0055FF" strokeWidth={2.5} dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>

                    {/* Top rooms */}
                    <Card className="bg-white border-gray-200 p-5 lg:col-span-2">
                        <div className="label-eyebrow mb-3">Top rooms by request volume</div>
                        <div className="h-64">
                            <ResponsiveContainer>
                                <BarChart data={(data?.top_rooms || []).map(([name, count]) => ({ name, count }))} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                                    <XAxis type="number" stroke="#71717A" fontSize={12} />
                                    <YAxis dataKey="name" type="category" width={140} stroke="#71717A" fontSize={12} />
                                    <Tooltip contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12 }} />
                                    <Bar dataKey="count" fill="#00B368" radius={[0, 6, 6, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>
                </div>
                </>)}
            </div>
        </AppShell>
    );
}

function Kpi({ label, value, accent }) {
    const c = { amber: "text-amber-600", violet: "text-violet-600", emerald: "text-emerald-600" }[accent] || "text-gray-900";
    return (
        <Card className="bg-white border-gray-200 p-5">
            <div className="label-eyebrow text-gray-500">{label}</div>
            <div className={`font-display text-3xl font-bold mt-2 ${c}`}>{value}</div>
        </Card>
    );
}
