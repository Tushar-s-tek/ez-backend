import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, SignIn } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { formatApiErrorDetail } from "@/lib/api";
import BrandLogo from "@/components/BrandLogo";

export default function StaffLogin() {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [email, setEmail] = useState("admin@workplace.com");
    const [password, setPassword] = useState("admin123");
    const [busy, setBusy] = useState(false);

    const onSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            const u = await login(email.trim().toLowerCase(), password);
            toast.success(`Welcome back, ${u.name}`);
            navigate("/dashboard");
        } catch (err) {
            toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Login failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen grid lg:grid-cols-2 bg-white">
            {/* Visual half */}
            <div className="hidden lg:block relative bg-gray-900 overflow-hidden">
                <img
                    src="https://images.unsplash.com/photo-1497366811353-6870744d04b2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBvZmZpY2UlMjBhcmNoaXRlY3R1cmUlMjBpbnRlcmlvcnxlbnwwfHx8fDE3Nzg4NDU0MDJ8MA&ixlib=rb-4.1.0&q=85"
                    alt="Office"
                    className="absolute inset-0 w-full h-full object-cover opacity-70"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/20 to-black/60" />
                <div className="relative h-full flex flex-col justify-between p-12 text-white">
                    <Link to="/" className="flex items-center gap-2 w-fit" data-testid="login-home-link">
                        <BrandLogo height={40} variant="light" />
                    </Link>
                    <div className="space-y-4 max-w-md">
                        <div className="label-eyebrow text-white/70">Operations Console</div>
                        <h2 className="font-display text-4xl font-semibold leading-tight">
                            Calm command for the busiest floors.
                        </h2>
                        <p className="text-white/80 text-base leading-relaxed">
                            Accept, track, and close service requests across departments — all from one fast,
                            keyboard-friendly dashboard.
                        </p>
                    </div>
                </div>
            </div>

            {/* Form half */}
            <div className="flex flex-col">
                <div className="px-8 py-6 border-b border-gray-100">
                    <Link to="/" className="text-sm text-gray-500 hover:text-gray-900 inline-flex items-center gap-2" data-testid="login-back-link">
                        <ArrowLeft size={16} /> Back to home
                    </Link>
                </div>
                <div className="flex-1 grid place-items-center px-6 py-12">
                    <div className="w-full max-w-md">
                        <div className="label-eyebrow mb-2">Staff sign in</div>
                        <h1 className="font-display text-3xl font-bold tracking-tight text-gray-900">Welcome back</h1>
                        <p className="text-gray-500 mt-2 text-sm">Use your work email to access your dashboard.</p>

                        <form onSubmit={onSubmit} className="mt-8 space-y-5" data-testid="login-form">
                            <div>
                                <Label htmlFor="email" className="text-xs uppercase tracking-wider text-gray-600 font-semibold">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@company.com"
                                    className="mt-2 h-11"
                                    required
                                    data-testid="login-email-input"
                                />
                            </div>
                            <div>
                                <Label htmlFor="password" className="text-xs uppercase tracking-wider text-gray-600 font-semibold">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="mt-2 h-11"
                                    required
                                    data-testid="login-password-input"
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={busy}
                                className="w-full h-11 bg-[#0055FF] hover:bg-[#0044CC] text-white font-medium"
                                data-testid="login-submit-btn"
                            >
                                {busy ? "Signing in…" : <>Sign in <SignIn size={18} className="ml-2" /></>}
                            </Button>
                        </form>

                        <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
                            <div className="font-semibold text-gray-900 mb-2">Demo accounts</div>
                            <div className="font-mono space-y-0.5">
                                <div>admin@workplace.com / admin123</div>
                                <div>reception@workplace.com / demo123</div>
                                <div>cafeteria@workplace.com / demo123</div>
                                <div>it@workplace.com / demo123</div>
                                <div>facilities@workplace.com / demo123</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
