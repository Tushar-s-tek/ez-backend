/**
 * Visitor self check-in kiosk — public, no auth (PIN-protected).
 *
 * Flow:
 *   1. Enter PIN (or arrive via /visitors/checkin?pin=XXXXXX deep link)
 *   2. Confirm visitor card (name / company / host)
 *   3. Capture webcam photo (skippable if no camera)
 *   4. Accept NDA (if required for the host's location)
 *   5. Submit → status becomes "checked_in", host gets in-app notification
 *   6. Show badge with print button
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiErrorDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
    CameraSlash, Camera, CheckCircle, IdentificationCard, Printer, ArrowRight, X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import VisitorBadge from "@/components/VisitorBadge";

const STEPS = ["pin", "review", "photo", "nda", "done"];

export default function VisitorCheckin() {
    const [params] = useSearchParams();
    const [step, setStep] = useState("pin");
    const [pin, setPin] = useState("");
    const [visitor, setVisitor] = useState(null);
    const [photoUrl, setPhotoUrl] = useState("");
    const [ndaAccepted, setNdaAccepted] = useState(false);
    const [signedName, setSignedName] = useState("");
    const [idNumber, setIdNumber] = useState("");
    const [busy, setBusy] = useState(false);
    const [badge, setBadge] = useState(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);

    // Deep-link: auto-lookup if PIN comes via URL
    useEffect(() => {
        const linkedPin = params.get("pin");
        if (linkedPin && linkedPin.length === 6) {
            setPin(linkedPin);
            lookup(linkedPin);
        }
        // eslint-disable-next-line
    }, []);

    const ndaRequired = useMemo(
        () => !!(visitor && visitor.nda_required && (visitor.nda_text || "").trim()),
        [visitor]
    );

    const lookup = async (rawPin) => {
        const p = (rawPin ?? pin).trim();
        if (p.length !== 6) {
            toast.error("Enter the 6-digit PIN");
            return;
        }
        setBusy(true);
        try {
            const { data } = await api.get(`/visitors/lookup/${p}`);
            setVisitor(data);
            setSignedName(data.name);
            setStep("review");
        } catch (e) {
            toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "PIN not found");
        } finally { setBusy(false); }
    };

    // Webcam control
    const startCamera = async () => {
        if (streamRef.current) return;
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { width: 480 }, audio: false });
            streamRef.current = s;
            if (videoRef.current) {
                videoRef.current.srcObject = s;
                await videoRef.current.play();
            }
        } catch {
            toast.info("Camera unavailable — photo step is optional");
        }
    };
    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
    };
    useEffect(() => () => stopCamera(), []);
    useEffect(() => {
        if (step === "photo") startCamera();
        else stopCamera();
    }, [step]);

    const snap = () => {
        if (!videoRef.current || !canvasRef.current) return;
        const v = videoRef.current;
        const c = canvasRef.current;
        c.width = 320; c.height = 240;
        const ctx = c.getContext("2d");
        ctx.drawImage(v, 0, 0, 320, 240);
        setPhotoUrl(c.toDataURL("image/jpeg", 0.7));
    };

    const submit = async () => {
        if (ndaRequired && !ndaAccepted) {
            toast.error("Please accept the NDA");
            return;
        }
        setBusy(true);
        try {
            const { data } = await api.post("/visitors/self-checkin", {
                pin: visitor.pin,
                photo_data_url: photoUrl || undefined,
                id_number: idNumber || undefined,
                nda_signed_name: ndaAccepted ? (signedName || visitor.name) : undefined,
            });
            // Fetch the full badge (with QR) via the public endpoint now that we're checked-in
            let fullBadge = data;
            try {
                const b = await api.get(`/visitors/badge-public/${visitor.pin}`);
                fullBadge = b.data;
            } catch {}
            setBadge({
                ...visitor, ...fullBadge,
                photo_data_url: photoUrl || fullBadge.photo_data_url,
            });
            setStep("done");
            stopCamera();
        } catch (e) {
            toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Check-in failed");
        } finally { setBusy(false); }
    };

    const resetAll = () => {
        stopCamera();
        setPin(""); setVisitor(null); setPhotoUrl(""); setNdaAccepted(false);
        setSignedName(""); setIdNumber(""); setBadge(null); setStep("pin");
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-[#0B0D10] dark:to-[#0F1419] flex flex-col">
            <header className="border-b border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-[#0B0D10]/70 backdrop-blur-sm">
                <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <IdentificationCard size={26} weight="duotone" color="#0055FF" />
                        <div>
                            <div className="label-eyebrow text-gray-500">TekWissen · EZ Workplace</div>
                            <div className="font-display font-semibold text-lg text-gray-900 dark:text-gray-100">Visitor self check-in</div>
                        </div>
                    </div>
                    {step !== "pin" && (
                        <Button variant="ghost" size="sm" onClick={resetAll} data-testid="visitor-restart-btn">
                            <X size={14} className="mr-1" /> Restart
                        </Button>
                    )}
                </div>
            </header>

            <main className="flex-1 max-w-3xl w-full mx-auto p-6">
                {/* Step indicator */}
                <div className="flex items-center gap-2 mb-6">
                    {STEPS.map((s, i) => (
                        <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${
                            STEPS.indexOf(step) >= i ? "bg-[#0055FF]" : "bg-gray-200 dark:bg-gray-800"
                        }`} />
                    ))}
                </div>

                {step === "pin" && (
                    <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800 p-8" data-testid="visitor-pin-card">
                        <div className="label-eyebrow text-gray-500 mb-1">Step 1 of 4</div>
                        <h2 className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-100">Enter your invite PIN</h2>
                        <p className="text-sm text-gray-500 mt-1 mb-6">Your host sent you a 6-digit code. Or scan the QR from your invite.</p>
                        <Input
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                            placeholder="••••••"
                            className="text-3xl tracking-[0.4em] text-center font-mono h-16"
                            data-testid="visitor-pin-input"
                            autoFocus
                            inputMode="numeric"
                        />
                        <Button
                            onClick={() => lookup()}
                            disabled={busy || pin.length !== 6}
                            className="w-full mt-4 bg-[#0055FF] hover:bg-[#0044CC] text-white h-12"
                            data-testid="visitor-pin-submit"
                        >
                            {busy ? "Looking up…" : "Continue"} <ArrowRight size={16} className="ml-1" />
                        </Button>
                    </Card>
                )}

                {step === "review" && visitor && (
                    <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800 p-8" data-testid="visitor-review-card">
                        <div className="label-eyebrow text-gray-500 mb-1">Step 2 of 4</div>
                        <h2 className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-100">Confirm your details</h2>
                        <p className="text-sm text-gray-500 mt-1 mb-6">Please verify the information your host registered.</p>
                        <div className="space-y-3 text-sm">
                            <Row k="Name" v={visitor.name} />
                            <Row k="Company" v={visitor.company || "—"} />
                            <Row k="Visiting" v={visitor.host_room_name} />
                            <Row k="Purpose" v={visitor.purpose || "—"} />
                        </div>
                        <div className="mt-6">
                            <Label className="text-xs">Government ID (optional)</Label>
                            <Input
                                value={idNumber}
                                onChange={(e) => setIdNumber(e.target.value)}
                                placeholder="Driver licence / passport — kept private"
                                className="mt-1"
                                data-testid="visitor-id-input"
                            />
                        </div>
                        <Button
                            onClick={() => setStep("photo")}
                            className="w-full mt-6 bg-[#0055FF] hover:bg-[#0044CC] text-white h-12"
                            data-testid="visitor-review-continue"
                        >
                            Continue <ArrowRight size={16} className="ml-1" />
                        </Button>
                    </Card>
                )}

                {step === "photo" && (
                    <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800 p-8" data-testid="visitor-photo-card">
                        <div className="label-eyebrow text-gray-500 mb-1">Step 3 of 4</div>
                        <h2 className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-100">Take your photo</h2>
                        <p className="text-sm text-gray-500 mt-1 mb-6">Look at the camera and tap "Capture". This goes on your visitor badge.</p>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="rounded-lg bg-gray-100 dark:bg-gray-900 aspect-[4/3] grid place-items-center overflow-hidden">
                                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" data-testid="visitor-webcam-video" />
                            </div>
                            <div className="rounded-lg bg-gray-100 dark:bg-gray-900 aspect-[4/3] grid place-items-center overflow-hidden">
                                {photoUrl ? (
                                    <img src={photoUrl} alt="Snapshot" className="w-full h-full object-cover" data-testid="visitor-photo-preview" />
                                ) : (
                                    <div className="text-center text-gray-400 px-6"><CameraSlash size={36} weight="duotone" /><div className="text-xs mt-2">No photo yet</div></div>
                                )}
                            </div>
                        </div>
                        <canvas ref={canvasRef} className="hidden" />
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                            <Button onClick={snap} className="bg-[#0055FF] hover:bg-[#0044CC] text-white" data-testid="visitor-snap-btn">
                                <Camera size={16} className="mr-1" /> Capture
                            </Button>
                            {photoUrl && (
                                <Button variant="outline" onClick={() => setPhotoUrl("")} data-testid="visitor-retake-btn">Retake</Button>
                            )}
                            <Button
                                onClick={() => setStep("nda")}
                                variant="ghost"
                                className="ml-auto text-gray-600 dark:text-gray-400"
                                data-testid="visitor-skip-photo-btn"
                            >
                                {photoUrl ? "Continue" : "Skip"} <ArrowRight size={16} className="ml-1" />
                            </Button>
                        </div>
                    </Card>
                )}

                {step === "nda" && (
                    <Card className="bg-white dark:bg-[#0B0D10] border-gray-200 dark:border-gray-800 p-8" data-testid="visitor-nda-card">
                        <div className="label-eyebrow text-gray-500 mb-1">Step 4 of 4</div>
                        <h2 className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-100">
                            {ndaRequired ? "Non-disclosure agreement" : "Almost done"}
                        </h2>
                        {ndaRequired ? (
                            <>
                                <p className="text-sm text-gray-500 mt-1 mb-3">Please read the agreement below before continuing.</p>
                                <div
                                    className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 p-4 max-h-64 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap"
                                    data-testid="visitor-nda-text"
                                >
                                    {visitor.nda_text}
                                </div>
                                <label className="flex items-start gap-3 mt-4 cursor-pointer">
                                    <Checkbox
                                        checked={ndaAccepted}
                                        onCheckedChange={(v) => setNdaAccepted(!!v)}
                                        data-testid="visitor-nda-accept"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">
                                        I, <Input value={signedName} onChange={(e) => setSignedName(e.target.value)} className="inline-flex w-44 h-7 px-2 mx-1 text-sm" data-testid="visitor-nda-name" />,
                                        have read and agree to the terms above.
                                    </span>
                                </label>
                            </>
                        ) : (
                            <p className="text-sm text-gray-500 mt-1 mb-2">Tap "Finish check-in" to notify your host.</p>
                        )}
                        <Button
                            onClick={submit}
                            disabled={busy || (ndaRequired && (!ndaAccepted || !signedName))}
                            className="w-full mt-6 bg-emerald-600 hover:bg-emerald-700 text-white h-12"
                            data-testid="visitor-checkin-submit"
                        >
                            <CheckCircle size={18} weight="fill" className="mr-1" />
                            {busy ? "Checking in…" : "Finish check-in"}
                        </Button>
                    </Card>
                )}

                {step === "done" && badge && (
                    <Card className="bg-white dark:bg-[#0B0D10] border-emerald-200 dark:border-emerald-900 border-2 p-8" data-testid="visitor-done-card">
                        <div className="flex items-center gap-3 mb-2">
                            <CheckCircle size={32} weight="fill" className="text-emerald-600" />
                            <div>
                                <div className="label-eyebrow text-emerald-700 dark:text-emerald-300">Checked in</div>
                                <h2 className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-100">Welcome, {badge.name.split(" ")[0]}!</h2>
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Your host has been notified. Please collect your badge below.</p>
                        <div className="mx-auto" style={{ maxWidth: 380 }}>
                            <VisitorBadge visitor={badge} />
                        </div>
                        <div className="flex gap-2 mt-6">
                            <Button onClick={() => window.print()} className="flex-1 bg-[#0055FF] hover:bg-[#0044CC] text-white h-12" data-testid="visitor-print-btn">
                                <Printer size={18} className="mr-1" /> Print badge
                            </Button>
                            <Button variant="outline" onClick={resetAll} className="h-12" data-testid="visitor-done-home-btn">Done</Button>
                        </div>
                    </Card>
                )}
            </main>
        </div>
    );
}

function Row({ k, v }) {
    return (
        <div className="flex items-baseline justify-between border-b border-gray-100 dark:border-gray-900 pb-2">
            <span className="text-xs uppercase tracking-wider text-gray-500">{k}</span>
            <span className="text-gray-900 dark:text-gray-100 text-right max-w-[60%] truncate">{v}</span>
        </div>
    );
}
