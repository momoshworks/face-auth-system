// Enterprise Smart Attendance Station - Client JS
let videoElement = document.getElementById("webcam");
let overlayCanvas = document.getElementById("overlayCanvas");
let ctx = overlayCanvas ? overlayCanvas.getContext("2d") : null;
let drawBoxTimeout = null;

function syncVideoAndCanvasDimensions() {
    if (!videoElement || videoElement.videoWidth === 0) return;
    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    if (overlayCanvas.width !== vw || overlayCanvas.height !== vh) {
        overlayCanvas.width = vw;
        overlayCanvas.height = vh;
    }
    const container = document.getElementById("videoContainer");
    if (container) {
        container.style.aspectRatio = `${vw} / ${vh}`;
    }
    const statusEl = document.getElementById("camDeviceStatus");
    if (statusEl) statusEl.innerText = `${vw}x${vh} • جاهز`;
}
let currentStream = null;
let autoScanInterval = null;
let isScanning = false;
let selectedCameraDeviceId = "";

// Live Clock & Date
function updateLiveClock() {
    const clockEl = document.getElementById("liveClock");
    const dateEl = document.getElementById("liveDate");
    const now = new Date();

    if (clockEl) {
        clockEl.innerText = now.toLocaleTimeString("en-US", { hour12: true });
    }
    if (dateEl) {
        dateEl.innerText = now.toLocaleDateString("ar-EG", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }
}
setInterval(updateLiveClock, 1000);
updateLiveClock();

// Fullscreen Kiosk Toggle
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log("Fullscreen error:", err);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// Populate Camera Devices Dropdown
async function populateWebcamDevices() {
    const select = document.getElementById("cameraDeviceSelect");
    if (!select || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === "videoinput");

        select.innerHTML = "";
        if (videoInputs.length === 0) {
            select.innerHTML = `<option value="">الكاميرا الافتراضية للكمبيوتر</option>`;
            return;
        }

        videoInputs.forEach((device, index) => {
            const opt = document.createElement("option");
            opt.value = device.deviceId;
            opt.innerText = device.label || `كاميرا رقم ${index + 1}`;
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

// Initialize Camera Natively on PC
async function initCamera() {
    const errorNotice = document.getElementById("camErrorNotice");
    if (errorNotice) errorNotice.classList.add("hidden");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (errorNotice) errorNotice.classList.remove("hidden");
        return;
    }

    try {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }

        const constraints = {
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        };

        if (selectedCameraDeviceId) {
            constraints.video.deviceId = { exact: selectedCameraDeviceId };
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream;
        videoElement.srcObject = stream;

        videoElement.onloadedmetadata = syncVideoAndCanvasDimensions;
        videoElement.oncanplay = syncVideoAndCanvasDimensions;
        videoElement.onplay = syncVideoAndCanvasDimensions;

        try {
            await videoElement.play();
        } catch (e) {}

        syncVideoAndCanvasDimensions();

        await populateWebcamDevices();
        startAutoScanning();
    } catch (err) {
        console.error("Camera access error:", err);
        if (errorNotice) errorNotice.classList.remove("hidden");
    }
}

// Frame capture as Base64 JPEG
function captureFrameBase64() {
    if (!videoElement || videoElement.videoWidth === 0) return null;
    syncVideoAndCanvasDimensions();
    const offCanvas = document.createElement("canvas");
    offCanvas.width = videoElement.videoWidth;
    offCanvas.height = videoElement.videoHeight;
    const offCtx = offCanvas.getContext("2d");
    offCtx.drawImage(videoElement, 0, 0, offCanvas.width, offCanvas.height);
    return offCanvas.toDataURL("image/jpeg", 0.90);
}

// Smooth Continuous Attendance Scanning
function startAutoScanning() {
    if (autoScanInterval) clearInterval(autoScanInterval);
    autoScanInterval = setInterval(() => {
        if (!isScanning) {
            scanFaceOnce(true);
        }
    }, 2200);
}

// Single Face Scan Execution
async function scanFaceOnce(isAuto = false) {
    if (isScanning) return;
    const imageBase64 = captureFrameBase64();
    if (!imageBase64) return;

    const btn = document.getElementById("btnManualScan");
    const resultCard = document.getElementById("verifyResultCard");
    const idleState = document.getElementById("verifyIdleState");

    isScanning = true;
    if (!isAuto && btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> جاري التحقق من الوجه...`;
    }

    try {
        const response = await fetch("/api/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: imageBase64 })
        });
        const data = await response.json();

        if (data.status === "NO_FACE") {
            // Clear canvas when no face is present
            if (ctx) ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        } else {
            if (idleState) idleState.classList.add("hidden");
            if (resultCard) resultCard.classList.remove("hidden");

            renderVerificationResult(data);
        }
    } catch (err) {
        console.error("Verification failed:", err);
    } finally {
        isScanning = false;
        if (!isAuto && btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/></svg> <span>فحص ومطابقة الوجه الآن</span>`;
        }
    }
}

// Clean Enterprise Face Box Drawing with Correct Selfie Mirror Alignment
function drawCleanFaceBox(box, status, label) {
    if (!ctx || !box) return;
    syncVideoAndCanvasDimensions();
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const cw = overlayCanvas.width;
    const ch = overlayCanvas.height;
    const w = box.width;
    const h = box.height;

    // The webcam video element has CSS `transform: -scale-x-100` for a natural selfie mirror experience.
    // The overlayCanvas is NOT mirrored so text and badges are always sharp and upright (never reversed!).
    // To match the mirrored selfie video exactly, we mirror the X coordinate:
    // Sensor X: box.x -> Screen X: cw - (box.x + w)
    const x = Math.max(0, Math.min(cw - w, cw - (box.x + w)));
    const y = Math.max(0, Math.min(ch - h, box.y));

    let color = "#3b82f6"; // Blue
    if (status === "GRANTED") color = "#10b981"; // Emerald
    else if (status === "DENIED") color = "#f43f5e"; // Rose
    else if (status === "UNKNOWN") color = "#f59e0b"; // Amber

    // 1. Sleek corporate bounding frame with rounded corners
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.stroke();

    // 2. Corner brackets for modern biometric focus accent
    const cornerLen = Math.min(18, Math.floor(w / 4));
    ctx.lineWidth = 4;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(x, y + cornerLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cornerLen, y);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + cornerLen);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(x, y + h - cornerLen);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + cornerLen, y + h);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - cornerLen);
    ctx.stroke();

    // 3. Upright, readable text badge
    if (label) {
        ctx.font = "bold 13px 'Cairo', system-ui, sans-serif";
        const textMetrics = ctx.measureText(label);
        const badgeWidth = Math.max(90, textMetrics.width + 24);
        const badgeHeight = 28;

        // Position badge above box, or below if too close to top
        let badgeY = (y >= badgeHeight + 6) ? (y - badgeHeight - 4) : (y + 6);
        let badgeX = Math.max(4, Math.min(x, cw - badgeWidth - 4));

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 6);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, badgeX + (badgeWidth / 2), badgeY + (badgeHeight / 2));
    }

    if (drawBoxTimeout) clearTimeout(drawBoxTimeout);
    drawBoxTimeout = setTimeout(() => {
        if (ctx) ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }, 2800);
}

// Render Result Card Cleanly
function renderVerificationResult(data) {
    const card = document.getElementById("verifyResultCard");
    if (!card) return;

    const confVal = Math.round(data.confidence || 0);

    if (data.status === "GRANTED") {
        drawCleanFaceBox(data.face_box, "GRANTED", `${data.user.name} (${confVal}%)`);

        card.innerHTML = `
            <div class="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 shadow-lg space-y-3">
                <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <span class="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                        تم تسجيل الحضور بنجاح
                    </span>
                    <span class="text-xs font-mono text-slate-400">${data.checkin_time || "الآن"}</span>
                </div>

                <div class="flex items-center gap-3">
                    <img src="${data.user.photo_url || '/static/placeholder.jpg'}" class="w-12 h-12 rounded-xl object-cover ring-2 ring-emerald-500/40 shadow-sm">
                    <div class="flex-1 min-w-0">
                        <h4 class="text-sm font-bold text-white truncate">${data.user.name}</h4>
                        <div class="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                            <span>${data.user.role}</span>
                            <span>•</span>
                            <span class="text-emerald-400 font-semibold font-mono">${confVal}% تطابق</span>
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-2 pt-1 flex-wrap">
                    ${data.is_admin ? `
                        <a href="/admin" class="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition text-center shadow">
                            ⚙️ دخول لوحة الإدارة
                        </a>
                    ` : ''}
                    <a href="${data.portal_url}" class="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs rounded-lg transition text-center font-semibold">
                        دخول مساحة العمل المشتركة
                    </a>
                </div>
            </div>
        `;

        // Update live attendance feed
        addEmployeeToLiveFeed({
            name: data.user.name,
            role: data.user.role,
            photo_path: data.user.photo_url,
            first_in: data.checkin_time || new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
        });

    } else if (data.status === "DENIED") {
        drawCleanFaceBox(data.face_box, "DENIED", `${data.user.name} (غير مصرح)`);

        card.innerHTML = `
            <div class="bg-slate-900 border border-rose-500/40 rounded-xl p-4 shadow-lg space-y-2">
                <div class="flex items-center gap-2 text-rose-400 text-xs font-bold">
                    <span class="w-2 h-2 rounded-full bg-rose-500"></span>
                    تم التعرف على الوجه، ولكن تم رفض الدخول
                </div>
                <div class="flex items-center gap-3">
                    <img src="${data.user.photo_url || '/static/placeholder.jpg'}" class="w-10 h-10 rounded-xl object-cover ring-1 ring-rose-500/40">
                    <div>
                        <h4 class="text-sm font-bold text-white">${data.user.name}</h4>
                        <p class="text-xs text-rose-300 mt-0.5">${data.reason || "تم إلغاء صلاحية الحساب من قبل الإدارة"}</p>
                    </div>
                </div>
            </div>
        `;
    } else if (data.status === "UNKNOWN") {
        drawCleanFaceBox(data.face_box, "UNKNOWN", "غير مسجل");

        card.innerHTML = `
            <div class="bg-slate-900 border border-amber-500/40 rounded-xl p-4 shadow-lg space-y-2 text-center">
                <div class="flex items-center justify-center gap-2 text-amber-400 text-xs font-bold">
                    <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                    الوجه غير مسجل في النظام
                </div>
                <p class="text-xs text-slate-300">
                    لم يتم العثور على أي تطابق مع الموظفين المسجلين. يرجى مراجعة إدارة النظام لتسجيل بصمتك.
                </p>
            </div>
        `;
    }
}

// Add verified employee live to the attendance table
function addEmployeeToLiveFeed(employee) {
    const tbody = document.getElementById("liveAttendanceTbody");
    const emptyRow = document.getElementById("emptyAttendanceNotice");
    if (emptyRow) emptyRow.remove();

    if (!tbody) return;

    const existing = tbody.querySelector(`[data-emp-name="${employee.name}"]`);
    if (existing) {
        existing.classList.add("bg-emerald-500/10");
        setTimeout(() => existing.classList.remove("bg-emerald-500/10"), 2000);
        return;
    }

    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-800/40 transition bg-emerald-500/10";
    tr.setAttribute("data-emp-name", employee.name);
    tr.innerHTML = `
        <td class="py-3 px-4">
            <div class="flex items-center gap-2.5">
                <img src="${employee.photo_path || '/static/placeholder.jpg'}" class="w-8 h-8 rounded-lg object-cover ring-1 ring-slate-700">
                <div>
                    <p class="font-bold text-white">${employee.name}</p>
                </div>
            </div>
        </td>
        <td class="py-3 px-4 text-slate-300">${employee.role}</td>
        <td class="py-3 px-4 font-mono text-blue-400 font-bold">${employee.first_in}</td>
        <td class="py-3 px-4">
            <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold inline-flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                تم تسجيل الحضور
            </span>
        </td>
    `;

    tbody.prepend(tr);
    setTimeout(() => tr.classList.remove("bg-emerald-500/10"), 2500);

    const countEl = document.getElementById("headerPresentCount");
    if (countEl) {
        const currentCount = tbody.querySelectorAll("tr").length;
        countEl.innerText = `${currentCount} حاضر اليوم`;
    }
}

// Refresh Live Attendance Feed
async function refreshLiveAttendanceFeed() {
    try {
        const res = await fetch("/api/attendance");
        const list = await res.json();
        const tbody = document.getElementById("liveAttendanceTbody");
        if (!tbody) return;

        const presentList = list.filter(item => item.is_present);
        if (presentList.length === 0) {
            tbody.innerHTML = `
                <tr id="emptyAttendanceNotice">
                    <td colspan="4" class="py-12 text-center text-slate-500">
                        <svg class="w-10 h-10 text-slate-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        <p class="text-xs font-semibold text-slate-400">لم يتم تسجيل حضور أي موظف اليوم بعد</p>
                        <p class="text-[11px] text-slate-500 mt-1">قف أمام الكاميرا لتسجيل أول حضور لليوم</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = presentList.map(c => `
            <tr class="hover:bg-slate-800/40 transition" data-emp-name="${c.name}">
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2.5">
                        <img src="${c.photo_path || '/static/placeholder.jpg'}" class="w-8 h-8 rounded-lg object-cover ring-1 ring-slate-700">
                        <div>
                            <p class="font-bold text-white">${c.name}</p>
                            <p class="text-[10px] text-slate-400">${c.email}</p>
                        </div>
                    </div>
                </td>
                <td class="py-3 px-4 text-slate-300">${c.role}</td>
                <td class="py-3 px-4 font-mono text-blue-400 font-bold">${c.first_in}</td>
                <td class="py-3 px-4">
                    <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold inline-flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        تم تسجيل الحضور
                    </span>
                </td>
            </tr>
        `).join("");

        const countEl = document.getElementById("headerPresentCount");
        if (countEl) countEl.innerText = `${presentList.length} حاضر اليوم`;
    } catch (e) {
        console.error("Refresh error:", e);
    }
}

// Auto start on load
window.addEventListener("DOMContentLoaded", () => {
    initCamera();
});
