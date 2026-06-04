import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { setToken, clearToken } from "./token";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get("/auth/me");
                setUser(data);
            } catch {
                setUser(false);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const login = async (email, password) => {
        const { data } = await api.post("/auth/login", { email, password });
        if (data.token) setToken(data.token);
        setUser(data.user);
        return data.user;
    };

    const logout = async () => {
        try {
            await api.post("/auth/logout");
        } catch {}
        clearToken();
        setUser(false);
    };

    return (
        <AuthCtx.Provider value={{ user, loading, login, logout, setUser }}>
            {children}
        </AuthCtx.Provider>
    );
}

export const useAuth = () => useContext(AuthCtx);
