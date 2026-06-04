import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { QrCode, SignIn, ArrowRight, ShieldCheck, Lightning, ChartBar } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import BrandLogo from "@/components/BrandLogo";

export default function Landing() {
    const navigate = useNavigate();
    const [pin, setPin] = useState("");
    const [busy, setBusy] = useState(false);

    const handlePinSubmit = async (e) => {
        e.preventDefault();
        if (!pin || pin.length < 4) {
            toast.error("Enter a valid room PIN");
            return;
        }
        setBusy(true);
        try {
            const { data } = await api.post("/rooms/access", { pin });
            sessionStorage.setItem(`room_${data.id}`, JSON.stringify(data));
            navigate(`/room/${pin}`);
        } catch (e) {
            toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Invalid PIN");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen bg-white">
            {/* Top nav */}
            <nav className="border-b border-gray-200 bg-white">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <BrandLogo height={36} />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("/login")}
                        data-testid="landing-staff-login-btn"
                        className="font-medium"
                    >
                        Staff sign in <ArrowRight size={16} className="ml-1" />
                    </Button>
                </div>
            </nav>

            {/* Hero */}
            <section className="max-w-7xl mx-auto px-6 pt-16 pb-12">
                <div className="grid lg:grid-cols-12 gap-12 items-start">
                    <div className="lg:col-span-7">
                        <div className="label-eyebrow mb-4">TekWissen — EZ Workplace</div>
                        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 leading-[1.05]">
                            One-touch service for every room, cabin & hall.
                        </h1>
                        <p className="mt-6 text-lg text-gray-600 max-w-2xl leading-relaxed">
                            Replace calls, walk-ins and chat pings with a calm, intelligent request system.
                            Coffee, IT support, AC adjustments — routed instantly to the right team.
                        </p>

                        <div className="mt-10 grid sm:grid-cols-3 gap-3 max-w-2xl">
                            <FeatureCard icon={<Lightning size={22} weight="duotone" color="#0055FF" />} title="Real-time" desc="Live request queue with WebSocket updates" />
                            <FeatureCard icon={<ShieldCheck size={22} weight="duotone" color="#00B368" />} title="Role-based" desc="Reception, Cafeteria, IT, Facilities, Security" />
                            <FeatureCard icon={<ChartBar size={22} weight="duotone" color="#7C3AED" />} title="Analytics" desc="Response times, top items, peak hours" />
                        </div>
                    </div>

                    {/* Room access card */}
                    <div className="lg:col-span-5">
                        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-lg bg-blue-50 grid place-items-center">
                                    <QrCode size={22} weight="duotone" color="#0055FF" />
                                </div>
                                <div>
                                    <div className="font-display font-semibold text-gray-900">Room Access</div>
                                    <div className="text-xs text-gray-500">For tablets in meeting rooms</div>
                                </div>
                            </div>

                            <form onSubmit={handlePinSubmit} className="space-y-4" data-testid="landing-pin-form">
                                <div>
                                    <label className="label-eyebrow block mb-2">Enter Room PIN</label>
                                    <Input
                                        type="text"
                                        value={pin}
                                        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                                        placeholder="000000"
                                        className="text-2xl font-mono tracking-[0.4em] text-center h-14 border-2 focus-visible:ring-[#0055FF] focus-visible:border-[#0055FF]"
                                        data-testid="landing-pin-input"
                                        autoFocus
                                        inputMode="numeric"
                                    />
                                </div>
                                <Button
                                    type="submit"
                                    disabled={busy}
                                    className="w-full h-12 bg-[#0055FF] hover:bg-[#0044CC] text-white font-medium text-base"
                                    data-testid="landing-pin-submit-btn"
                                >
                                    {busy ? "Verifying…" : "Access Room"} <ArrowRight size={18} className="ml-2" />
                                </Button>
                            </form>

                            <div className="mt-6 pt-6 border-t border-gray-100">
                                <div className="text-xs text-gray-500">
                                    Or scan the QR code on your room's tablet to begin.
                                </div>
                                <div className="mt-2 text-xs font-mono text-gray-400">
                                    Demo PIN: <span className="text-gray-700">123456</span> (CEO Cabin)
                                </div>
                            </div>
                        </div>

                        <Button
                            variant="outline"
                            onClick={() => navigate("/login")}
                            className="mt-4 w-full h-12 border-gray-200 hover:bg-gray-50"
                            data-testid="landing-staff-cta-btn"
                        >
                            <SignIn size={18} className="mr-2" /> Staff & Admin Sign In
                        </Button>
                    </div>
                </div>
            </section>

            <footer className="border-t border-gray-200 mt-16">
                <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-gray-500">
                    <div>© TekWissen · EZ Workplace</div>
                    <div className="font-mono">v1.0</div>
                </div>
            </footer>
        </div>
    );
}

function FeatureCard({ icon, title, desc }) {
    return (
        <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <div className="mb-2">{icon}</div>
            <div className="font-display font-semibold text-sm text-gray-900">{title}</div>
            <div className="text-xs text-gray-500 mt-1 leading-snug">{desc}</div>
        </div>
    );
}
