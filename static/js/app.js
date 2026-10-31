// Face Recognition & Access Control System Client JS
let videoElement = document.getElementById("webcam");
let overlayCanvas = document.getElementById("overlayCanvas");
let ctx = overlayCanvas ? overlayCanvas.getContext("2d") : null;
let currentStream = null;
let autoScanInterval = null;
let isScanning = false;
let currentTab = "scan";

// Audio Feedback using Web Audio API (No external sound files required)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playAccessGrantedSound() {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = "sine";
        
        // Happy ascending chime (two tones)
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.15); // A5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
    } catch (e) {
        console.log("Audio play error", e);
    }
}

function playAccessDeniedSound() {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = "sawtooth";
        
        // Low descending warning buzzer
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(160, now + 0.2);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.45);
    } catch (e) {
        console.log("Audio play error", e);
    }
}

let currentFacingMode = "user"; // 'user' (selfie) or 'environment' (rear)

// Visual screen flash on camera capture
function triggerCameraFlash() {
    const flash = document.getElementById("cameraFlashOverlay");
    if (!flash) return;
    flash.classList.remove("hidden");
    flash.style.opacity = "0.7";
    setTimeout(() => {
        flash.style.opacity = "0";
        setTimeout(() => flash.classList.add("hidden"), 250);
    }, 70);
}

// Initialize Camera with robust mobile support
async function initCamera() {
    const errorNotice = document.getElementById("camErrorNotice");
    if (errorNotice) errorNotice.classList.add("hidden");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("navigator.mediaDevices.getUserMedia is unavailable (insecure context or unsupported browser).");
        if (errorNotice) errorNotice.classList.remove("hidden");
        const statusText = document.getElementById("scanStatusText");
        if (statusText) statusText.innerText = "الكاميرا غير مفعلة (يرجى فتح رابط HTTPS للموبايل)";
        return;
    }

    try {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }

        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        let stream = null;
        try {
            // First attempt with preferred facing mode and flexible dimensions
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: currentFacingMode ? { ideal: currentFacingMode } : "user",
                    width: isMobile ? { ideal: 480, max: 1280 } : { ideal: 640, max: 1280 },
                    height: isMobile ? { ideal: 640, max: 720 } : { ideal: 480, max: 720 }
                },
                audio: false
            });
        } catch (constraintErr) {
            console.warn("Specific constraints failed, falling back to basic video constraint:", constraintErr);
            stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });
        }

        currentStream = stream;
        videoElement.srcObject = stream;
        videoElement.setAttribute("playsinline", "true");
        videoElement.setAttribute("webkit-playsinline", "true");

        try {
            await videoElement.play();
        } catch (playErr) {
            console.log("Video play promise error:", playErr);
        }

        videoElement.onloadedmetadata = () => {
            overlayCanvas.width = videoElement.videoWidth || 640;
            overlayCanvas.height = videoElement.videoHeight || 480;
            const badge = document.getElementById("camFpsBadge");
            if (badge) badge.innerText = `${overlayCanvas.width}x${overlayCanvas.height}`;
            const statusText = document.getElementById("scanStatusText");
            if (statusText) statusText.innerText = "الكاميرا جاهزة للتعرف";
        };
    } catch (err) {
        console.error("Camera access failed:", err);
        if (errorNotice) errorNotice.classList.remove("hidden");
        const statusText = document.getElementById("scanStatusText");
        if (statusText) statusText.innerText = "تعذر تشغيل الكاميرا";
    }
}

async function switchCameraFacing() {
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    const label = document.getElementById("cameraFacingLabel");
    if (label) {
        label.innerText = currentFacingMode === "user" ? "أمامية (سيلفي)" : "خلفية";
    }

    if (videoElement && overlayCanvas) {
        if (currentFacingMode === "user") {
            videoElement.classList.add("-scale-x-100");
            overlayCanvas.classList.add("-scale-x-100");
        } else {
            videoElement.classList.remove("-scale-x-100");
            overlayCanvas.classList.remove("-scale-x-100");
        }
    }

    await initCamera();
}

function restartCamera() {
    initCamera();
}

// Capture current frame as Base64 JPEG data URL
function captureFrameBase64() {
    if (!videoElement || videoElement.videoWidth === 0) return null;

    const offCanvas = document.createElement("canvas");
    offCanvas.width = videoElement.videoWidth;
    offCanvas.height = videoElement.videoHeight;
    const offCtx = offCanvas.getContext("2d");

    // We do not mirror when saving to backend so orientation is standard
    offCtx.drawImage(videoElement, 0, 0, offCanvas.width, offCanvas.height);
    return offCanvas.toDataURL("image/jpeg", 0.90);
}

// Switch Tabs
function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll(".tab-view").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach(el => {
        el.classList.remove("border-indigo-500", "text-indigo-400", "bg-indigo-500/10");
        el.classList.add("border-transparent", "text-slate-400");
    });

    const activeView = document.getElementById(`view-${tabId}`);
    const activeBtn = document.getElementById(`tabBtn-${tabId}`);
    if (activeView) activeView.classList.remove("hidden");
    if (activeBtn) {
        activeBtn.classList.remove("border-transparent", "text-slate-400");
        activeBtn.classList.add("border-indigo-500", "text-indigo-400", "bg-indigo-500/10");
    }

    if (tabId === "users") loadUsersList();
    if (tabId === "logs") loadLogsList();
    if (tabId !== "scan") {
        stopAutoScan();
    }
}

// Draw Face Box on Canvas
function drawFaceBox(box, status, label) {
    if (!ctx || !box) return;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const x = box.x;
    const y = box.y;
    const w = box.width;
    const h = box.height;

    let color = "#38bdf8"; // default cyan
    if (status === "GRANTED") color = "#10b981"; // emerald
    else if (status === "DENIED") color = "#ef4444"; // red
    else if (status === "UNKNOWN") color = "#f59e0b"; // amber

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.stroke();

    // Fill label background
    if (label) {
        ctx.fillStyle = color;
        ctx.font = "bold 14px Cairo, sans-serif";
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x, Math.max(0, y - 28), textWidth + 16, 26);

        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x + 8, Math.max(18, y - 10));
    }

    // Clear after 3.5 seconds
    setTimeout(() => {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }, 3500);
}

// Trigger Mobile Camera for Face Scan
function triggerMobileScanCamera() {
    const input = document.getElementById("mobileScanCameraInput");
    if (input) input.click();
}

function handleMobileScanCapture(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Data = e.target.result;
        await executeFaceVerify(base64Data);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
}

// Scan Face Once from Live Webcam
async function scanFaceOnce() {
    const imageBase64 = captureFrameBase64();
    if (!imageBase64) {
        // Automatically offer to use mobile camera snapshot if webcam is unavailable
        triggerMobileScanCamera();
        return;
    }
    await executeFaceVerify(imageBase64);
}

// Common Face Verification Logic
async function executeFaceVerify(imageBase64) {
    if (isScanning) return;
    const btn = document.getElementById("btnScanNow");
    const resultCard = document.getElementById("verifyResultCard");
    const idleState = document.getElementById("verifyIdleState");
    const statusText = document.getElementById("scanStatusText");

    isScanning = true;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> جاري فحص ومطابقة الوجه بالذكاء الاصطناعي...`;
    }
    if (statusText) statusText.innerText = "جاري مطابقة بصمة الوجه...";

    try {
        const response = await fetch("/api/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: imageBase64 })
        });
        const data = await response.json();

        if (idleState) idleState.classList.add("hidden");
        if (resultCard) resultCard.classList.remove("hidden");

        renderVerificationResult(data);

        // Update stats & logs
        updateStats();
    } catch (err) {
        console.error("Verification failed:", err);
        if (statusText) statusText.innerText = "حدث خطأ أثناء فحص الوجه";
    } finally {
        isScanning = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg> فحص ومطابقة الوجه الآن`;
        }
    }
}

// Render Result Card in Scan View
function renderVerificationResult(data) {
    const card = document.getElementById("verifyResultCard");
    const statusText = document.getElementById("scanStatusText");

    if (data.status === "GRANTED") {
        playAccessGrantedSound();
        statusText.innerText = `تم التعرف: ${data.user.name} (مصرح)`;
        drawFaceBox(data.face_box, "GRANTED", `${data.user.name} (${data.confidence}%)`);

        // حفظ التوكن في المتصفح لفتح الموقع المحمي في أي وقت
        if (data.token) {
            localStorage.setItem("face_session_token", data.token);
            document.cookie = `face_session_token=${data.token}; path=/; max-age=86400; SameSite=Lax`;
            const navLink = document.getElementById("navPortalLink");
            if (navLink) navLink.href = data.redirect_url;
        }

        // إيقاف المسح التلقائي مؤقتاً لتجنب التكرار
        stopAutoScan();

        card.innerHTML = `
            <div class="bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-900 border-2 border-emerald-500/50 rounded-2xl p-6 shadow-2xl glow-granted">
                <div class="flex items-center gap-2 text-emerald-400 font-extrabold text-sm mb-3">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                    ✅ تم التحقق من الوجه بنجاح - مصرح لك بالدخول!
                </div>

                <div class="flex items-center gap-4 mb-5">
                    <img src="${data.user.photo_url}" class="w-16 h-16 rounded-2xl object-cover ring-2 ring-emerald-400 shadow-md">
                    <div>
                        <h4 class="text-xl font-bold text-white">${data.user.name}</h4>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">${data.user.role}</span>
                            <span class="text-xs text-slate-400">نسبة التطابق: <b class="text-emerald-400 font-mono">${data.confidence}%</b></span>
                        </div>
                    </div>
                </div>

                <div class="p-3 bg-emerald-950/40 rounded-xl border border-emerald-500/20 text-xs text-slate-300 mb-5 leading-relaxed flex items-center justify-between">
                    <span>تم فتح جلسة أمان مصرحة ومطابقة بنجاح.</span>
                    <span id="autoRedirectCountdown" class="text-emerald-400 font-bold font-mono">التحويل خلال 3 ثوانٍ...</span>
                </div>

                <div class="flex flex-col sm:flex-row gap-3">
                    <a href="${data.redirect_url}" class="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-extrabold text-sm rounded-xl transition duration-200 text-center shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2">
                        <span>🚀 فتح الموقع أو البرنامج المربوط الآن</span>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                    </a>
                </div>
            </div>
        `;

        // عد تنازلي للتحويل التلقائي السلس
        let countdown = 3;
        const countdownEl = document.getElementById("autoRedirectCountdown");
        const redirectTimer = setInterval(() => {
            countdown--;
            if (countdownEl && countdown > 0) {
                countdownEl.innerText = `التحويل خلال ${countdown} ثوانٍ...`;
            } else if (countdown <= 0) {
                clearInterval(redirectTimer);
                window.location.href = data.redirect_url;
            }
        }, 1000);
    } else if (data.status === "DENIED") {
        playAccessDeniedSound();
        statusText.innerText = `مرفوض: ${data.user.name} (بدون صلاحية)`;
        drawFaceBox(data.face_box, "DENIED", `${data.user.name} (محظور)`);

        card.innerHTML = `
            <div class="bg-gradient-to-br from-red-950/80 via-slate-900 to-slate-900 border-2 border-red-500/50 rounded-2xl p-6 shadow-2xl">
                <div class="flex items-center gap-2 text-red-400 font-extrabold text-sm mb-3">
                    <span class="w-2.5 h-2.5 rounded-full bg-red-400"></span>
                    ⛔ تم التعرف على الوجه ولكن تم رفض الدخول!
                </div>

                <div class="flex items-center gap-4 mb-4">
                    <img src="${data.user.photo_url}" class="w-16 h-16 rounded-2xl object-cover ring-2 ring-red-400 shadow-md">
                    <div>
                        <h4 class="text-xl font-bold text-white">${data.user.name}</h4>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-xs px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-semibold">${data.user.role}</span>
                            <span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">الصلاحية: معطلة (No Access)</span>
                        </div>
                    </div>
                </div>

                <div class="p-3.5 bg-red-950/40 rounded-xl border border-red-500/30 text-xs text-red-200 mb-4 leading-relaxed">
                    <b>سبب الرفض:</b> ${data.reason}
                    <br>
                    <span class="text-slate-400 text-[11px]">يمكن لمسؤول النظام تفعيل الصلاحية من تبويب "إدارة المستخدمين والصلاحيات".</span>
                </div>

                <button onclick="switchTab('users')" class="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition">
                    الانتقال لإدارة الصلاحيات لتفعيل الدخول لهذا المستخدم
                </button>
            </div>
        `;
    } else if (data.status === "UNKNOWN") {
        playAccessDeniedSound();
        statusText.innerText = "وجه غير مسجل في النظام";
        drawFaceBox(data.face_box, "UNKNOWN", "غير مسجل");

        card.innerHTML = `
            <div class="bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-900 border-2 border-amber-500/40 rounded-2xl p-6 shadow-2xl">
                <div class="flex items-center gap-2 text-amber-400 font-extrabold text-sm mb-3">
                    <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                    ❌ الوجه غير مسجل في النظام!
                </div>

                <p class="text-xs text-slate-300 mb-4 leading-relaxed">
                    لم نتمكن من العثور على أي تطابق مع الوجوه المسجلة في قاعدة البيانات. هذا الشخص غير مصرح له بفتح الموقع أو البرنامج.
                </p>

                <div class="flex gap-3">
                    <button onclick="switchTab('register')" class="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition">
                        تسجيل هذا الوجه كشخص جديد الآن
                    </button>
                    <button onclick="scanFaceOnce()" class="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 transition">
                        إعادة المسح
                    </button>
                </div>
            </div>
        `;
    } else {
        // No face or error
        statusText.innerText = data.message || "تنبيه أثناء المسح";
        card.innerHTML = `
            <div class="p-5 bg-slate-900 border border-slate-800 rounded-2xl text-center">
                <p class="text-xs text-amber-400 font-bold mb-2">${data.message || "لم يتم العثور على وجه واضح"}</p>
                <p class="text-[11px] text-slate-500">يرجى توجيه الوجه مباشرة لعدسة الكاميرا وضبط الإضاءة.</p>
            </div>
        `;
    }
}

// Auto-Scan Toggle
document.getElementById("autoScanToggle").addEventListener("change", function(e) {
    if (e.target.checked) {
        startAutoScan();
    } else {
        stopAutoScan();
    }
});

function startAutoScan() {
    if (autoScanInterval) clearInterval(autoScanInterval);
    autoScanInterval = setInterval(() => {
        if (!isScanning && currentTab === "scan") {
            scanFaceOnce();
        }
    }, 2800);
}

function stopAutoScan() {
    if (autoScanInterval) {
        clearInterval(autoScanInterval);
        autoScanInterval = null;
    }
    const chk = document.getElementById("autoScanToggle");
    if (chk) chk.checked = false;
}

// Multi-Angle Face Capture State
const capturedAngles = {
    center: null,
    right: null,
    left: null,
    up: null,
    down: null
};
let wizardRunning = false;
let wizardTimeout = null;

function playAngleCaptureBeep() {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = "sine";
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(659.25, now); // E5
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    } catch (e) {}
}

// Capture specific angle slot
function captureSpecificAngle(angleKey) {
    const snap = captureFrameBase64();
    if (!snap) {
        alert("يرجى التأكد من تشغيل الكاميرا والسماح بالوصول.");
        return;
    }

    capturedAngles[angleKey] = snap;
    playAngleCaptureBeep();

    // Update Thumbnail
    const thumb = document.getElementById(`thumb-${angleKey}`);
    if (thumb) {
        thumb.innerHTML = `<img src="${snap}" class="w-full h-full object-cover">`;
    }

    // Update Badge & Card Border
    const badge = document.getElementById(`badge-${angleKey}`);
    if (badge) {
        badge.innerText = "✅ تم";
        badge.className = "text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold";
    }
    const card = document.getElementById(`card-${angleKey}`);
    if (card) {
        card.classList.remove("border-slate-700/70");
        card.classList.add("border-emerald-500/60", "bg-emerald-950/20");
    }

    updateAngleMetrics();
}

// Reset all angles
function resetAllAngles() {
    stopWizard();
    for (let key in capturedAngles) {
        capturedAngles[key] = null;
        const thumb = document.getElementById(`thumb-${key}`);
        if (thumb) {
            thumb.innerHTML = `<span class="text-xs text-slate-500">-</span>`;
        }
        const badge = document.getElementById(`badge-${key}`);
        if (badge) {
            badge.innerText = "معلق";
            badge.className = "text-[9px] px-1.5 py-0.2 rounded bg-slate-700 text-slate-400";
        }
        const card = document.getElementById(`card-${key}`);
        if (card) {
            card.classList.remove("border-emerald-500/60", "bg-emerald-950/20");
            card.classList.add("border-slate-700/70");
        }
    }
    updateAngleMetrics();
}

// Update Accuracy Metric & Progress Bar
function updateAngleMetrics() {
    const count = Object.values(capturedAngles).filter(v => v !== null).length;
    const pct = Math.round((count / 5) * 100);

    const bar = document.getElementById("accuracyProgressBar");
    if (bar) bar.style.width = `${pct}%`;

    const badge = document.getElementById("accuracyBadge");
    if (badge) {
        if (count === 0) {
            badge.innerText = `0/5 زوايا (0%)`;
            badge.className = "text-xs font-bold text-slate-400";
        } else if (count < 3) {
            badge.innerText = `${count}/5 زوايا (${pct}%) - دقة متوسطة`;
            badge.className = "text-xs font-bold text-amber-400";
        } else if (count < 5) {
            badge.innerText = `${count}/5 زوايا (${pct}%) - دقة عالية`;
            badge.className = "text-xs font-bold text-indigo-400";
        } else {
            badge.innerText = `5/5 زوايا (100%) - أقصى دقة 3D`;
            badge.className = "text-xs font-bold text-emerald-400";
        }
    }

    const btnText = document.getElementById("submitRegBtnText");
    if (btnText) {
        btnText.innerText = count > 1 
            ? `حفظ وتوثيق بصمات الوجه (${count} زوايا مسجلة)`
            : `حفظ وتوثيق بصمات الوجه والبروفايل في النظام`;
    }
}

// Stop Guided Wizard
function stopWizard() {
    wizardRunning = false;
    if (wizardTimeout) clearTimeout(wizardTimeout);

    const promptBox = document.getElementById("wizardPromptBox");
    if (promptBox) promptBox.classList.add("hidden");

    const hud = document.getElementById("cameraWizardHud");
    if (hud) hud.classList.add("hidden");

    const faceOval = document.getElementById("faceGuideOval");
    if (faceOval) faceOval.classList.remove("hidden");

    const btn = document.getElementById("btnStartWizard");
    if (btn) {
        btn.innerHTML = `<svg class="w-4 h-4 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg><span>🚀 بدء المعالج الذكي لالتقاط كل الزوايا تلقائياً (5 زوايا بالتتابع)</span>`;
    }
}

// Guided Step-by-Step Auto Wizard with Live Camera HUD
async function startGuidedAngleCapture() {
    if (wizardRunning) {
        stopWizard();
        return;
    }

    const steps = [
        { key: "center", title: "🎯 انظر مباشرة للأمام للكاميرا بدون حركة", desc: "الزاوية 1: المركز والأمام" },
        { key: "right", title: "➡️ أمل وجهك قليلاً جهة اليمين (نحو 20 درجة)", desc: "الزاوية 2: اليمين" },
        { key: "left", title: "⬅️ أمل وجهك قليلاً جهة اليسار (نحو 20 درجة)", desc: "الزاوية 3: اليسار" },
        { key: "up", title: "⬆️ ارفع رأسك قليلاً للأعلى", desc: "الزاوية 4: الأعلى" },
        { key: "down", title: "⬇️ أمل رأسك قليلاً للأسفل", desc: "الزاوية 5: الأسفل" }
    ];

    wizardRunning = true;
    const promptBox = document.getElementById("wizardPromptBox");
    const instText = document.getElementById("wizardInstructionText");
    const countText = document.getElementById("wizardCountdownText");
    const btn = document.getElementById("btnStartWizard");

    const hud = document.getElementById("cameraWizardHud");
    const hudStep = document.getElementById("hudAngleStep");
    const hudTitle = document.getElementById("hudAngleTitle");
    const hudCount = document.getElementById("hudCountdown");
    const hudSub = document.getElementById("hudSubText");
    const faceOval = document.getElementById("faceGuideOval");

    if (btn) btn.innerHTML = `<span>⏹️ إيقاف المعالج الذكي</span>`;
    if (promptBox) promptBox.classList.remove("hidden");
    if (hud) hud.classList.remove("hidden");
    if (faceOval) faceOval.classList.add("hidden");

    // Scroll smoothly to camera so mobile user sees the live action immediately
    if (videoElement) {
        videoElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    for (let i = 0; i < steps.length; i++) {
        if (!wizardRunning) break;
        const step = steps[i];

        // Highlight current card in the grid below
        const card = document.getElementById(`card-${step.key}`);
        if (card) card.classList.add("ring-2", "ring-indigo-400");

        if (instText) instText.innerText = step.title;
        if (hudStep) hudStep.innerText = `${i + 1}/5`;
        if (hudTitle) hudTitle.innerText = step.title;
        if (hudSub) hudSub.innerText = step.desc;

        // 3 seconds countdown with live HUD display
        for (let sec = 3; sec > 0; sec--) {
            if (!wizardRunning) break;
            if (hudCount) hudCount.innerText = sec;
            if (countText) countText.innerText = `التقاط (${step.desc}) خلال ${sec} ثوانٍ... ثبّت وجهك`;
            await new Promise(r => { wizardTimeout = setTimeout(r, 1000); });
        }

        if (!wizardRunning) break;

        // Visual flash & capture angle snapshot
        triggerCameraFlash();
        captureSpecificAngle(step.key);

        if (hudCount) hudCount.innerText = "📸";
        if (countText) countText.innerText = `✅ تم التقاط (${step.desc})! الانتقال للزاوية التالية...`;
        if (card) card.classList.remove("ring-2", "ring-indigo-400");

        await new Promise(r => { wizardTimeout = setTimeout(r, 1100); });
    }

    if (wizardRunning) {
        playAccessGrantedSound();
        if (hudStep) hudStep.innerText = "5/5";
        if (hudTitle) hudTitle.innerText = "🎉 اكتمل تسجيل الزوايا بنجاح!";
        if (hudCount) hudCount.innerText = "✅";
        if (hudSub) hudSub.innerText = "دقة بيومترية 100%! احفظ البروفايل بالأسفل";
        if (instText) instText.innerText = "🎉 تم التقاط جميع زوايا الوجه بنجاح (100% دقة بيومترية)!";
        if (countText) countText.innerText = "اضغط على زر الحفظ بالأسفل لتوثيق البروفايل في النظام.";
        setTimeout(() => {
            stopWizard();
        }, 3200);
    }
}

// Access Switch Label updates
document.getElementById("regHasAccess").addEventListener("change", function(e) {
    const lbl = document.getElementById("accessLabelText");
    if (e.target.checked) {
        lbl.innerText = "مسموح له بالدخول (Active Access)";
        lbl.className = "text-xs font-bold text-emerald-400";
    } else {
        lbl.innerText = "معطل / غير مصرح بالدخول (Access Denied)";
        lbl.className = "text-xs font-bold text-red-400";
    }
});

// Handle User Registration
async function handleRegister(event) {
    event.preventDefault();
    const btn = document.getElementById("btnSubmitReg");
    const statusMsg = document.getElementById("regStatusMsg");

    const name = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const role = document.getElementById("regRole").value;
    const hasAccess = document.getElementById("regHasAccess").checked;
    const notes = document.getElementById("regNotes").value.trim();

    // Collect captured multi-angles
    const validAngles = {};
    for (let k in capturedAngles) {
        if (capturedAngles[k]) validAngles[k] = capturedAngles[k];
    }

    // If no angles captured in slots, capture current frame as center
    if (Object.keys(validAngles).length === 0) {
        const snap = captureFrameBase64();
        if (!snap) {
            alert("يرجى التأكد من تشغيل الكاميرا أمامك لالتقاط الوجه.");
            return;
        }
        validAngles["center"] = snap;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> جاري استخراج البصمات البيومترية وحفظ البروفايل...`;
    statusMsg.classList.add("hidden");

    try {
        const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                email,
                role,
                has_access: hasAccess,
                notes,
                images: validAngles
            })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            statusMsg.className = "p-3 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
            statusMsg.innerText = data.message;
            statusMsg.classList.remove("hidden");

            // Reset form & angles
            document.getElementById("regName").value = "";
            document.getElementById("regEmail").value = "";
            document.getElementById("regNotes").value = "";
            resetAllAngles();

            updateStats();
            // Automatically switch back to scan view after 2.5s
            setTimeout(() => {
                switchTab("scan");
            }, 2500);
        } else {
            statusMsg.className = "p-3 rounded-xl text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30";
            statusMsg.innerText = data.detail || "حدث خطأ أثناء التسجيل";
            statusMsg.classList.remove("hidden");
        }
    } catch (err) {
        console.error("Register error:", err);
        statusMsg.className = "p-3 rounded-xl text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30";
        statusMsg.innerText = "تعذر الاتصال بالخادم";
        statusMsg.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg> <span id="submitRegBtnText">حفظ وتوثيق بصمات الوجه والبروفايل في النظام</span>`;
    }
}

// Load Users List for Tab 3
async function loadUsersList() {
    const container = document.getElementById("usersContainer");
    const emptyMsg = document.getElementById("usersEmptyMsg");

    try {
        const res = await fetch("/api/users");
        const users = await res.json();

        if (!users || users.length === 0) {
            container.innerHTML = "";
            emptyMsg.classList.remove("hidden");
            return;
        }

        emptyMsg.classList.add("hidden");
        container.innerHTML = users.map(user => `
            <div class="bg-slate-800/60 border ${user.has_access ? 'border-slate-700/60' : 'border-red-500/30'} rounded-2xl p-4 flex flex-col justify-between hover:border-slate-600 transition">
                <div class="flex items-center gap-3 mb-3">
                    <img src="${user.photo_path || '/static/placeholder.jpg'}" class="w-12 h-12 rounded-xl object-cover ring-2 ${user.has_access ? 'ring-emerald-500/50' : 'ring-red-500/50'}">
                    <div class="flex-1 min-w-0">
                        <h4 class="text-sm font-bold text-white truncate">${user.name}</h4>
                        <p class="text-[11px] text-slate-400 truncate">${user.email}</p>
                        <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span class="inline-block text-[10px] px-2 py-0.5 rounded bg-slate-700/80 text-slate-300">${user.role}</span>
                            ${user.angles_count > 1 
                                ? `<span class="inline-block text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold">📐 ${user.angles_count} زوايا (3D)</span>`
                                : `<span class="inline-block text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">زاوية واحدة</span>`
                            }
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-between pt-3 border-t border-slate-700/40 text-xs">
                    <button onclick="toggleUserAccess(${user.id})" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 ${
                        user.has_access 
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30' 
                        : 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                    }">
                        <span>${user.has_access ? '✅ معاه تصريح (مسموح)' : '⛔ ممنوع من الدخول'}</span>
                        <span class="text-[9px] opacity-75">(تعديل)</span>
                    </button>

                    <button onclick="deleteUserProfile(${user.id}, '${user.name}')" class="p-1.5 text-slate-400 hover:text-red-400 transition" title="حذف المستخدم">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </div>
        `).join("");
    } catch (err) {
        console.error("Load users failed:", err);
    }
}

// Toggle User Access Permission
async function toggleUserAccess(userId) {
    try {
        const res = await fetch(`/api/users/${userId}/toggle-access`, { method: "POST" });
        if (res.ok) {
            loadUsersList();
            updateStats();
        }
    } catch (e) {
        console.error(e);
    }
}

// Delete User Profile
async function deleteUserProfile(userId, name) {
    if (!confirm(`هل أنت متأكد من حذف الملف الشخصي للمستخدم: "${name}"؟`)) return;
    try {
        const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
        if (res.ok) {
            loadUsersList();
            updateStats();
        }
    } catch (e) {
        console.error(e);
    }
}

// Load Logs for Tab 4
async function loadLogsList() {
    const tbody = document.getElementById("logsTableBody");
    try {
        const res = await fetch("/api/logs");
        const logs = await res.json();

        if (!logs || logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-500">لا توجد محاولات دخول مسجلة حتى الآن</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(log => {
            let statusBadge = "";
            if (log.status === "GRANTED") {
                statusBadge = `<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">مصرح له بالدخول ✅</span>`;
            } else if (log.status === "DENIED_NO_ACCESS") {
                statusBadge = `<span class="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">مرفوض (بدون صلاحية) ⛔</span>`;
            } else {
                statusBadge = `<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">وجه غير معروف ❌</span>`;
            }

            return `
                <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-3 px-4 font-mono text-slate-400">${log.timestamp}</td>
                    <td class="py-3 px-4 font-bold text-white">${log.user_name || "مجهول"}</td>
                    <td class="py-3 px-4">${statusBadge}</td>
                    <td class="py-3 px-4 font-mono text-slate-300">${log.confidence ? log.confidence + '%' : '-'}</td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        console.error("Load logs failed:", err);
    }
}

// Quick Header Stats update
async function updateStats() {
    try {
        const res = await fetch("/api/users");
        const users = await res.json();
        const total = users.length;
        const active = users.filter(u => u.has_access === 1 || u.has_access === true).length;

        const elTotal = document.getElementById("statTotalUsers");
        const elActive = document.getElementById("statActiveUsers");
        if (elTotal) elTotal.innerText = total;
        if (elActive) elActive.innerText = active;
    } catch (e) {
        console.error(e);
    }
}

// Mobile QR Code Modal Management
let qrInstance = null;

async function openMobileQrModal() {
    const modal = document.getElementById("mobileQrModal");
    if (!modal) return;

    // Fetch dynamic network info from backend to get latest tunnel URL
    try {
        const res = await fetch("/api/network-info");
        if (res.ok) {
            const net = await res.json();
            const httpsEl = document.getElementById("mobileHttpsUrlDisplay");
            const lanEl = document.getElementById("mobileLanUrlDisplay");
            if (httpsEl && net.mobile_url) httpsEl.innerText = net.mobile_url;
            if (lanEl && net.local_url) lanEl.innerText = net.local_url;
        }
    } catch (e) {
        console.log("Network info check:", e);
    }

    const qrContainer = document.getElementById("mobileQrContainer");
    qrContainer.innerHTML = "";

    const httpsEl = document.getElementById("mobileHttpsUrlDisplay");
    const targetUrl = httpsEl ? httpsEl.innerText.trim() : window.location.href;

    if (typeof QRCode !== "undefined") {
        qrInstance = new QRCode(qrContainer, {
            text: targetUrl,
            width: 195,
            height: 195,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function closeMobileQrModal() {
    const modal = document.getElementById("mobileQrModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function copyHttpsMobileUrl() {
    const el = document.getElementById("mobileHttpsUrlDisplay");
    const text = el ? el.innerText.trim() : "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        alert(`تم نسخ رابط الموبايل (HTTPS مع كاميرا لايف بدون قيود) بنجاح:\n${text}`);
    }).catch(() => {
        prompt("انسخ الرابط التالي:", text);
    });
}

function copyLanMobileUrl() {
    const el = document.getElementById("mobileLanUrlDisplay");
    const text = el ? el.innerText.trim() : "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        alert(`تم نسخ رابط الشبكة المحلية (LAN) بنجاح:\n${text}`);
    }).catch(() => {
        prompt("انسخ الرابط التالي:", text);
    });
}

// Auto start camera on load
window.addEventListener("DOMContentLoaded", () => {
    initCamera();
});
