import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Lightbulb, Snowflake, Sun, ProjectorScreen, House, ThermometerSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { api } from "@/lib/api";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import BrandLogo from "@/components/BrandLogo";
import { useI18n } from "@/lib/i18n";

const DEVICES = [
    { id: "ac", label: "AC", icon: ThermometerSimple, color: "#0891B2", actions: [
        { action: "on", label: "On" }, { action: "off", label: "Off" },
        { action: "temp_down", label: "Cool ▾" }, { action: "temp_up", label: "Warm ▴" },
    ]},
    { id: "light", label: "Lights", icon: Lightbulb, color: "#FBBF24", actions: [
        { action: "on", label: "On" }, { action: "off", label: "Off" },
        { action: "dim", label: "Dim" }, { action: "bright", label: "Bright" },
    ]},
    { id: "projector", label: "Projector", icon: ProjectorScreen, color: "#7C3AED", actions: [
        { action: "on", label: "On" }, { action: "off", label: "Off" },
    ]},
    { id: "blinds", label: "Blinds", icon: Sun, color: "#EA580C", actions: [
        { action: "up", label: "Up" }, { action: "down", label: "Down" },
    ]},
];

export default function RoomControls() {
    const { pin } = useParams();
    const navigate = useNavigate();
    const { t } = useI18n();
    const [room, setRoom] = useState(null);
    const [busy, setBusy] = useState(null);
    const [history, setHistory] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.post("/rooms/access", { pin });
                setRoom(data);
            } catch { navigate("/"); }
        })();
    }, [pin, navigate]);

    const cmd = async (device, action) => {
        if (!room) return;
        const key = `${device}-${action}`;
        setBusy(key);
        try {
            await api.post("/iot/command", { room_id: room.id, pin, device, action });
            setHistory((h) => [{ device, action, at: new Date().toLocaleTimeString() }, ...h].slice(0, 8));
            toast.success(`${device.toUpperCase()} → ${action}`);
        } catch (e) {
            toast.error("Command failed");
        } finally {
            setBusy(null);
        }
    };

    if (!room) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>;

    return (
        <div className="min-h-screen bg-white dark:bg-[#0B0D10] flex flex-col">
            <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0B0D10]">
                <div className="max-w-[1400px] mx-auto px-8 pt-5 pb-2 flex items-center justify-between">
                    <BrandLogo height={32} />
                    <div className="flex items-center gap-3"><LanguageToggle /><ThemeToggle /></div>
                </div>
                <div className="max-w-[1400px] mx-auto px-8 py-3 flex items-center">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" onClick={() => navigate(`/room/${pin}`)} className="text-gray-500" data-testid="controls-back-btn">
                            <ArrowLeft size={18} className="mr-1" /> Back
                        </Button>
                        <div>
                            <div className="label-eyebrow text-gray-500">{room.name}</div>
                            <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                                {t("kiosk.mode_controls")}
                            </h1>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-[1400px] mx-auto px-8 py-8 w-full grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 grid sm:grid-cols-2 gap-4">
                    {DEVICES.map((d) => (
                        <Card key={d.id} className="p-6 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800" data-testid={`controls-device-${d.id}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 rounded-xl grid place-items-center" style={{ backgroundColor: `${d.color}15` }}>
                                    <d.icon size={26} weight="duotone" color={d.color} />
                                </div>
                                <div className="font-display font-semibold text-lg text-gray-900 dark:text-gray-100">{d.label}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {d.actions.map((a) => (
                                    <Button
                                        key={a.action}
                                        variant="outline"
                                        disabled={busy === `${d.id}-${a.action}`}
                                        onClick={() => cmd(d.id, a.action)}
                                        className="h-12 dark:border-gray-700"
                                        data-testid={`controls-${d.id}-${a.action}-btn`}
                                    >
                                        {a.label}
                                    </Button>
                                ))}
                            </div>
                        </Card>
                    ))}
                </div>

                <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800 h-fit">
                    <div className="label-eyebrow mb-3">Recent commands</div>
                    {history.length === 0 ? (
                        <div className="text-sm text-gray-500 py-8 text-center">No commands yet</div>
                    ) : (
                        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                            {history.map((h, i) => (
                                <li key={i} className="py-2 text-sm flex items-center justify-between">
                                    <span className="text-gray-700 dark:text-gray-300 capitalize">{h.device} · {h.action}</span>
                                    <span className="font-mono text-xs text-gray-500">{h.at}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 leading-relaxed">
                        Commands are logged and broadcast as <code className="font-mono">iot:command</code> socket events.
                        Connect MQTT, Home Assistant, or vendor SDKs in <code className="font-mono">dispatch</code>.
                    </div>
                </Card>
            </main>
        </div>
    );
}
