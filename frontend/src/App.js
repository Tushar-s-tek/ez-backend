import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LocationProvider } from "@/lib/location";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";
import Landing from "@/pages/Landing";
import StaffLogin from "@/pages/StaffLogin";
import RoomKiosk from "@/pages/RoomKiosk";
import RoomOrder from "@/pages/RoomOrder";
import RoomControls from "@/pages/RoomControls";
import StaffDashboard from "@/pages/StaffDashboard";
import AdminRooms from "@/pages/AdminRooms";
import AdminCategories from "@/pages/AdminCategories";
import AdminUsers from "@/pages/AdminUsers";
import AdminRouting from "@/pages/AdminRouting";
import AdminAnalytics from "@/pages/AdminAnalytics";
import AdminDepartments from "@/pages/AdminDepartments";
import AdminMenu from "@/pages/AdminMenu";
import AdminSettings from "@/pages/AdminSettings";
import AdminVisitors from "@/pages/AdminVisitors";
import AdminPreorders from "@/pages/AdminPreorders";
import AdminLocations from "@/pages/AdminLocations";
import VisitorCheckin from "@/pages/VisitorCheckin";
import RoomShortRedirect from "@/pages/RoomShortRedirect";

function Protected({ children, roles }) {
    const { user, loading } = useAuth();
    if (loading) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>;
    if (!user) return <Navigate to="/login" replace />;
    if (roles && !roles.includes(user.role) && user.role !== "super_admin") {
        return <Navigate to="/dashboard" replace />;
    }
    return children;
}

function App() {
    return (
        <ThemeProvider>
            <I18nProvider>
                <AuthProvider>
                    <LocationProvider>
                        <BrowserRouter>
                            <Routes>
                                <Route path="/" element={<Landing />} />
                                <Route path="/login" element={<StaffLogin />} />
                                <Route path="/room" element={<RoomKiosk />} />
                                <Route path="/r/:code" element={<RoomShortRedirect />} />
                                <Route path="/room/:pin" element={<RoomKiosk />} />
                                <Route path="/room/:pin/order" element={<RoomOrder />} />
                                <Route path="/room/:pin/controls" element={<RoomControls />} />
                                <Route path="/visitors/checkin" element={<VisitorCheckin />} />
                                <Route path="/dashboard" element={<Protected><StaffDashboard /></Protected>} />
                                <Route path="/visitors" element={<Protected><AdminVisitors /></Protected>} />
                                <Route path="/orders" element={<Protected><AdminPreorders /></Protected>} />
                                <Route path="/admin/rooms" element={<Protected roles={["admin", "super_admin"]}><AdminRooms /></Protected>} />
                                <Route path="/admin/categories" element={<Protected roles={["admin", "super_admin"]}><AdminCategories /></Protected>} />
                                <Route path="/admin/departments" element={<Protected roles={["admin", "super_admin"]}><AdminDepartments /></Protected>} />
                                <Route path="/admin/users" element={<Protected roles={["admin", "super_admin"]}><AdminUsers /></Protected>} />
                                <Route path="/admin/routing" element={<Protected roles={["admin", "super_admin"]}><AdminRouting /></Protected>} />
                                <Route path="/admin/menu" element={<Protected roles={["admin", "super_admin"]}><AdminMenu /></Protected>} />
                                <Route path="/admin/settings" element={<Protected roles={["admin", "super_admin"]}><AdminSettings /></Protected>} />
                                <Route path="/admin/locations" element={<Protected roles={["super_admin"]}><AdminLocations /></Protected>} />
                                <Route path="/admin/analytics" element={<Protected><AdminAnalytics /></Protected>} />
                                <Route path="*" element={<Navigate to="/" replace />} />
                            </Routes>
                            <Toaster position="top-right" richColors />
                        </BrowserRouter>
                    </LocationProvider>
                </AuthProvider>
            </I18nProvider>
        </ThemeProvider>
    );
}

export default App;
