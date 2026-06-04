// Cross-tab background notification helper.
// Uses the browser's native Web Notifications API so staff get OS-level
// alerts even when the tab is in the background, behind other windows, or
// throttled. Also flashes the page title with a pending count so the user's
// peripheral vision catches it in the tab bar.

let pendingCount = 0;
let titleResetTimer = null;
let originalTitle = null;

function rememberTitle() {
    if (originalTitle == null) originalTitle = document.title;
}

function paintTitle() {
    rememberTitle();
    const isHidden = document.visibilityState === "hidden";
    const isUnfocused = typeof document.hasFocus === "function" && !document.hasFocus();
    if (pendingCount > 0 && (isHidden || isUnfocused)) {
        document.title = `(${pendingCount}) ${originalTitle}`;
    } else {
        document.title = originalTitle;
    }
}

function isQuietPath() {
    // Don't bother showing browser notifications on routes that aren't
    // staff/admin dashboards (e.g. /login, /room/:pin kiosk, /visitors/checkin).
    const p = window.location.pathname || "";
    return (
        p === "/" || p === "/login" || p.startsWith("/room") || p.startsWith("/visitors/checkin")
    );
}

/**
 * Ask the user once for permission to show notifications. Safe to call
 * multiple times — only prompts when permission is "default".
 */
export async function ensureNotificationPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted" || Notification.permission === "denied") {
        return Notification.permission;
    }
    try {
        return await Notification.requestPermission();
    } catch {
        return Notification.permission;
    }
}

/**
 * Show a system-level notification when the tab/window is NOT in the
 * foreground. Also increments the tab-title badge count.
 *
 *   title: short label (e.g. "New food order")
 *   body:  details (e.g. "CEO Cabin · ₹150")
 *   tag:   coalesce multiple notifications with the same tag (e.g. request id)
 *   onClick: optional handler — focuses the window and runs the callback
 */
export function notifyBackground({ title, body, tag, onClick }) {
    if (typeof window === "undefined") return;
    if (isQuietPath()) return;
    // Fire whenever the window isn't actively focused — covers:
    //   - tab in background (visibilityState === "hidden")
    //   - browser window minimised
    //   - another app focused over the browser
    const isHidden = document.visibilityState === "hidden";
    const isUnfocused = typeof document.hasFocus === "function" && !document.hasFocus();
    if (!isHidden && !isUnfocused) return;

    pendingCount += 1;
    paintTitle();

    if ("Notification" in window && Notification.permission === "granted") {
        try {
            const n = new Notification(title, { body, tag, renotify: true, icon: "/tekwissen-logo.jpg" });
            n.onclick = () => {
                try { window.focus(); } catch {}
                try { n.close(); } catch {}
                if (typeof onClick === "function") onClick();
            };
        } catch {}
    }
}

/**
 * Reset the pending-count badge — call when the user returns to the tab
 * (visibilitychange → "visible").
 */
export function clearPendingBadge() {
    pendingCount = 0;
    paintTitle();
}

// Auto-clear the badge when the user returns focus to the tab.
if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") clearPendingBadge();
        else paintTitle();
    });
    window.addEventListener("focus", () => clearPendingBadge());
    window.addEventListener("blur", () => paintTitle());
}
