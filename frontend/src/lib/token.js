// Tiny standalone module to avoid circular import between auth.jsx and api.js.
// Each browser TAB stores its own auth in sessionStorage so multiple staff
// (cafeteria, reception, IT, super_admin…) can be logged in side-by-side in
// different tabs of the SAME browser without overwriting each other's session.
//
// We intentionally do NOT mirror the token to localStorage. localStorage is
// shared across tabs of the same origin, which would mean tab 2 (cafeteria
// login) would overwrite tab 1 (super_admin login)'s token and break every
// API call from tab 1. sessionStorage survives page refresh within the same
// tab, so single-user setups still feel seamless.

const TOKEN_KEY = "sw_token";

export function getToken() {
    try {
        return sessionStorage.getItem(TOKEN_KEY) || null;
    } catch {
        return null;
    }
}

export function setToken(token) {
    try {
        sessionStorage.setItem(TOKEN_KEY, token);
    } catch {}
}

export function clearToken() {
    try {
        sessionStorage.removeItem(TOKEN_KEY);
        // Best-effort cleanup of legacy localStorage tokens from older builds.
        localStorage.removeItem(TOKEN_KEY);
    } catch {}
}
