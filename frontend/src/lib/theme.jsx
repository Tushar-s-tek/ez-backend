import React, { createContext, useContext, useEffect, useState } from "react";

const ThemeCtx = createContext({ theme: "light", setTheme: () => {} });

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(() => localStorage.getItem("sw_theme") || "light");
    useEffect(() => {
        const root = document.documentElement;
        if (theme === "dark") root.classList.add("dark");
        else root.classList.remove("dark");
        localStorage.setItem("sw_theme", theme);
    }, [theme]);
    return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
