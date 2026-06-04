import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ForkKnife, Plus, Minus, House, ArrowLeft, CheckCircle, ShoppingCart, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { PhosphorIcon } from "@/components/PhosphorIcon";
import { useI18n } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import BrandLogo from "@/components/BrandLogo";
import { playEventSound, setSoundConfig } from "@/lib/sound";

export default function RoomOrder() {
    const { pin } = useParams();
    const navigate = useNavigate();
    const { t } = useI18n();
    const [room, setRoom] = useState(null);
    const [menu, setMenu] = useState([]);
    const [cart, setCart] = useState({}); // id -> qty
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.post("/rooms/access", { pin });
                setRoom(data);
            } catch {
                toast.error("Invalid PIN");
                navigate("/");
            }
        })();
    }, [pin, navigate]);

    useEffect(() => {
        if (!room) return;
        (async () => {
            try {
                const { data } = await api.get("/settings/sounds", { params: { location_id: room.location_id } });
                const map = Object.fromEntries(
                    Object.entries(data || {}).filter(([_, v]) => v).map(([k, v]) => [k.replace(/^sound_/, ""), v])
                );
                if (Object.keys(map).length) setSoundConfig(map);
            } catch {}
        })();
    }, [room]);

    useEffect(() => {
        if (!room) return;
        (async () => {
            const { data } = await api.get("/menu", {
                params: { available_only: true, location_id: room.location_id },
            });
            setMenu(data);
        })();
    }, [room]);

    const groups = useMemo(() => Array.from(new Set(menu.map((m) => m.category))), [menu]);
    const total = useMemo(() => {
        return Object.entries(cart).reduce((sum, [id, qty]) => {
            const item = menu.find((m) => m.id === id);
            return sum + (item ? item.price * qty : 0);
        }, 0);
    }, [cart, menu]);

    const add = (id) => setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    const remove = (id) =>
        setCart((c) => {
            const q = (c[id] || 0) - 1;
            const next = { ...c };
            if (q <= 0) delete next[id];
            else next[id] = q;
            return next;
        });

    const placeOrder = async () => {
        if (!room || Object.keys(cart).length === 0) return;
        setBusy(true);
        try {
            const items = Object.entries(cart).map(([id, qty]) => {
                const m = menu.find((x) => x.id === id);
                return { menu_item_id: id, name: m.name, qty, price: m.price };
            });
            await api.post("/preorders", { room_id: room.id, pin, items });
            playEventSound("new_order");
            toast.success("Order placed!");
            setCart({});
        } catch (e) {
            toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed");
        } finally {
            setBusy(false);
        }
    };

    if (!room) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>;

    return (
        <div className="min-h-screen bg-white dark:bg-[#0B0D10] flex flex-col">
            <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0B0D10]">
                <div className="max-w-[1400px] mx-auto px-8 pt-5 pb-2 flex items-center justify-between">
                    <BrandLogo height={32} />
                    <div className="flex items-center gap-3">
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </div>
                <div className="max-w-[1400px] mx-auto px-8 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" onClick={() => navigate(`/room/${pin}`)} className="text-gray-500" data-testid="order-back-btn">
                            <ArrowLeft size={18} className="mr-1" /> Back
                        </Button>
                        <div>
                            <div className="label-eyebrow text-gray-500">{room.name}</div>
                            <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                                {t("kiosk.mode_order")}
                            </h1>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-[1400px] mx-auto px-8 py-8 w-full grid lg:grid-cols-3 gap-8">
                {/* Menu */}
                <div className="lg:col-span-2 space-y-8">
                    {groups.map((g) => (
                        <section key={g}>
                            <div className="label-eyebrow mb-3">{g}</div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {menu.filter((m) => m.category === g).map((m) => {
                                    const qty = cart[m.id] || 0;
                                    return (
                                        <Card key={m.id} className="p-4 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800 flex items-center gap-3" data-testid={`menu-item-${m.id}`}>
                                            <div className="w-12 h-12 rounded-lg grid place-items-center" style={{ backgroundColor: `${m.color}15` }}>
                                                <PhosphorIcon name={m.icon} size={26} weight="duotone" color={m.color} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-gray-900 dark:text-gray-100">{m.name}</div>
                                                <div className="text-xs text-gray-500 truncate">{m.description}</div>
                                                <div className="font-mono text-sm text-gray-700 dark:text-gray-300 mt-1">₹ {m.price.toFixed(0)}</div>
                                            </div>
                                            {qty === 0 ? (
                                                <Button size="sm" onClick={() => add(m.id)} className="bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid={`menu-${m.id}-add-btn`}>
                                                    <Plus size={14} className="mr-1" /> Add
                                                </Button>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <Button size="icon" variant="outline" onClick={() => remove(m.id)} className="h-8 w-8"><Minus size={14} /></Button>
                                                    <span className="font-mono w-6 text-center font-semibold">{qty}</span>
                                                    <Button size="icon" variant="outline" onClick={() => add(m.id)} className="h-8 w-8"><Plus size={14} /></Button>
                                                </div>
                                            )}
                                        </Card>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>

                {/* Cart */}
                <aside className="lg:sticky lg:top-8 self-start">
                    <Card className="p-5 bg-white dark:bg-[#111418] border-gray-200 dark:border-gray-800">
                        <div className="flex items-center gap-2 mb-4">
                            <ShoppingCart size={20} weight="duotone" color="#0055FF" />
                            <div className="font-display font-semibold text-lg text-gray-900 dark:text-gray-100">{t("kiosk.cart")}</div>
                            <Badge className="ml-auto bg-blue-50 text-blue-700 border border-blue-200">{Object.values(cart).reduce((a, b) => a + b, 0)} items</Badge>
                        </div>
                        {Object.keys(cart).length === 0 ? (
                            <div className="text-sm text-gray-500 py-8 text-center">{t("kiosk.empty_cart")}</div>
                        ) : (
                            <>
                                <ul className="divide-y divide-gray-100 dark:divide-gray-800 mb-4">
                                    {Object.entries(cart).map(([id, qty]) => {
                                        const m = menu.find((x) => x.id === id);
                                        if (!m) return null;
                                        return (
                                            <li key={id} className="flex items-center gap-2 py-2 text-sm">
                                                <span className="flex-1 text-gray-700 dark:text-gray-300">{m.name}</span>
                                                <span className="font-mono text-gray-500">×{qty}</span>
                                                <span className="font-mono font-medium w-16 text-right text-gray-900 dark:text-gray-100">₹{(m.price * qty).toFixed(0)}</span>
                                            </li>
                                        );
                                    })}
                                </ul>
                                <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-800">
                                    <span className="label-eyebrow">Total</span>
                                    <span className="font-display font-bold text-2xl text-gray-900 dark:text-gray-100">₹{total.toFixed(0)}</span>
                                </div>
                                <Button disabled={busy} onClick={placeOrder} className="w-full mt-4 h-11 bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="order-place-btn">
                                    {busy ? "Placing…" : t("kiosk.checkout")} <CheckCircle size={16} className="ml-1" />
                                </Button>
                            </>
                        )}
                    </Card>
                </aside>
            </main>
        </div>
    );
}
