// AI Face Recognition & Biometric Attendance Workstation - Client JS
let videoElement = document.getElementById("webcam");
let overlayCanvas = document.getElementById("overlayCanvas");
let ctx = overlayCanvas ? overlayCanvas.getContext("2d") : null;
let currentStream = null;
let autoScanInterval = null;
let isScanning = false;
let currentTab = "scan";
let selectedCameraDeviceId = "";
let voiceAssistantEnabled = true;

// Web Audio Synthesis (Synthesized Beeps & Alerts)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type, duration, gainVal = 0.2) {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = type;
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(gainVal, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.start(now);
        osc.stop(now + duration);
    } catch (e) {}
}

function playAccessGrantedSound() {
    try {
        playTone(587.33, "sine", 0.15, 0.2); // D5
        setTimeout(() => playTone(880, "sine", 0.35, 0.25), 120); // A5
    } catch (e) {}
}

function playAccessDeniedSound() {
    try {
        playTone(220, "sawtooth", 0.2, 0.25);
        setTimeout(() => playTone(160, "sawtooth", 0.3, 0.3), 150);
    } catch (e) {}
}

function playAngleCaptureBeep() {
    try {
        playTone(784, "sine", 0.12, 0.18); // G5
    } catch (e) {}
}

// Arabic Voice Feedback using SpeechSynthesis
function speakVoice(text) {
    if (!voiceAssistantEnabled || !("speechSynthesis" in window)) return;
    try {
        window.speechSynthesis.cancel(); // Stop any pending speech
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ar-SA";
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.log("Voice speech error:", e);
    }
}

function toggleVoiceAudio() {
    voiceAssistantEnabled = !voiceAssistantEnabled;
    const icon = document.getElementById("voiceToggleIcon");
    const label = document.getElementById("voiceToggleLabel");
    if (voiceAssistantEnabled) {
        if (icon) icon.innerText = "🔊";
        if (label) label.innerText = "الصوت مفعل";
        speakVoice("تم تفعيل المساعد الصوتي");
    } else {
        if (icon) icon.innerText = "🔇";
        if (label) label.innerText = "الصوت مكتوم";
        window.speechSynthesis.cancel();
    }
}

// Fullscreen / Kiosk Toggle
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log("Fullscreen request error:", err);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

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

// Enumerate Desktop Webcams and fill dropdown
async function populateWebcamDevices() {
    const select = document.getElementById("cameraDeviceSelect");
    if (!select || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === "videoinput");

        select.innerHTML = "";
        if (videoInputs.length === 0) {
            select.innerHTML = `<option value="">كاميرا النظام الافتراضية</option>`;
            return;
        }

        videoInputs.forEach((device, index) => {
            const opt = document.createElement("option");
            opt.value = device.deviceId;
            opt.innerText = device.label || `كاميرا رقم ${index + 1} (${device.deviceId.slice(0, 8)}...)`;
            if (device.deviceId === selectedCameraDeviceId) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
    } catch (err) {
        console.log("Device enumeration error:", err);
    }
}

async function changeCameraDevice(deviceId) {
    selectedCameraDeviceId = deviceId;
    await initCamera();
}

// Initialize Camera natively on Desktop PC
async function initCamera() {
    const errorNotice = document.getElementById("camErrorNotice");
    if (errorNotice) errorNotice.classList.add("hidden");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (errorNotice) errorNotice.classList.remove("hidden");
        const statusText = document.getElementById("scanStatusText");
        if (statusText) statusText.innerText = "الكاميرا غير مفعلة";
        return;
    }

    try {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }

        const videoConstraints = {
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 }
        };

        if (selectedCameraDeviceId) {
            videoConstraints.deviceId = { exact: selectedCameraDeviceId };
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false
        });

        currentStream = stream;
        videoElement.srcObject = stream;
        videoElement.setAttribute("playsinline", "true");

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
            if (statusText) statusText.innerText = "STANDBY / READY";
        };

        // Populate camera list with proper labels now that permission is granted
        await populateWebcamDevices();
    } catch (err) {
        console.error("Camera access failed:", err);
        if (errorNotice) errorNotice.classList.remove("hidden");
        const statusText = document.getElementById("scanStatusText");
        if (statusText) statusText.innerText = "تعذر تشغيل الكاميرا";
    }
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

    // Standard unmirrored capture for AI engine
    offCtx.drawImage(videoElement, 0, 0, offCanvas.width, offCanvas.height);
    return offCanvas.toDataURL("image/jpeg", 0.90);
}

// Switch Tabs
function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll(".tab-view").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach(el => {
        el.classList.remove("border-cyan-500", "text-cyan-400", "bg-cyan-500/10");
        el.classList.add("border-transparent", "text-slate-400");
    });

    const activeView = document.getElementById(`view-${tabId}`);
    const activeBtn = document.getElementById(`tabBtn-${tabId}`);
    if (activeView) activeView.classList.remove("hidden");
    if (activeBtn) {
        activeBtn.classList.remove("border-transparent", "text-slate-400");
        activeBtn.classList.add("border-cyan-500", "text-cyan-400", "bg-cyan-500/10");
    }

    if (tabId === "users") loadUsersList();
    if (tabId === "attendance") loadAttendanceList();
    if (tabId === "logs") loadLogsList();
    if (tabId !== "scan") {
        stopAutoScan();
    }
}

// Futuristic Cyber HUD Drawing (Landmarks, Corner brackets, Connection Mesh)
function drawCyberHUD(box, status, label) {
    if (!ctx || !box) return;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const x = box.x;
    const y = box.y;
    const w = box.width;
    const h = box.height;

    let primaryColor = "#38bdf8"; // Cyan
    if (status === "GRANTED") primaryColor = "#10b981"; // Emerald
    else if (status === "DENIED") primaryColor = "#ef4444"; // Red
    else if (status === "UNKNOWN") primaryColor = "#f59e0b"; // Amber

    // 1. Draw corner brackets
    const cornerLen = Math.min(24, Math.floor(w / 4));
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(x, y + cornerLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cornerLen, y);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + cornerLen);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(x, y + h - cornerLen);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + cornerLen, y + h);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - cornerLen);
    ctx.stroke();

    // Bounding box subtle glow fill
    ctx.fillStyle = primaryColor + "15";
    ctx.fillRect(x, y, w, h);

    // 2. Draw 5 Facial Landmark Nodes & Mesh Lines
    if (box.landmarks && box.landmarks.length >= 5) {
        ctx.fillStyle = primaryColor;
        ctx.strokeStyle = primaryColor + "60";
        ctx.lineWidth = 1;

        // Draw connecting mesh lines between eyes, nose and mouth
        const lms = box.landmarks;
        const re = lms.find(l => l.name === "right_eye") || lms[0];
        const le = lms.find(l => l.name === "left_eye") || lms[1];
        const no = lms.find(l => l.name === "nose") || lms[2];
        const rm = lms.find(l => l.name === "right_mouth") || lms[3];
        const lm = lms.find(l => l.name === "left_mouth") || lms[4];

        if (re && le && no && rm && lm) {
            ctx.beginPath();
            ctx.moveTo(re.x, re.y);
            ctx.lineTo(le.x, le.y);
            ctx.lineTo(no.x, no.y);
            ctx.closePath();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(no.x, no.y);
            ctx.lineTo(rm.x, rm.y);
            ctx.lineTo(lm.x, lm.y);
            ctx.closePath();
            ctx.stroke();
        }

        // Draw circles on landmark points
        box.landmarks.forEach(lm => {
            ctx.beginPath();
            ctx.arc(lm.x, lm.y, 3.5, 0, 2 * Math.PI);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
    }

    // 3. Top Label Badge
    if (label) {
        ctx.fillStyle = primaryColor;
        ctx.font = "bold 13px Cairo, sans-serif";
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x, Math.max(0, y - 26), textWidth + 14, 24);

        ctx.fillStyle = "#020617";
        ctx.fillText(label, x + 7, Math.max(16, y - 9));
    }

    // 4. Update Multi-Face Warning Banner
    const multiAlert = document.getElementById("multiFaceAlert");
    if (multiAlert) {
        if (box.faces_count && box.faces_count > 1) {
            multiAlert.classList.remove("hidden");
        } else {
            multiAlert.classList.add("hidden");
        }
    }

    // 5. Update Liveness / Sharpness Telemetry Badge
    const livenessBadge = document.getElementById("hudLivenessBadge");
    const sharpnessVal = document.getElementById("hudSharpnessVal");
    if (livenessBadge && sharpnessVal && box.sharpness !== undefined) {
        livenessBadge.classList.remove("hidden");
        sharpnessVal.innerText = box.sharpness;
    }

    // Clear after 3.5s
    setTimeout(() => {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        if (multiAlert) multiAlert.classList.add("hidden");
        if (livenessBadge) livenessBadge.classList.add("hidden");
    }, 3500);
}

// Scan Face Once from Live Webcam
async function scanFaceOnce() {
    const imageBase64 = captureFrameBase64();
    if (!imageBase64) {
        alert("يرجى التأكد من تشغيل كاميرا الكمبيوتر أولاً.");
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
    if (statusText) statusText.innerText = "MATCHING BIOMETRIC EMBEDDING...";

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

        // Update stats
        updateStats();
    } catch (err) {
        console.error("Verification failed:", err);
        if (statusText) statusText.innerText = "فشل الاتصال بالنظام";
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
        speakVoice(`أهلاً بك يا ${data.user.name}. تم التحقق من الهوية ومنح الإذن بالدخول.`);
        statusText.innerText = `IDENTIFIED: ${data.user.name} (GRANTED)`;
        drawCyberHUD(data.face_box, "GRANTED", `${data.user.name} (${data.confidence}%)`);

        // Save session token in cookie & localStorage
        if (data.token) {
            localStorage.setItem("face_session_token", data.token);
            document.cookie = `face_session_token=${data.token}; path=/; max-age=86400; SameSite=Lax`;
            const navLink = document.getElementById("navPortalLink");
            if (navLink) navLink.href = data.redirect_url;
        }

        stopAutoScan();

        card.innerHTML = `
            <div class="bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-900 border-2 border-emerald-500/50 rounded-2xl p-6 shadow-2xl glow-granted">
                <div class="flex items-center gap-2 text-emerald-400 font-extrabold text-sm mb-3">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                    ✅ تم التحقق من الهوية بنجاح - مصرح لك بالدخول!
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
                    <span>تم فتح جلسة أمان مصرحة وتوثيق تسجيل الحضور بنجاح.</span>
                    <span id="autoRedirectCountdown" class="text-emerald-400 font-bold font-mono">التحويل خلال 3 ثوانٍ...</span>
                </div>

                <div class="flex flex-col sm:flex-row gap-3">
                    <a href="${data.redirect_url}" class="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-extrabold text-sm rounded-xl transition duration-200 text-center shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2">
                        <span>🚀 فتح مساحة العمل المحمية الآن</span>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                    </a>
                </div>
            </div>
        `;

        // 3s Auto-redirect timer
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
        speakVoice(`تم التعرف على ${data.user.name}. ولكن تم رفض الدخول لعدم وجود صلاحية.`);
        statusText.innerText = `IDENTIFIED: ${data.user.name} (DENIED)`;
        drawCyberHUD(data.face_box, "DENIED", `${data.user.name} (محظور)`);

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
                </div>

                <button onclick="switchTab('users')" class="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition">
                    الانتقال لقائمة المستخدمين لتفعيل الصلاحية
                </button>
            </div>
        `;
    } else if (data.status === "UNKNOWN") {
        playAccessDeniedSound();
        speakVoice("عذراً، هذا الوجه غير مسجل في النظام.");
        statusText.innerText = "UNKNOWN FACE DETECTED";
        drawCyberHUD(data.face_box, "UNKNOWN", "غير مسجل");

        card.innerHTML = `
            <div class="bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-900 border-2 border-amber-500/40 rounded-2xl p-6 shadow-2xl">
                <div class="flex items-center gap-2 text-amber-400 font-extrabold text-sm mb-3">
                    <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                    ❌ الوجه غير مسجل في النظام!
                </div>

                <p class="text-xs text-slate-300 mb-4 leading-relaxed">
                    لم يتم العثور على أي تطابق مع الوجوه المسجلة في قاعدة البيانات. هذا الشخص غير مصرح له بفتح النظام.
                </p>

                <div class="flex gap-3">
                    <button onclick="switchTab('register')" class="flex-1 py-2.5 px-4 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs rounded-xl transition">
                        تسجيل هذا الوجه كشخص جديد الآن
                    </button>
                    <button onclick="scanFaceOnce()" class="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 transition">
                        إعادة المسح
                    </button>
                </div>
            </div>
        `;
    } else {
        statusText.innerText = data.message || "NO FACE DETECTED";
        card.innerHTML = `
            <div class="p-5 bg-slate-900 border border-slate-800 rounded-2xl text-center">
                <p class="text-xs text-amber-400 font-bold mb-2">${data.message || "لم يتم العثور على وجه واضح"}</p>
                <p class="text-[11px] text-slate-500">يرجى الجلوس أمام الكاميرا وضبط الإضاءة.</p>
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

// Multi-Angle Face Capture State (3D Profile)
const capturedAngles = {
    center: null,
    right: null,
    left: null,
    up: null,
    down: null
};
let wizardRunning = false;
let wizardTimeout = null;

function captureSpecificAngle(angleKey) {
    const snap = captureFrameBase64();
    if (!snap) {
        alert("يرجى التأكد من تشغيل كاميرا الكمبيوتر.");
        return;
    }

    capturedAngles[angleKey] = snap;
    playAngleCaptureBeep();

    const thumb = document.getElementById(`thumb-${angleKey}`);
    if (thumb) {
        thumb.innerHTML = `<img src="${snap}" class="w-full h-full object-cover">`;
    }

    const badge = document.getElementById(`badge-${angleKey}`);
    if (badge) {
        badge.innerText = "✅ تم";
        badge.className = "text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold";
    }
    const card = document.getElementById(`card-${angleKey}`);
    if (card) {
        card.classList.remove("border-slate-700/70");
        card.classList.add("border-cyan-500/60", "bg-cyan-950/20");
    }

    updateAngleMetrics();
}

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
            card.classList.remove("border-cyan-500/60", "bg-cyan-950/20");
            card.classList.add("border-slate-700/70");
        }
    }
    updateAngleMetrics();
}

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
            badge.className = "text-xs font-bold text-cyan-400";
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
        btn.innerHTML = `<svg class="w-4 h-4 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg><span>🚀 بدء المعالج الذكي لالتقاط كل الزوايا تلقائياً (5 زوايا بالتتابع)</span>`;
    }
}

async function startGuidedAngleCapture() {
    if (wizardRunning) {
        stopWizard();
        return;
    }

    const steps = [
        { key: "center", title: "🎯 انظر مباشرة للأمام للكاميرا بدون حركة", desc: "الزاوية 1: المركز والأمام", voice: "انظر مباشرة للأمام" },
        { key: "right", title: "➡️ أمل وجهك قليلاً جهة اليمين", desc: "الزاوية 2: اليمين", voice: "أمل وجهك قليلاً جهة اليمين" },
        { key: "left", title: "⬅️ أمل وجهك قليلاً جهة اليسار", desc: "الزاوية 3: اليسار", voice: "أمل وجهك جهة اليسار" },
        { key: "up", title: "⬆️ ارفع رأسك قليلاً للأعلى", desc: "الزاوية 4: الأعلى", voice: "ارفع رأسك للأعلى" },
        { key: "down", title: "⬇️ أمل رأسك قليلاً للأسفل", desc: "الزاوية 5: الأسفل", voice: "أمل رأسك للأسفل" }
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

    for (let i = 0; i < steps.length; i++) {
        if (!wizardRunning) break;
        const step = steps[i];

        const card = document.getElementById(`card-${step.key}`);
        if (card) card.classList.add("ring-2", "ring-cyan-400");

        if (instText) instText.innerText = step.title;
        if (hudStep) hudStep.innerText = `${i + 1}/5`;
        if (hudTitle) hudTitle.innerText = step.title;
        if (hudSub) hudSub.innerText = step.desc;

        // Speak instruction
        speakVoice(step.voice);

        // 3s Countdown
        for (let sec = 3; sec > 0; sec--) {
            if (!wizardRunning) break;
            if (hudCount) hudCount.innerText = sec;
            if (countText) countText.innerText = `التقاط (${step.desc}) خلال ${sec} ثوانٍ... ثبّت وجهك`;
            await new Promise(r => { wizardTimeout = setTimeout(r, 1000); });
        }

        if (!wizardRunning) break;

        triggerCameraFlash();
        captureSpecificAngle(step.key);

        if (hudCount) hudCount.innerText = "📸";
        if (countText) countText.innerText = `✅ تم التقاط (${step.desc})! الانتقال للزاوية التالية...`;
        if (card) card.classList.remove("ring-2", "ring-cyan-400");

        await new Promise(r => { wizardTimeout = setTimeout(r, 1100); });
    }

    if (wizardRunning) {
        playAccessGrantedSound();
        speakVoice("تم تسجيل جميع زوايا الوجه بنجاح.");
        if (hudStep) hudStep.innerText = "5/5";
        if (hudTitle) hudTitle.innerText = "🎉 اكتمل تسجيل الزوايا بنجاح!";
        if (hudCount) hudCount.innerText = "✅";
        if (hudSub) hudSub.innerText = "دقة بيومترية 100%! احفظ البروفايل بالأسفل";
        if (instText) instText.innerText = "🎉 تم التقاط جميع زوايا الوجه بنجاح (100% دقة بيومترية 3D)!";
        if (countText) countText.innerText = "اضغط على زر الحفظ بالأسفل لتوثيق البروفايل في النظام.";
        setTimeout(() => {
            stopWizard();
        }, 3000);
    }
}

// Access Toggle Switch
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

    const validAngles = {};
    for (let k in capturedAngles) {
        if (capturedAngles[k]) validAngles[k] = capturedAngles[k];
    }

    if (Object.keys(validAngles).length === 0) {
        const snap = captureFrameBase64();
        if (!snap) {
            alert("يرجى تشغيل كاميرا الكمبيوتر لالتقاط الوجه.");
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

            speakVoice(`تم تسجيل ${name} بنجاح في النظام.`);

            document.getElementById("regName").value = "";
            document.getElementById("regEmail").value = "";
            document.getElementById("regNotes").value = "";
            resetAllAngles();

            updateStats();
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
            <div class="bg-slate-800/60 border ${user.has_access ? 'border-slate-700/60' : 'border-red-500/30'} rounded-2xl p-4 flex flex-col justify-between hover:border-cyan-500/50 transition">
                <div class="flex items-center gap-3 mb-3">
                    <img src="${user.photo_path || '/static/placeholder.jpg'}" class="w-12 h-12 rounded-xl object-cover ring-2 ${user.has_access ? 'ring-emerald-500/50' : 'ring-red-500/50'}">
                    <div class="flex-1 min-w-0">
                        <h4 class="text-sm font-bold text-white truncate">${user.name}</h4>
                        <p class="text-[11px] text-slate-400 truncate">${user.email}</p>
                        <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span class="inline-block text-[10px] px-2 py-0.5 rounded bg-slate-700/80 text-slate-300">${user.role}</span>
                            ${user.angles_count > 1 
                                ? `<span class="inline-block text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">📐 ${user.angles_count} زوايا (3D)</span>`
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

// Load Attendance List for Tab 4
async function loadAttendanceList(selectedDate = null) {
    const tbody = document.getElementById("attendanceTableBody");
    const dateInput = document.getElementById("attendanceDatePicker");

    if (dateInput && !dateInput.value) {
        const todayStr = new Date().toISOString().split("T")[0];
        dateInput.value = todayStr;
    }

    const queryDate = selectedDate || (dateInput ? dateInput.value : "");
    const url = queryDate ? `/api/attendance?date=${queryDate}` : "/api/attendance";

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-500">لا يوجد موظفون مسجلون في النظام حتى الآن</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(item => {
            const statusBadge = item.is_present 
                ? `<span class="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold flex items-center gap-1.5 w-fit"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>حاضر الآن</span>`
                : `<span class="px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-medium">غائب</span>`;

            return `
                <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-3 px-4">
                        <div class="flex items-center gap-2.5">
                            <img src="${item.photo_path || '/static/placeholder.jpg'}" class="w-8 h-8 rounded-lg object-cover ring-1 ring-slate-700">
                            <div>
                                <p class="font-bold text-white">${item.name}</p>
                                <p class="text-[10px] text-slate-400">${item.email}</p>
                            </div>
                        </div>
                    </td>
                    <td class="py-3 px-4 text-slate-300">${item.role}</td>
                    <td class="py-3 px-4">${statusBadge}</td>
                    <td class="py-3 px-4 font-mono text-cyan-400">${item.first_in}</td>
                    <td class="py-3 px-4 font-mono text-slate-300">${item.last_seen}</td>
                    <td class="py-3 px-4 font-semibold text-slate-200">${item.duration}</td>
                    <td class="py-3 px-4 font-mono text-slate-400">${item.total_scans}</td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        console.error("Load attendance failed:", err);
    }
}

// Load Logs for Tab 5
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

// Update Header Stats
async function updateStats() {
    try {
        const resUsers = await fetch("/api/users");
        const users = await resUsers.json();
        const total = users.length;
        const active = users.filter(u => u.has_access === 1 || u.has_access === true).length;

        const elTotal = document.getElementById("statTotalUsers");
        const elActive = document.getElementById("statActiveUsers");
        if (elTotal) elTotal.innerText = total;
        if (elActive) elActive.innerText = active;

        const resAtt = await fetch("/api/attendance");
        if (resAtt.ok) {
            const att = await resAtt.json();
            const present = att.filter(a => a.is_present).length;
            const elPresent = document.getElementById("statPresentToday");
            if (elPresent) elPresent.innerText = present;
        }
    } catch (e) {
        console.error(e);
    }
}

// Auto start camera on desktop load
window.addEventListener("DOMContentLoaded", () => {
    initCamera();
});
