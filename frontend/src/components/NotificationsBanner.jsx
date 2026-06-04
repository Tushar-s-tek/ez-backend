import React, { useEffect, useState } from "react";
import { Bell, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ensureNotificationPermission } from "@/lib/notify";

/**
 * Renders a small banner prompting the staff member to allow browser
 * notifications. Disappears once permission is granted/denied or the user
 * dismisses it. We persist dismissals in localStorage so it doesn't nag.
 */
export default function NotificationsBanner() {
    const [perm, setPerm] = useState(() => {
        if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
        return Notification.permission;
    });
    const [dismissed, setDismissed] = useState(() => {
        try { return localStorage.getItem("sw_notif_banner_dismissed") === "1"; } catch { return false; }
    });

    useEffect(() => {
        // Periodically re-check (the user might have granted via browser UI without our prompt)
        const id = setInterval(() => {
            if (typeof window !== "undefined" && "Notification" in window) {
                setPerm(Notification.permission);
            }
        }, 2000);
        return () => clearInterval(id);
    }, []);

    if (perm === "granted" || perm === "denied" || perm === "unsupported" || dismissed) return null;

    const enable = async () => {
        const result = await ensureNotificationPermission();
        setPerm(result);
    };
    const dismiss = () => {
        try { localStorage.setItem("sw_notif_banner_dismissed", "1"); } catch {}
        setDismissed(true);
    };

    return (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-4 flex items-center gap-3" data-testid="notifications-banner">
            <Bell size={20} weight="duotone" className="text-[#0055FF] shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
                <div className="font-semibold text-gray-900 dark:text-gray-100">Enable desktop notifications</div>
                <div className="text-gray-600 dark:text-gray-400 text-xs">
                    Get alerted on every new order or request — even when this tab is in the background.
                </div>
            </div>
            <Button
                size="sm"
                onClick={enable}
                className="bg-[#0055FF] hover:bg-[#0044CC] text-white shrink-0"
                data-testid="notifications-enable-btn"
            >Enable</Button>
            <button
                onClick={dismiss}
                className="text-gray-400 hover:text-gray-600 p-1 shrink-0"
                aria-label="Dismiss"
                data-testid="notifications-dismiss-btn"
            ><X size={14} /></button>
        </Card>
    );
}
