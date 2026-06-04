import React, { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocation } from "@/lib/location";
import { SOUND_OPTIONS, playSoundByKey, setSoundConfig } from "@/lib/sound";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { SlackLogo, MicrosoftTeamsLogo, WhatsappLogo, Envelope, FloppyDisk, ShieldCheck, Warning, CheckCircle, Trash, SpeakerHigh, Play } from "@phosphor-icons/react";

const SOUND_EVENTS = [
    { key: "sound_new_request", label: "New request" },
    { key: "sound_new_order",   label: "New pre-order" },
    { key: "sound_accepted",    label: "Request accepted" },
    { key: "sound_started",     label: "Preparation started" },
    { key: "sound_ready",       label: "Order ready / delivered" },
    { key: "sound_escalated",   label: "Escalated" },
    { key: "sound_visitor",     label: "Visitor waiting" },
];

const DEFAULT_SOUND = {
    sound_new_request: "chime",
    sound_new_order:   "marimba",
    sound_accepted:    "soft_pop",
    sound_started:     "two_tone",
    sound_ready:       "doorbell",
    sound_escalated:   "alert",
    sound_visitor:     "soft_pop",
};

export default function AdminSettings() {
    const { user } = useAuth();
    const { activeLocationId, locations } = useLocation() || {};
    const isSuperAdmin = user?.role === "super_admin";
    // For super_admin: edit per-location settings when a location is selected,
    // otherwise edit GLOBAL. For everyone else: forced to their own location.
    const [scope, setScope] = useState(isSuperAdmin ? "location" : "location"); // "location" | "global"
    const editLocId = scope === "global"
        ? null
        : (isSuperAdmin ? activeLocationId : (user?.location_id || null));
    const activeLocName = (locations || []).find((l) => l.id === editLocId)?.name;
    const [s, setS] = useState({
        slack_webhook_url: "", teams_webhook_url: "",
        whatsapp_token: "", whatsapp_phone_id: "", whatsapp_to: "",
        email_enabled: false,
        nda_text: "", nda_required: false, visitor_badge_hours: 8,
        ...DEFAULT_SOUND,
    });
    const [saved, setSaved] = useState({});
    const [loaded, setLoaded] = useState(false);
    const [failures, setFailures] = useState([]);
    const [showResolved, setShowResolved] = useState(false);

    const loadFailures = async (resolved = showResolved) => {
        try {
            const { data } = await api.get("/settings/failed-dispatches", { params: { include_resolved: resolved } });
            setFailures(data);
        } catch {}
    };

    useEffect(() => {
        (async () => {
            try {
                const params = editLocId ? { location_id: editLocId } : {};
                const { data } = await api.get("/settings", { params });
                const isMasked = (v) => typeof v === "string" && v.startsWith("•");
                const next = { ...data };
                const flags = {};
                ["slack_webhook_url", "teams_webhook_url", "whatsapp_token"].forEach((k) => {
                    flags[k] = !!data[k] && isMasked(data[k]);
                    if (isMasked(data[k])) next[k] = "";
                });
                setS((prev) => ({ ...prev, ...next }));
                setSaved(flags);
            } catch {}
            await loadFailures(false);
            setLoaded(true);
        })();
        // eslint-disable-next-line
    }, [editLocId, scope]);

    const save = async (patch) => {
        try {
            const clean = Object.fromEntries(Object.entries(patch || {}).filter(([_, v]) => v !== "" && v !== undefined));
            if (Object.keys(clean).length === 0) {
                toast.info("Nothing to save");
                return;
            }
            const params = editLocId ? { location_id: editLocId } : {};
            await api.patch("/settings", clean, { params });
            toast.success(editLocId ? `Saved for ${activeLocName || "this location"}` : "Saved globally");
            const flags = { ...saved };
            Object.keys(clean).forEach((k) => { flags[k] = true; });
            setSaved(flags);
            const soundPatch = Object.fromEntries(
                Object.entries(clean).filter(([k]) => k.startsWith("sound_")).map(([k, v]) => [k.replace(/^sound_/, ""), v])
            );
            if (Object.keys(soundPatch).length) setSoundConfig(soundPatch);
        } catch { toast.error("Failed"); }
    };

    const clearOverride = async () => {
        if (!editLocId) return;
        if (!window.confirm(`Clear all per-location overrides for ${activeLocName}? It will fall back to the global settings.`)) return;
        try {
            await api.delete("/settings/override", { params: { location_id: editLocId } });
            toast.success("Cleared overrides");
            // reload
            const { data } = await api.get("/settings", { params: { location_id: editLocId } });
            const isMasked = (v) => typeof v === "string" && v.startsWith("•");
            const next = { ...data };
            ["slack_webhook_url", "teams_webhook_url", "whatsapp_token"].forEach((k) => { if (isMasked(data[k])) next[k] = ""; });
            setS((prev) => ({ ...prev, ...next }));
        } catch { toast.error("Failed"); }
    };

    const resolveFailure = async (id) => {
        try {
            await api.patch(`/settings/failed-dispatches/${id}/resolve`);
            await loadFailures();
        } catch { toast.error("Failed"); }
    };

    const clearFailures = async () => {
        if (!window.confirm("Clear all resolved failures?")) return;
        try {
            await api.delete("/settings/failed-dispatches?only_resolved=true");
            toast.success("Cleared");
            await loadFailures();
        } catch { toast.error("Failed"); }
    };

    if (!loaded) return null;

    return (
        <AppShell title="Notification Channels" subtitle="Webhooks & integrations">
            <div className="p-6 max-w-3xl space-y-6">
                {/* Scope banner — tells admin if they're editing global or a specific location */}
                <Card className={`p-4 border ${editLocId ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900" : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"}`} data-testid="settings-scope-banner">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 text-sm">
                            <ShieldCheck size={18} weight="duotone" className={editLocId ? "text-indigo-700 dark:text-indigo-300" : "text-amber-700 dark:text-amber-300"} />
                            {editLocId ? (
                                <span className="text-indigo-900 dark:text-indigo-200">
                                    Editing settings for <span className="font-semibold">{activeLocName || "this location"}</span>. Anything you leave blank inherits from <span className="font-semibold">Global</span>.
                                </span>
                            ) : (
                                <span className="text-amber-900 dark:text-amber-200">
                                    Editing <span className="font-semibold">Global defaults</span>. Changes apply to every location that doesn't have its own override.
                                </span>
                            )}
                        </div>
                        {isSuperAdmin && (
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => setScope("location")}
                                    className={`px-2.5 py-1 text-xs rounded-md border ${scope === "location" ? "bg-[#0055FF] text-white border-[#0055FF]" : "bg-white dark:bg-[#0B0D10] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800"}`}
                                    data-testid="settings-scope-location"
                                    disabled={!activeLocationId}
                                >
                                    This location
                                </button>
                                <button
                                    onClick={() => setScope("global")}
                                    className={`px-2.5 py-1 text-xs rounded-md border ${scope === "global" ? "bg-[#0055FF] text-white border-[#0055FF]" : "bg-white dark:bg-[#0B0D10] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800"}`}
                                    data-testid="settings-scope-global"
                                >
                                    Global defaults
                                </button>
                                {editLocId && (
                                    <Button size="sm" variant="ghost" onClick={clearOverride} className="text-xs text-red-600 hover:bg-red-50 ml-1" data-testid="settings-clear-override">
                                        <Trash size={14} className="mr-1" /> Clear override
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </Card>

                <Card className="p-5 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                        <ShieldCheck size={20} weight="duotone" />
                        <div className="text-sm">
                            New requests, escalations, visitor check-ins, and pre-orders trigger best-effort fan-out
                            to all configured channels below. Empty fields are skipped automatically.
                        </div>
                    </div>
                </Card>

                <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-2 mb-4">
                        <SlackLogo size={22} weight="duotone" color="#4A154B" />
                        <div className="font-display font-semibold text-lg">Slack</div>
                    </div>
                    <div className="space-y-3">
                        <div>
                            <Label>Incoming Webhook URL</Label>
                            <Input
                                placeholder={saved.slack_webhook_url ? "✓ Saved · paste a new URL to replace" : "https://hooks.slack.com/services/..."}
                                value={s.slack_webhook_url || ""}
                                onChange={(e) => setS({ ...s, slack_webhook_url: e.target.value })}
                                data-testid="settings-slack-input"
                            />
                            <div className="text-xs text-gray-500 mt-1">Slack › Apps › Incoming Webhooks › Add to workspace.</div>
                        </div>
                        <Button size="sm" onClick={() => save({ slack_webhook_url: s.slack_webhook_url })} className="bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="settings-slack-save">
                            <FloppyDisk size={14} className="mr-1" /> Save Slack
                        </Button>
                    </div>
                </Card>

                <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-2 mb-4">
                        <MicrosoftTeamsLogo size={22} weight="duotone" color="#6264A7" />
                        <div className="font-display font-semibold text-lg">Microsoft Teams</div>
                    </div>
                    <div className="space-y-3">
                        <div>
                            <Label>Incoming Webhook URL</Label>
                            <Input
                                placeholder={saved.teams_webhook_url ? "✓ Saved · paste a new URL to replace" : "https://outlook.office.com/webhook/..."}
                                value={s.teams_webhook_url || ""}
                                onChange={(e) => setS({ ...s, teams_webhook_url: e.target.value })}
                                data-testid="settings-teams-input"
                            />
                            <div className="text-xs text-gray-500 mt-1">Channel › Connectors › Incoming Webhook › Configure.</div>
                        </div>
                        <Button size="sm" onClick={() => save({ teams_webhook_url: s.teams_webhook_url })} className="bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="settings-teams-save">
                            <FloppyDisk size={14} className="mr-1" /> Save Teams
                        </Button>
                    </div>
                </Card>

                <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-2 mb-4">
                        <WhatsappLogo size={22} weight="duotone" color="#25D366" />
                        <div className="font-display font-semibold text-lg">WhatsApp Business (Meta Cloud API)</div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                            <Label>Access Token</Label>
                            <Input
                                type="password"
                                placeholder={saved.whatsapp_token ? "✓ Saved · paste new token to replace" : "EAAG..."}
                                value={s.whatsapp_token || ""}
                                onChange={(e) => setS({ ...s, whatsapp_token: e.target.value })}
                                data-testid="settings-wa-token-input"
                            />
                        </div>
                        <div>
                            <Label>Phone Number ID</Label>
                            <Input
                                placeholder="123456789012345"
                                value={s.whatsapp_phone_id || ""}
                                onChange={(e) => setS({ ...s, whatsapp_phone_id: e.target.value })}
                                data-testid="settings-wa-phone-input"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Label>Recipient (E.164)</Label>
                            <Input
                                placeholder="+91XXXXXXXXXX"
                                value={s.whatsapp_to || ""}
                                onChange={(e) => setS({ ...s, whatsapp_to: e.target.value })}
                                data-testid="settings-wa-to-input"
                            />
                        </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">developers.facebook.com › WhatsApp › Cloud API.</div>
                    <Button size="sm" onClick={() => save({ whatsapp_token: s.whatsapp_token, whatsapp_phone_id: s.whatsapp_phone_id, whatsapp_to: s.whatsapp_to })} className="bg-[#0055FF] hover:bg-[#0044CC] text-white mt-3" data-testid="settings-wa-save">
                        <FloppyDisk size={14} className="mr-1" /> Save WhatsApp
                    </Button>
                </Card>

                <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-2 mb-3">
                        <Envelope size={22} weight="duotone" color="#0055FF" />
                        <div className="font-display font-semibold text-lg">Email (coming soon)</div>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-gray-700 dark:text-gray-300">Send email digests to department leads</div>
                            <div className="text-xs text-gray-500">Requires email provider configuration on backend.</div>
                        </div>
                        <Switch checked={!!s.email_enabled} onCheckedChange={(v) => { setS({ ...s, email_enabled: v }); save({ email_enabled: v }); }} />
                    </div>
                </Card>

                {isSuperAdmin && (
                    <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800" data-testid="sound-settings-card">
                        <div className="flex items-center gap-2 mb-2">
                            <SpeakerHigh size={22} weight="duotone" color="#0055FF" />
                            <div className="font-display font-semibold text-lg">Notification sounds</div>
                            <span className="ml-2 text-[10px] font-semibold tracking-wider uppercase text-[#0055FF] bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 px-2 py-0.5 rounded-full">Super Admin</span>
                        </div>
                        <div className="text-xs text-gray-500 mb-4">
                            Choose a distinct sound for each lifecycle event. Click ▶ to preview. The same sound plays on staff dashboards and tablet kiosks.
                        </div>
                        <div className="space-y-3">
                            {SOUND_EVENTS.map((ev) => {
                                const current = s[ev.key] || DEFAULT_SOUND[ev.key];
                                return (
                                    <div key={ev.key} className="flex items-center gap-3" data-testid={`sound-row-${ev.key}`}>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{ev.label}</div>
                                            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-mono">{ev.key}</div>
                                        </div>
                                        <Select
                                            value={current}
                                            onValueChange={(v) => { setS({ ...s, [ev.key]: v }); setSoundConfig({ [ev.key.replace(/^sound_/, "")]: v }); }}
                                        >
                                            <SelectTrigger className="w-60 h-9 text-sm" data-testid={`sound-select-${ev.key}`}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {SOUND_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.key} value={opt.key} data-testid={`sound-opt-${ev.key}-${opt.key}`}>
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => playSoundByKey(current)}
                                            className="h-9"
                                            data-testid={`sound-preview-${ev.key}`}
                                            title="Preview"
                                        >
                                            <Play size={14} weight="fill" />
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                        <Button
                            size="sm"
                            onClick={() => save(Object.fromEntries(SOUND_EVENTS.map((e) => [e.key, s[e.key] || DEFAULT_SOUND[e.key]])))}
                            className="bg-[#0055FF] hover:bg-[#0044CC] text-white mt-4"
                            data-testid="sound-save-btn"
                        >
                            <FloppyDisk size={14} className="mr-1" /> Save sound choices
                        </Button>
                    </Card>
                )}

                {/* Visitor management */}
                <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800" data-testid="visitor-settings-card">
                    <div className="flex items-center gap-2 mb-2">
                        <ShieldCheck size={22} weight="duotone" color="#0055FF" />
                        <div className="font-display font-semibold text-lg">Visitor management</div>
                    </div>
                    <div className="text-xs text-gray-500 mb-4">
                        Control the self check-in experience for this {editLocId ? "location" : "tenant"}.
                    </div>
                    <div className="space-y-4">
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <Label className="text-sm font-medium">NDA / confidentiality notice</Label>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500">Require acceptance</span>
                                    <Switch
                                        checked={!!s.nda_required}
                                        onCheckedChange={(v) => setS({ ...s, nda_required: v })}
                                        data-testid="visitor-nda-required-switch"
                                    />
                                </div>
                            </div>
                            <textarea
                                value={s.nda_text || ""}
                                onChange={(e) => setS({ ...s, nda_text: e.target.value })}
                                rows={5}
                                placeholder="Paste the NDA text shown at self check-in. Leave empty to skip the NDA step."
                                className="w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0B0D10] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0055FF]/30 font-mono"
                                data-testid="visitor-nda-text-input"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label className="text-sm font-medium">Badge validity (hours)</Label>
                                <Input
                                    type="number"
                                    min={0.5}
                                    max={72}
                                    step={0.5}
                                    value={s.visitor_badge_hours ?? 8}
                                    onChange={(e) => setS({ ...s, visitor_badge_hours: parseFloat(e.target.value) })}
                                    className="mt-1"
                                    data-testid="visitor-badge-hours-input"
                                />
                                <div className="text-[10px] text-gray-500 mt-1">After this, the badge "Valid until" stamp expires.</div>
                            </div>
                        </div>
                        <Button
                            onClick={() => save({
                                nda_text: s.nda_text,
                                nda_required: !!s.nda_required,
                                visitor_badge_hours: s.visitor_badge_hours,
                            })}
                            className="bg-[#0055FF] hover:bg-[#0044CC] text-white"
                            data-testid="visitor-settings-save-btn"
                        >
                            <FloppyDisk size={14} className="mr-1" /> Save visitor settings
                        </Button>
                    </div>
                </Card>

                <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Warning size={22} weight="duotone" color={failures.filter((f) => !f.resolved).length > 0 ? "#E53935" : "#71717A"} />
                            <div className="font-display font-semibold text-lg">Failed dispatches</div>
                            {failures.filter((f) => !f.resolved).length > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">
                                    {failures.filter((f) => !f.resolved).length} open
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button size="sm" variant="ghost" onClick={() => { const next = !showResolved; setShowResolved(next); loadFailures(next); }} className="text-xs" data-testid="failures-toggle-resolved">
                                {showResolved ? "Hide resolved" : "Show resolved"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={clearFailures} className="text-xs" data-testid="failures-clear-btn">
                                <Trash size={12} className="mr-1" /> Clear resolved
                            </Button>
                        </div>
                    </div>
                    {failures.length === 0 ? (
                        <div className="text-sm text-gray-500 py-6 text-center">No failures recorded.</div>
                    ) : (
                        <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="failures-list">
                            {failures.map((f) => (
                                <li key={f.id} className="py-3 flex items-start gap-3" data-testid={`failure-${f.id}`}>
                                    <span className={`mt-0.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${f.resolved ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                                        {f.channel}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{f.event}</div>
                                        <div className="text-xs text-gray-500 truncate font-mono">{f.error}</div>
                                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">{new Date(f.created_at).toLocaleString()}</div>
                                    </div>
                                    {!f.resolved && (
                                        <Button size="sm" variant="ghost" onClick={() => resolveFailure(f.id)} className="text-emerald-700 hover:bg-emerald-50 h-8" data-testid={`failure-${f.id}-resolve-btn`}>
                                            <CheckCircle size={14} className="mr-1" /> Mark resolved
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
        </AppShell>
    );
}
