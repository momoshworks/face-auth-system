// Admin Console Client Script
let adminCurrentTab = "attendance";
let adminStream = null;
let adminCapturedPhotoBase64 = null;
let adminUsersCache = [];

function switchAdminTab(tabId) {
    adminCurrentTab = tabId;
    document.querySelectorAll(".admin-view").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".admin-tab-btn").forEach(el => {
        el.classList.remove("border-blue-500", "text-blue-400", "bg-blue-500/10");
        el.classList.add("border-transparent", "text-slate-400");
    });

    const activeView = document.getElementById(`adminView-${tabId}`);
    const activeBtn = document.getElementById(`adminTabBtn-${tabId}`);
    if (activeView) activeView.classList.remove("hidden");
    if (activeBtn) {
        activeBtn.classList.remove("border-transparent", "text-slate-400");
        activeBtn.classList.add("border-blue-500", "text-blue-400", "bg-blue-500/10");
    }

    if (tabId === "register") {
        initAdminCamera();
    } else {
        stopAdminCamera();
    }

    if (tabId === "attendance") fetchAdminAttendance();
    if (tabId === "users") fetchAdminUsers();
    if (tabId === "logs") fetchAdminLogs();
}

// Admin Camera Management
async function initAdminCamera() {
    const video = document.getElementById("adminWebcam");
    if (!video) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("الكاميرا غير متاحة في هذا المتصفح.");
        return;
    }

    try {
        if (adminStream) {
            adminStream.getTracks().forEach(t => t.stop());
            adminStream = null;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });

        adminStream = stream;
        video.srcObject = stream;
        await video.play();
    } catch (e) {
        console.error("Admin camera error:", e);
    }
}

function stopAdminCamera() {
    if (adminStream) {
        adminStream.getTracks().forEach(t => t.stop());
        adminStream = null;
    }
}

function captureAdminPhoto() {
    const video = document.getElementById("adminWebcam");
    const canvas = document.getElementById("adminCaptureCanvas");
    if (!video || video.videoWidth === 0) {
        alert("يرجى التأكد من تشغيل الكاميرا أمامك.");
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    adminCapturedPhotoBase64 = canvas.toDataURL("image/jpeg", 0.92);

    const overlay = document.getElementById("adminSnapshotOverlay");
    const previewImg = document.getElementById("adminCapturedPreviewImg");
    if (previewImg && overlay) {
        previewImg.src = adminCapturedPhotoBase64;
        overlay.classList.remove("hidden");
    }
}

function retakeAdminPhoto() {
    adminCapturedPhotoBase64 = null;
    const overlay = document.getElementById("adminSnapshotOverlay");
    if (overlay) overlay.classList.add("hidden");
}

// Handle Admin New Employee Registration
async function handleAdminRegisterSubmit(event) {
    event.preventDefault();
    const btn = document.getElementById("btnAdminSubmitReg");
    const statusMsg = document.getElementById("adminRegStatusMsg");

    if (!adminCapturedPhotoBase64) {
        alert("يرجى التقاط صورة للوجه أولاً باستخدام زر 'التقاط صورة الوجه الأساسية'.");
        return;
    }

    const name = document.getElementById("adminRegName").value.trim();
    const email = document.getElementById("adminRegEmail").value.trim();
    const role = document.getElementById("adminRegRole").value;
    const hasAccess = document.getElementById("adminRegHasAccess").checked;
    const notes = document.getElementById("adminRegNotes").value.trim();

    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> جاري استخراج البصمة البيومترية وحفظ الموظف...`;
    statusMsg.classList.add("hidden");

    try {
        const res = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                email,
                role,
                has_access: hasAccess,
                notes,
                image: adminCapturedPhotoBase64
            })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            statusMsg.className = "p-3.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
            statusMsg.innerText = `✅ ${data.message}`;
            statusMsg.classList.remove("hidden");

            // Reset form
            document.getElementById("adminRegName").value = "";
            document.getElementById("adminRegEmail").value = "";
            document.getElementById("adminRegNotes").value = "";
            retakeAdminPhoto();

            // Refresh counts and users table
            fetchAdminMetrics();
            setTimeout(() => {
                switchAdminTab("users");
            }, 1800);
        } else {
            statusMsg.className = "p-3.5 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30";
            statusMsg.innerText = data.detail || "حدث خطأ أثناء التسجيل";
            statusMsg.classList.remove("hidden");
        }
    } catch (err) {
        statusMsg.className = "p-3.5 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30";
        statusMsg.innerText = "تعذر الاتصال بالخادم.";
        statusMsg.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg> <span>حفظ وتوثيق بصمة الموظف في النظام</span>`;
    }
}

// Fetch Attendance Table
async function fetchAdminAttendance(selectedDate = null) {
    const tbody = document.getElementById("adminAttendanceTableBody");
    const dateInput = document.getElementById("adminAttendanceDatePicker");
    const exportBtn = document.getElementById("btnExportAttendanceCsv");

    const queryDate = selectedDate || (dateInput ? dateInput.value : "");
    const url = queryDate ? `/api/attendance?date=${queryDate}` : "/api/attendance";
    if (exportBtn) {
        exportBtn.href = queryDate ? `/api/attendance/export?date=${queryDate}` : "/api/attendance/export";
    }

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-500">لا يوجد موظفون مسجلون في النظام حتى الآن</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(item => `
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
                <td class="py-3 px-4">
                    ${item.is_present 
                        ? `<span class="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold inline-flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>حاضر</span>`
                        : `<span class="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">غائب</span>`
                    }
                </td>
                <td class="py-3 px-4 font-mono text-blue-400">${item.first_in}</td>
                <td class="py-3 px-4 font-mono text-slate-300">${item.last_seen}</td>
                <td class="py-3 px-4 text-slate-200 font-semibold">${item.duration}</td>
                <td class="py-3 px-4 font-mono text-slate-400">${item.total_scans}</td>
            </tr>
        `).join("");
    } catch (e) {
        console.error("Attendance fetch error:", e);
    }
}

// Fetch Users List
async function fetchAdminUsers() {
    const tbody = document.getElementById("adminUsersTableBody");
    try {
        const res = await fetch("/api/users");
        const users = await res.json();
        adminUsersCache = users || [];
        renderAdminUsersTable(adminUsersCache);
    } catch (e) {
        console.error("Users fetch error:", e);
    }
}

function renderAdminUsersTable(users) {
    const tbody = document.getElementById("adminUsersTableBody");
    if (!users || users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-500">لا يوجد موظفون مسجلون بعد. توجه لتبويب "إضافة موظف جديد".</td></tr>`;
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr class="hover:bg-slate-800/40 transition">
            <td class="py-3 px-4">
                <div class="flex items-center gap-3">
                    <img src="${user.photo_path || '/static/placeholder.jpg'}" class="w-9 h-9 rounded-xl object-cover ring-1 ring-slate-700">
                    <div>
                        <p class="font-bold text-white">${user.name}</p>
                        <p class="text-[10px] text-slate-400 font-mono">${user.email}</p>
                    </div>
                </div>
            </td>
            <td class="py-3 px-4 text-slate-300">${user.role}</td>
            <td class="py-3 px-4 font-mono text-slate-400">${user.created_at || "-"}</td>
            <td class="py-3 px-4">
                <button onclick="toggleAdminUserAccess(${user.id})" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                    user.has_access 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20' 
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'
                }">
                    <span>${user.has_access ? '✅ مسموح بالدخول' : '⛔ معطل (محظور)'}</span>
                    <span class="text-[10px] opacity-75">(تعديل)</span>
                </button>
            </td>
            <td class="py-3 px-4 text-center">
                <button onclick="deleteAdminUser(${user.id}, '${user.name}')" class="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition" title="حذف الموظف">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </td>
        </tr>
    `).join("");
}

function filterAdminUsersTable(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
        renderAdminUsersTable(adminUsersCache);
        return;
    }
    const filtered = adminUsersCache.filter(u => 
        (u.name && u.name.toLowerCase().includes(q)) || 
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.role && u.role.toLowerCase().includes(q))
    );
    renderAdminUsersTable(filtered);
}

async function toggleAdminUserAccess(userId) {
    try {
        const res = await fetch(`/api/users/${userId}/toggle-access`, { method: "POST" });
        if (res.ok) {
            fetchAdminUsers();
        }
    } catch (e) {
        console.error(e);
    }
}

async function deleteAdminUser(userId, name) {
    if (!confirm(`هل أنت متأكد من حذف الموظف: "${name}" نهائياً من النظام؟`)) return;
    try {
        const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
        if (res.ok) {
            fetchAdminUsers();
            fetchAdminMetrics();
        }
    } catch (e) {
        console.error(e);
    }
}

// Fetch Audit Logs
async function fetchAdminLogs() {
    const tbody = document.getElementById("adminLogsTableBody");
    try {
        const res = await fetch("/api/logs");
        const logs = await res.json();

        if (!logs || logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-500">لا توجد محاولات مسجلة حتى الآن</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(log => `
            <tr class="hover:bg-slate-800/40 transition">
                <td class="py-3 px-4 font-mono text-slate-400">${log.timestamp}</td>
                <td class="py-3 px-4 font-bold text-white">${log.user_name || "مجهول"}</td>
                <td class="py-3 px-4">
                    ${log.status === "GRANTED" 
                        ? `<span class="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold">مقبول ومصرح له ✅</span>`
                        : (log.status === "DENIED_NO_ACCESS" 
                            ? `<span class="px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 font-semibold">مرفوض (بدون صلاحية) ⛔</span>`
                            : `<span class="px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">وجه غير معروف ❌</span>`
                        )
                    }
                </td>
                <td class="py-3 px-4 font-mono text-slate-300">${log.confidence}%</td>
            </tr>
        `).join("");
    } catch (e) {
        console.error(e);
    }
}

// Admin Metrics Updater
async function fetchAdminMetrics() {
    try {
        const resAtt = await fetch("/api/attendance");
        if (resAtt.ok) {
            const data = await resAtt.json();
            const total = data.length;
            const present = data.filter(d => d.is_present).length;
            const absent = total - present;
            const rate = total > 0 ? Math.round((present / total) * 100) : 0;

            const elTotal = document.getElementById("metricTotalUsers");
            const elPres = document.getElementById("metricPresentCount");
            const elAbs = document.getElementById("metricAbsentCount");
            const elRate = document.getElementById("metricAttendanceRate");

            if (elTotal) elTotal.innerText = total;
            if (elPres) elPres.innerText = present;
            if (elAbs) elAbs.innerText = absent;
            if (elRate) elRate.innerText = `${rate}%`;
        }
    } catch (e) {}
}

// Password Change Handler
async function handleAdminPasswordChange(event) {
    event.preventDefault();
    const oldPass = document.getElementById("adminOldPass").value;
    const newPass = document.getElementById("adminNewPass").value;
    const msg = document.getElementById("adminPassChangeMsg");
    const btn = document.getElementById("btnAdminPassSubmit");

    btn.disabled = true;
    msg.classList.add("hidden");

    try {
        const formData = new FormData();
        formData.append("old_password", oldPass);
        formData.append("new_password", newPass);

        const res = await fetch("/api/admin/change-password", {
            method: "POST",
            body: formData
        });

        const data = await res.json();
        if (res.ok && data.success) {
            msg.className = "p-3 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
            msg.innerText = "✅ " + data.message;
            msg.classList.remove("hidden");
            document.getElementById("adminOldPass").value = "";
            document.getElementById("adminNewPass").value = "";
        } else {
            msg.className = "p-3 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30";
            msg.innerText = "❌ " + (data.detail || "فشل تغيير كلمة المرور");
            msg.classList.remove("hidden");
        }
    } catch (e) {
        msg.className = "p-3 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30";
        msg.innerText = "❌ تعذر الاتصال بالخادم";
        msg.classList.remove("hidden");
    } finally {
        btn.disabled = false;
    }
}

// Init on DOM Load
window.addEventListener("DOMContentLoaded", () => {
    fetchAdminAttendance();
});
