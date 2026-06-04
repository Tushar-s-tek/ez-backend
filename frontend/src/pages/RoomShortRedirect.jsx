import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import BrandLogo from "@/components/BrandLogo";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

/**
 * Tiny-URL landing page — visited via /r/:code.
 *
 * Resolves the short code via GET /api/rooms/by-short/:code and immediately
 * routes the visitor to /room/:pin. Shows a small TekWissen splash so the
 * user knows something is happening on the brief loading moment.
 */
export default function RoomShortRedirect() {
    const { code } = useParams();
    const navigate = useNavigate();
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data } = await axios.get(`${BACKEND_URL}/api/rooms/by-short/${encodeURIComponent(code)}`);
                if (!cancelled && data?.pin) {
                    navigate(`/room/${data.pin}`, { replace: true });
                } else if (!cancelled) {
                    setError("Room not found.");
                }
            } catch {
                if (!cancelled) setError("Sorry, that link is invalid or has been replaced.");
            }
        })();
        return () => { cancelled = true; };
    }, [code, navigate]);

    return (
        <div className="min-h-screen grid place-items-center bg-gradient-to-br from-[#001a4d] to-[#0055FF] text-white px-6">
            <div className="text-center space-y-5" data-testid="room-short-redirect">
                <BrandLogo height={48} variant="light" />
                {!error ? (
                    <div className="text-sm text-blue-100">Opening room…</div>
                ) : (
                    <>
                        <div className="text-base font-semibold">{error}</div>
                        <button
                            className="text-xs underline text-blue-200 hover:text-white"
                            onClick={() => navigate("/", { replace: true })}
                        >Go home</button>
                    </>
                )}
            </div>
        </div>
    );
}
