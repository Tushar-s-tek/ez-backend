import React from "react";
import { NavLink, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
    ChartBar, ClipboardText, Door, Users, Plugs, SignOut, GearSix, Tag,
    UserList, ForkKnife, Storefront, Bell, Stack, MapPin,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import LocationSwitcher from "@/components/LocationSwitcher";
import BrandLogo from "@/components/BrandLogo";

const NAV_BASE = [
    { to: "/dashboard", label: "Live Queue", icon: ClipboardText, roles: ["all"] },
    { to: "/visitors", label: "Visitors", icon: UserList, roles: ["all"] },
    { to: "/orders", label: "Pre-orders", icon: ForkKnife, roles: ["all"] },
    { to: "/admin/analytics", label: "Analytics", icon: ChartBar, roles: ["all"] },
];

const NAV_ADMIN = [
    { to: "/admin/rooms", label: "Rooms", icon: Door, roles: ["admin", "super_admin"] },
    { to: "/admin/departments", label: "Departments", icon: Stack, roles: ["admin", "super_admin"] },
    { to: "/admin/categories", label: "Categories", icon: Tag, roles: ["admin", "super_admin"] },
    { to: "/admin/routing", label: "Routing", icon: Plugs, roles: ["admin", "super_admin"] },
    { to: "/admin/menu", label: "Menu", icon: Storefront, roles: ["admin", "super_admin"] },
    { to: "/admin/users", label: "Users", icon: Users, roles: ["admin", "super_admin"] },
    { to: "/admin/settings", label: "Notifications", icon: Bell, roles: ["admin", "super_admin"] },
];

const NAV_SUPER_ADMIN = [
    { to: "/admin/locations", label: "Locations", icon: MapPin, roles: ["super_admin"] },
];

export default function AppShell({ children, title, subtitle, actions }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const isAdmin = user && (user.role === "admin" || user.role === "super_admin");
    const isSuperAdmin = user && user.role === "super_admin";

    const initials = (user?.name || "U")
        .split(" ")
        .map((s) => s[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    return (
        <div className="h-screen bg-[#F8F9FA] dark:bg-[#0F1116] flex overflow-hidden">
            {/* Sidebar */}
            <aside className="hidden md:flex w-64 shrink-0 flex-col bg-white dark:bg-[#0B0D10] border-r border-gray-200 dark:border-gray-800 h-full">
                <Link to="/dashboard" className="px-6 h-16 flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
                    <BrandLogo height={36} />
                </Link>

                <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto scrollbar-thin">
                    <div className="label-eyebrow px-3 mb-2">Operations</div>
                    {NAV_BASE.map((item) => (
                        <NavItem key={item.to} {...item} />
                    ))}
                    {isAdmin && (
                        <>
                            <div className="label-eyebrow px-3 mt-6 mb-2">Configure</div>
                            {NAV_ADMIN.map((item) => (
                                <NavItem key={item.to} {...item} />
                            ))}
                        </>
                    )}
                    {isSuperAdmin && (
                        <>
                            <div className="label-eyebrow px-3 mt-6 mb-2">Tenant</div>
                            {NAV_SUPER_ADMIN.map((item) => (
                                <NavItem key={item.to} {...item} />
                            ))}
                        </>
                    )}
                </nav>

                <div className="border-t border-gray-200 dark:border-gray-800 p-3 shrink-0">
                    <div className="flex items-center gap-3 px-2 py-2">
                        <Avatar className="w-9 h-9">
                            <AvatarFallback className="bg-[#0055FF] text-white text-xs font-semibold">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user?.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate capitalize">{user?.role?.replace("_", " ")}</div>
                        </div>
                    </div>
                    <Button
                        onClick={async () => { await logout(); navigate("/login"); }}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start mt-1 text-gray-600 dark:text-gray-300"
                        data-testid="appshell-logout-btn"
                    >
                        <SignOut size={16} className="mr-2" /> Sign out
                    </Button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                <header className="h-16 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0B0D10] flex items-center justify-between px-6 shrink-0">
                    <div className="min-w-0">
                        <div className="label-eyebrow truncate">{subtitle || "EZ Workplace"}</div>
                        <h1 className="font-display text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 truncate">{title}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {actions}
                        <LocationSwitcher />
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </header>
                <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
            </div>
        </div>
    );
}

function NavItem({ to, label, icon: Icon }) {
    return (
        <NavLink
            to={to}
            end
            className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? "bg-blue-50 dark:bg-blue-950/40 text-[#0055FF] dark:text-blue-400" : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900"
                }`
            }
            data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
            <Icon size={18} weight="regular" />
            {label}
        </NavLink>
    );
}
