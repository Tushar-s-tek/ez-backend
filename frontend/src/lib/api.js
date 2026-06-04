import axios from "axios";
import { getActiveLocationId, getUserRole } from "./location_holder";
import { getToken } from "./token";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
    baseURL: API,
    withCredentials: false,
});

// Endpoints that accept ?location_id= and benefit from auto-scoping
const SCOPED_GET_PREFIXES = [
    "/rooms",
    "/requests",
    "/categories",
    "/departments",
    "/routing-rules",
    "/users",
    "/menu",
    "/preorders",
    "/visitors",
    "/iot/commands",
    "/analytics/overview",
    "/analytics/export.csv",
];

// Endpoints whose POST body should carry location_id (super_admin creating tenant resources)
const TENANT_CREATE_POST_PATHS = ["/rooms", "/categories", "/departments", "/menu", "/users"];

function pathMatches(url, prefixes) {
    if (!url) return false;
    // strip leading slash variants and query
    const clean = url.split("?")[0];
    return prefixes.some((p) => clean === p || clean.startsWith(p + "/") || clean === p + "/");
}

api.interceptors.request.use((config) => {
    // Attach auth token (per-tab via sessionStorage; falls back to localStorage)
    const token = getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;

    const activeLoc = getActiveLocationId();
    const role = getUserRole();
    const url = config.url || "";

    // ---- Auto-attach location_id to scoped GET requests ----
    if (config.method === "get" && activeLoc && pathMatches(url, SCOPED_GET_PREFIXES)) {
        config.params = config.params || {};
        if (config.params.location_id == null) {
            config.params.location_id = activeLoc;
        }
    }

    // ---- Auto-attach location_id to tenant POST creations (super_admin only) ----
    if (
        config.method === "post" &&
        role === "super_admin" &&
        activeLoc &&
        pathMatches(url, TENANT_CREATE_POST_PATHS) &&
        // skip nested routes like /rooms/<id>/regenerate-pin
        TENANT_CREATE_POST_PATHS.includes(url.split("?")[0])
    ) {
        if (config.data && typeof config.data === "object" && !Array.isArray(config.data)) {
            if (config.data.location_id == null) {
                config.data = { ...config.data, location_id: activeLoc };
            }
        }
    }

    return config;
});

export function formatApiErrorDetail(detail) {
    if (detail == null) return "Something went wrong. Please try again.";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail))
        return detail
            .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
            .filter(Boolean)
            .join(" ");
    if (detail && typeof detail.msg === "string") return detail.msg;
    return String(detail);
}
