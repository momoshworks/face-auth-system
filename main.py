import os
import uuid
import cv2
import secrets
import socket
import shutil
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Request, Form, HTTPException, Depends, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

import database as db
from face_engine import engine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(STORAGE_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

app = FastAPI(title="Face Recognition, Local Chat & Cloud Storage System", description="نظام التعرف على الوجه، الشات المحلي وسحابة تخزين الملفات")

# Mount static files, uploads, and shared storage
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

def get_local_ip() -> str:
    """الحصول على عنوان IP المحلي للجهاز على الشبكة"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# مدير اتصالات الشات المباشر عبر WebSockets
class ChatConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, data: dict):
        dead_connections = []
        for conn in self.active_connections:
            try:
                await conn.send_json(data)
            except Exception:
                dead_connections.append(conn)
        for dc in dead_connections:
            if dc in self.active_connections:
                self.active_connections.remove(dc)

chat_manager = ChatConnectionManager()

# In-memory session store: token -> user_dict
ACTIVE_SESSIONS = {}

def get_authenticated_admin(request: Request) -> Optional[Dict[str, Any]]:
    """
    التحقق الصارم من أن المستخدم مسجل في قاعدة البيانات ويمتلك صلاحية مدير النظام النشطة.
    لا يمكن لأي مستخدم غير مسجل في النظام الوصول إلى لوحة الإدارة إطلاقاً.
    """
    # 1. فحص توكن جلسة الإدارة المعتمدة
    admin_token = request.cookies.get("admin_session_token")
    if admin_token:
        user_info = ACTIVE_SESSIONS.get(admin_token) or db.get_session_user(admin_token)
        if user_info and user_info.get("has_access"):
            role = user_info.get("role", "").lower()
            if "admin" in role or "مدير" in role:
                return user_info

    # 2. فحص توكن بصمة الوجه المعتمد
    face_token = request.cookies.get("face_session_token")
    if face_token:
        user_info = ACTIVE_SESSIONS.get(face_token) or db.get_session_user(face_token)
        if user_info and user_info.get("has_access"):
            role = user_info.get("role", "").lower()
            if "admin" in role or "مدير" in role:
                return user_info

    return None

def is_admin_authenticated(request: Request) -> bool:
    """التحقق هل يملك المستخدم جلسة إدارة صالحة لمستخدم مسجل بالفعل كمدير"""
    return get_authenticated_admin(request) is not None

class FaceVerifyRequest(BaseModel):
    image: str  # Base64 data URL

class PresenceCheckRequest(BaseModel):
    token: str
    image: str

class AdminLoginRequest(BaseModel):
    identifier: str  # البريد الإلكتروني أو الاسم للمدير المسجل في النظام
    password: str

class RegisterRequest(BaseModel):
    name: str
    email: str
    role: str = "User"
    has_access: bool = True
    notes: Optional[str] = ""
    image: Optional[str] = None  # Base64 data URL أحادي
    images: Optional[dict] = None  # Base64 data URLs لعدة زوايا {"center": "...", "right": "...", "left": "...", "up": "...", "down": "..."}

@app.get("/api/network-info")
async def get_network_info():
    local_ip = get_local_ip()
    return {
        "local_ip": local_ip,
        "local_url": f"http://127.0.0.1:8000",
        "app_mode": "Desktop Workstation"
    }

@app.get("/", response_class=HTMLResponse)
async def home_page(request: Request):
    """شاشة تسجيل الحضور والانصراف الرئيسية المخصصة للكمبيوتر (Kiosk Mode)"""
    attendance = db.get_daily_attendance()
    present_today = [a for a in attendance if a["is_present"]]
    total_users = len(attendance)
    is_admin = is_admin_authenticated(request)
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "total_users": total_users,
            "present_count": len(present_today),
            "recent_checkins": present_today,
            "is_admin": is_admin
        }
    )

@app.get("/admin/login", response_class=HTMLResponse)
async def admin_login_page(request: Request):
    """صفحة تسجيل الدخول للوحة الإدارة"""
    if is_admin_authenticated(request):
        return RedirectResponse(url="/admin", status_code=303)
    return templates.TemplateResponse(request=request, name="admin_login.html")

@app.post("/api/admin/verify-face")
async def admin_verify_face(data: FaceVerifyRequest):
    """
    تسجيل الدخول للوحة الإدارة ببصمة وجه المدير:
    يجب أن يكون الوجه مسجلاً مسبقاً في النظام ومعه صلاحية مدير (Admin / مدير) ونشط.
    إذا لم يكن مسجلاً، يتم الرفض فوراً وبشكل قاطع.
    """
    img = engine.decode_base64_image(data.image)
    if img is None:
        return JSONResponse(status_code=400, content={"status": "ERROR", "message": "فشل في قراءة صورة الكاميرا"})

    embedding, face_box, status_msg = engine.extract_face_embedding(img)
    if embedding is None:
        return JSONResponse(status_code=200, content={"status": "NO_FACE", "message": status_msg})

    registered_users = db.get_all_user_embeddings()
    if not registered_users:
        return JSONResponse(status_code=403, content={
            "status": "DENIED",
            "message": "لا يوجد أي مستخدمين مسجلين في النظام بعد. لا يمكن الدخول إلا لمستخدم مسجل كمدير."
        })

    matched_user, best_score, conf_pct = engine.identify_face(embedding, registered_users)

    # 1. إذا كان الوجه غير مسجل في النظام إطلاقاً
    if matched_user is None:
        return JSONResponse(status_code=403, content={
            "status": "UNKNOWN",
            "message": "⛔ هذا الوجه غير مسجل في النظام! الدخول مخصص فقط للمدراء المسجلين مسبقاً."
        })

    # 2. التحقق من صلاحية الوصول
    if not matched_user.get("has_access"):
        return JSONResponse(status_code=403, content={
            "status": "DENIED",
            "message": f"⛔ تم التعرف على: {matched_user['name']} ولكن تم إيقاف صلاحية الدخول لهذا الحساب."
        })

    # 3. التحقق من رتبة المدير
    role = matched_user.get("role", "").lower()
    if not ("admin" in role or "مدير" in role):
        return JSONResponse(status_code=403, content={
            "status": "NOT_ADMIN",
            "message": f"⛔ مرحباً {matched_user['name']}، ولكن حسابك مسجل كموظف عادي ولا يملك صلاحية مدير النظام."
        })

    # 4. إذا كان مديراً ومسجلاً وصلاحيته نشطة: يتم توليد جلسة إدارة حقيقية مربوطة بالـ user_id
    admin_token = secrets.token_urlsafe(32)
    db.create_session(admin_token, matched_user["id"])
    ACTIVE_SESSIONS[admin_token] = {
        "id": matched_user["id"],
        "name": matched_user["name"],
        "email": matched_user["email"],
        "role": matched_user["role"],
        "has_access": True,
        "photo_url": matched_user["photo_path"],
        "login_time": datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
    }

    db.log_access_attempt(
        status="ADMIN_LOGIN_FACE",
        user_id=matched_user["id"],
        user_name=matched_user["name"],
        confidence=conf_pct,
        snapshot_path=None
    )

    response = JSONResponse(status_code=200, content={
        "status": "GRANTED",
        "success": True,
        "message": f"✅ مرحباً بك يا مدير النظام ({matched_user['name']})! تم توثيق هويتك البيومترية بنجاح.",
        "redirect": "/admin",
        "user": {
            "id": matched_user["id"],
            "name": matched_user["name"],
            "role": matched_user["role"],
            "confidence": conf_pct
        }
    })
    response.set_cookie(key="admin_session_token", value=admin_token, max_age=86400, path="/")
    response.set_cookie(key="face_session_token", value=admin_token, max_age=86400, path="/")
    return response

@app.post("/api/admin/login")
async def admin_login_api(data: AdminLoginRequest):
    """
    التحقق من هوية المدير المسجل في النظام وكلمة المرور:
    يشترط أن يكون البريد الإلكتروني أو الاسم ينتمي لمستخدم مسجل بالفعل في جدول users ويملك رتبة مدير.
    """
    identifier = data.identifier.strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="يرجى إدخال البريد الإلكتروني أو الاسم المسجل للمدير")

    # 1. التحقق من وجود المستخدم في قاعدة البيانات
    user = db.get_user_by_email_or_name(identifier)
    if user is None:
        raise HTTPException(
            status_code=403, 
            detail="⛔ هذا الحساب غير مسجل في النظام إطلاقاً! لا يمكن الدخول إلا للمستخدمين المسجلين مسبقاً كمدراء."
        )

    # 2. التحقق من رتبة المدير
    role = user.get("role", "").lower()
    if not ("admin" in role or "مدير" in role):
        raise HTTPException(
            status_code=403, 
            detail=f"⛔ المستخدم '{user['name']}' مسجل، ولكنه لا يملك صلاحية مدير النظام (رتبته: {user.get('role')})."
        )

    # 3. التحقق من حالة الصلاحية
    if not user.get("has_access"):
        raise HTTPException(status_code=403, detail="⛔ تم تعطيل صلاحية الدخول لهذا الحساب من قبل الإدارة.")

    # 4. التحقق من كلمة المرور
    current_pwd = db.get_admin_password()
    if data.password.strip() != current_pwd:
        raise HTTPException(status_code=401, detail="كلمة مرور الإدارة غير صحيحة")

    # 5. إنشاء جلسة معتمدة مربوطة بـ user_id الحقيقي في قاعدة البيانات
    admin_token = secrets.token_urlsafe(32)
    db.create_session(admin_token, user["id"])
    ACTIVE_SESSIONS[admin_token] = {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "has_access": True,
        "photo_url": user["photo_path"],
        "login_time": datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
    }

    db.log_access_attempt(
        status="ADMIN_LOGIN_PASSWORD",
        user_id=user["id"],
        user_name=user["name"],
        confidence=100.0,
        snapshot_path=None
    )

    response = JSONResponse(content={
        "success": True, 
        "redirect": "/admin",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "role": user["role"]
        }
    })
    response.set_cookie(key="admin_session_token", value=admin_token, max_age=86400, path="/")
    response.set_cookie(key="face_session_token", value=admin_token, max_age=86400, path="/")
    return response

@app.get("/admin/logout")
@app.post("/api/admin/logout")
async def admin_logout_api(request: Request):
    """تسجيل الخروج من لوحة الإدارة وإنهاء الجلسة"""
    token = request.cookies.get("admin_session_token")
    if token:
        db.delete_session(token)
        ACTIVE_SESSIONS.pop(token, None)
    face_token = request.cookies.get("face_session_token")
    if face_token:
        db.delete_session(face_token)
        ACTIVE_SESSIONS.pop(face_token, None)
    response = RedirectResponse(url="/admin/login", status_code=303)
    response.delete_cookie(key="admin_session_token", path="/")
    response.delete_cookie(key="face_session_token", path="/")
    return response

@app.post("/api/admin/change-password")
async def change_admin_password(request: Request, old_password: str = Form(...), new_password: str = Form(...)):
    """تغيير كلمة مرور الإدارة"""
    if not is_admin_authenticated(request):
        raise HTTPException(status_code=403, detail="هذه العملية مخصصة لمدير النظام فقط")
    curr = db.get_admin_password()
    if old_password.strip() != curr:
        raise HTTPException(status_code=400, detail="كلمة المرور الحالية غير صحيحة")
    if len(new_password.strip()) < 4:
        raise HTTPException(status_code=400, detail="كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل")
    db.set_admin_password(new_password.strip())
    return {"success": True, "message": "تم تغيير كلمة مرور الإدارة بنجاح"}

@app.get("/admin", response_class=HTMLResponse)
async def admin_panel(request: Request):
    """لوحة الإدارة والتحكم الشاملة - مخصصة حصرياً للمدير لإضافة الأعضاء وإدارة النظام"""
    admin_user = get_authenticated_admin(request)
    if not admin_user:
        return RedirectResponse(url="/admin/login", status_code=303)
    
    users = db.get_all_users()
    attendance = db.get_daily_attendance()
    present_count = sum(1 for a in attendance if a["is_present"])
    absent_count = len(attendance) - present_count
    attendance_rate = round((present_count / len(attendance) * 100), 1) if attendance else 0
    logs = db.get_recent_logs(50)
    
    return templates.TemplateResponse(
        request=request,
        name="admin.html",
        context={
            "current_admin": admin_user,
            "users": users,
            "attendance": attendance,
            "total_users": len(users),
            "present_count": present_count,
            "absent_count": absent_count,
            "attendance_rate": attendance_rate,
            "logs": logs,
            "today_date": datetime.now().strftime("%Y-%m-%d")
        }
    )

@app.post("/api/register")
async def register_user(request: Request, data: RegisterRequest):
    """
    تسجيل عضو / موظف جديد واستخراج بصمة الوجه وحفظ الملف الشخصي.
    متاح فقط لمدير النظام من لوحة الإدارة (Admin Panel).
    """
    if not is_admin_authenticated(request):
        raise HTTPException(status_code=403, detail="عفواً، تسجيل وإضافة الموظفين مسموح لمدير النظام فقط من لوحة الإدارة.")
    name = data.name.strip()
    email = data.email.strip()
    role = data.role.strip()
    has_access = data.has_access
    notes = (data.notes or "").strip()
    
    if not name or not email:
        raise HTTPException(status_code=400, detail="الاسم والبريد الإلكتروني مطلوبان")

    # 1) إذا تم إرسال صور متعددة للزوايا
    if data.images and len(data.images) > 0:
        stacked_embeddings, angle_boxes, errors = engine.process_multi_angle_images(data.images)
        if stacked_embeddings is None:
            err_details = " | ".join(errors) if errors else "لم يتم العثور على أي وجه في صور الزوايا الملتقطة"
            raise HTTPException(status_code=400, detail=f"فشل في استخراج زوايا الوجه: {err_details}")

        # الصورة الرئيسية للملف الشخصي (المركزية أو أول زاوية متاحة)
        primary_b64 = data.images.get("center") or next(iter(data.images.values()))
        primary_img = engine.decode_base64_image(primary_b64)
        
        filename = f"user_{uuid.uuid4().hex[:8]}.jpg"
        photo_path = os.path.join(UPLOADS_DIR, filename)
        if primary_img is not None:
            cv2.imwrite(photo_path, primary_img)
        relative_photo_url = f"/uploads/{filename}"

        # حفظ في قاعدة البيانات مع مصفوفة الزوايا
        try:
            user_id = db.add_user(
                name=name,
                email=email,
                role=role,
                has_access=has_access,
                photo_path=relative_photo_url,
                embedding=stacked_embeddings,
                notes=notes
            )
            angles_count = stacked_embeddings.shape[0]
            return {
                "success": True,
                "message": f"تم تسجيل المستخدم '{name}' بنجاح وحفظ {angles_count} زوايا بيومترية مختلفة للوجه لتعزيز دقة التعرف!",
                "user_id": user_id,
                "angles_count": angles_count,
                "photo_url": relative_photo_url,
                "warnings": errors
            }
        except Exception as e:
            if "UNIQUE constraint failed: users.email" in str(e):
                raise HTTPException(status_code=400, detail="هذا البريد الإلكتروني مسجل بالفعل لمستخدم آخر")
            raise HTTPException(status_code=500, detail=f"خطأ أثناء الحفظ في قاعدة البيانات: {e}")

    # 2) النمط الفردي الاحتياطي (Single Image)
    elif data.image:
        img = engine.decode_base64_image(data.image)
        if img is None:
            raise HTTPException(status_code=400, detail="فشل في قراءة الصورة الملتقطة")

        embedding, face_box, status_msg = engine.extract_face_embedding(img)
        if embedding is None:
            raise HTTPException(status_code=400, detail=status_msg)

        filename = f"user_{uuid.uuid4().hex[:8]}.jpg"
        photo_path = os.path.join(UPLOADS_DIR, filename)
        cv2.imwrite(photo_path, img)
        relative_photo_url = f"/uploads/{filename}"

        try:
            user_id = db.add_user(
                name=name,
                email=email,
                role=role,
                has_access=has_access,
                photo_path=relative_photo_url,
                embedding=embedding,
                notes=notes
            )
            return {
                "success": True,
                "message": f"تم تسجيل المستخدم '{name}' بنجاح وحفظ بصمة الوجه!",
                "user_id": user_id,
                "angles_count": 1,
                "face_box": face_box,
                "photo_url": relative_photo_url
            }
        except Exception as e:
            if "UNIQUE constraint failed: users.email" in str(e):
                raise HTTPException(status_code=400, detail="هذا البريد الإلكتروني مسجل بالفعل لمستخدم آخر")
            raise HTTPException(status_code=500, detail=f"خطأ أثناء الحفظ في قاعدة البيانات: {e}")
    else:
        raise HTTPException(status_code=400, detail="يرجى التقاط صورة واحدة على الأقل لتسجيل بصمة الوجه")

@app.post("/api/verify")
async def verify_face(data: FaceVerifyRequest):
    """
    التحقق من الوجه أمام الكاميرا:
    1. استخراج بصمة الوجه الحالية
    2. مطابقتها مع كل الوجوه المسجلة
    3. التأكد هل الشخص مسجل في النظام
    4. التأكد هل الشخص معاه صلاحية دخول (has_access == True) ولا لاء
    5. فتح البوابة وتوليد توكن الدخول في حال قبول الوصول
    """
    img = engine.decode_base64_image(data.image)
    if img is None:
        return JSONResponse(status_code=400, content={"status": "ERROR", "message": "فشل في قراءة صورة الكاميرا"})

    embedding, face_box, status_msg = engine.extract_face_embedding(img)
    if embedding is None:
        return JSONResponse(status_code=200, content={
            "status": "NO_FACE",
            "message": status_msg
        })

    # جلب جميع بصمات المستخدمين
    registered_users = db.get_all_user_embeddings()
    if not registered_users:
        db.log_access_attempt(status="NO_REGISTERED_USERS", confidence=0.0)
        return JSONResponse(status_code=200, content={
            "status": "NO_USERS",
            "message": "لا يوجد أي مستخدمين مسجلين في النظام بعد. يرجى تسجيل وجه جديد أولاً."
        })

    # مطابقة الوجه
    matched_user, best_score, conf_pct = engine.identify_face(embedding, registered_users)

    # حفظ لقطة مؤقتة للمحاولة (اختياري للسجل)
    snap_filename = f"scan_{uuid.uuid4().hex[:6]}.jpg"
    snap_path = os.path.join(UPLOADS_DIR, snap_filename)
    cv2.imwrite(snap_path, img)
    snap_url = f"/uploads/{snap_filename}"

    # الحالة 1: الوجه غير مسجل في النظام
    if matched_user is None:
        db.log_access_attempt(
            status="UNKNOWN_FACE",
            user_name="وجه غير معروف",
            confidence=conf_pct,
            snapshot_path=snap_url
        )
        return JSONResponse(status_code=200, content={
            "status": "UNKNOWN",
            "message": "❌ الوجه غير مسجل في النظام!",
            "confidence": conf_pct,
            "face_box": face_box,
            "details": "لم يتم العثور على أي تطابق مع المستخدمين المصرح لهم."
        })

    # الحالة 2: الوجه مسجل، نتحقق من صلاحية الوصول (has_access)
    user_id = matched_user["id"]
    user_name = matched_user["name"]
    has_access = matched_user["has_access"]
    user_role = matched_user["role"]

    if not has_access:
        # المستخدم مسجل ولكن الصلاحية ملغية أو معطلة!
        db.log_access_attempt(
            status="DENIED_NO_ACCESS",
            user_id=user_id,
            user_name=user_name,
            confidence=conf_pct,
            snapshot_path=snap_url
        )
        return JSONResponse(status_code=200, content={
            "status": "DENIED",
            "message": f"⛔ تم التعرف على: {user_name} - ولكن تم رفض الدخول!",
            "user": {
                "id": user_id,
                "name": user_name,
                "role": user_role,
                "has_access": False,
                "photo_url": matched_user["photo_path"]
            },
            "confidence": conf_pct,
            "face_box": face_box,
            "reason": "تم إلغاء صلاحية الوصول لهذا الحساب من قبل الإدارة (Access Denied / Revoked)."
        })

    # الحالة 3: المستخدم مسجل ومعاه صلاحية دخول كاملة (GRANTED)
    session_token = secrets.token_urlsafe(32)
    
    # حفظ الجلسة في قاعدة البيانات (دائمة ومحمية من إعادة تشغيل الخادم)
    db.create_session(session_token, user_id)
    
    # حفظ في الذاكرة أيضاً
    ACTIVE_SESSIONS[session_token] = {
        "id": user_id,
        "name": user_name,
        "email": matched_user["email"],
        "role": user_role,
        "has_access": True,
        "photo_url": matched_user["photo_path"],
        "login_time": datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
    }

    db.log_access_attempt(
        status="GRANTED",
        user_id=user_id,
        user_name=user_name,
        confidence=conf_pct,
        snapshot_path=snap_url
    )

    is_admin = bool("admin" in user_role.lower() or "مدير" in user_role.lower())

    response = JSONResponse(status_code=200, content={
        "status": "GRANTED",
        "message": f"مرحباً بك {user_name}! تم تسجيل الحضور وتوثيق الهوية بنجاح.",
        "user": {
            "id": user_id,
            "name": user_name,
            "role": user_role,
            "has_access": True,
            "photo_url": matched_user["photo_path"],
            "is_admin": is_admin
        },
        "is_admin": is_admin,
        "confidence": conf_pct,
        "face_box": face_box,
        "token": session_token,
        "checkin_time": datetime.now().strftime("%I:%M:%S %p"),
        "portal_url": f"/portal?token={session_token}",
        "admin_url": "/admin" if is_admin else None
    })
    # تخزين التوكن في الكوكيز ليعمل الموقع المحمي حتى لو تم فتح /portal مباشرة
    response.set_cookie(key="face_session_token", value=session_token, max_age=86400, path="/")
    if is_admin:
        response.set_cookie(key="admin_session_token", value=session_token, max_age=86400, path="/")
    return response

@app.get("/portal", response_class=HTMLResponse)
async def protected_portal(request: Request, token: Optional[str] = None):
    """
    الموقع أو البرنامج المربوط بنظام الوجه
    يفتح فقط بعد التأكد من أن الشخص مسجل ومعاه صلاحية دخول صالحة!
    يدعم التوكن من الـ Query Parameter أو من الـ Cookie.
    """
    # البحث عن التوكن في رابط الصفحة أو في ملفات تعريف الارتباط (Cookies)
    auth_token = token or request.cookies.get("face_session_token")

    user_info = None
    if auth_token:
        # البحث في الذاكرة أولاً
        if auth_token in ACTIVE_SESSIONS:
            user_info = ACTIVE_SESSIONS[auth_token]
        else:
            # البحث في قاعدة البيانات لضمان البقاء بعد إعادة تشغيل السيرفر
            db_user = db.get_session_user(auth_token)
            if db_user:
                user_info = {
                    "id": db_user["id"],
                    "name": db_user["name"],
                    "email": db_user["email"],
                    "role": db_user["role"],
                    "has_access": bool(db_user["has_access"]),
                    "photo_url": db_user["photo_path"],
                    "login_time": db_user["login_time"]
                }
                ACTIVE_SESSIONS[auth_token] = user_info

    # إذا لم يوجد توكن أو لم يتم العثور على الجلسة
    if not user_info:
        return templates.TemplateResponse(
            request=request,
            name="portal_denied.html",
            context={
                "reason": "لا يمكن الدخول إلى هذا الموقع / النظام بدون التحقق من بصمة الوجه أولاً!"
            },
            status_code=403
        )

    # التحقق هل المستخدم ما زال يمتلك صلاحية الدخول (قد تكون الإدارة ألغت الصلاحية لاحقاً)
    curr_user = db.get_user_by_id(user_info["id"])
    if not curr_user or curr_user["has_access"] != 1:
        return templates.TemplateResponse(
            request=request,
            name="portal_denied.html",
            context={
                "reason": f"تم حظر الوصول! تم إلغاء صلاحية الحساب ({user_info['name']}) من قبل إدارة النظام."
            },
            status_code=403
        )

    local_ip = get_local_ip()
    chat_messages = db.get_recent_chat_messages(60)
    files = db.get_all_shared_files()
    storage_stats = db.get_storage_stats()
    all_users = db.get_all_users()

    response = templates.TemplateResponse(
        request=request,
        name="portal.html",
        context={
            "user": user_info,
            "token": auth_token,
            "local_ip": local_ip,
            "chat_messages": chat_messages,
            "files": files,
            "storage_stats": storage_stats,
            "all_users": all_users
        }
    )
    response.set_cookie(key="face_session_token", value=auth_token, max_age=86400, path="/")
    return response

# ==================== نظام الشات المباشر المحلي (Local Network Chat) ====================

@app.websocket("/ws/chat")
async def websocket_chat_endpoint(websocket: WebSocket):
    """قناة اتصال WebSockets المباشرة للشات المحلي على الشبكة"""
    await chat_manager.connect(websocket)
    # إرسال تاريخ الشات فور الاتصال
    recent = db.get_recent_chat_messages(60)
    await websocket.send_json({"type": "history", "messages": recent, "online_count": len(chat_manager.active_connections)})
    # بث إشعار بتحديث عدد المتصلين
    await chat_manager.broadcast({"type": "online_update", "online_count": len(chat_manager.active_connections)})

    try:
        while True:
            data = await websocket.receive_json()
            token = data.get("token")
            content = (data.get("content") or "").strip()
            attachment_url = data.get("attachment_url")
            attachment_name = data.get("attachment_name")

            if not token:
                continue

            user_info = ACTIVE_SESSIONS.get(token) or db.get_session_user(token)
            if not user_info or not user_info.get("has_access"):
                await websocket.send_json({"type": "error", "message": "غير مصرح لك بالإرسال"})
                continue

            if not content and not attachment_url:
                continue

            # حفظ الرسالة في قاعدة البيانات
            msg = db.add_chat_message(
                user_id=user_info["id"],
                user_name=user_info["name"],
                user_role=user_info["role"],
                user_photo=user_info["photo_url"],
                content=content,
                attachment_url=attachment_url,
                attachment_name=attachment_name
            )

            # بث الرسالة لجميع أجهزة الشبكة المتصلة فوراً
            await chat_manager.broadcast({"type": "new_message", "message": msg})
    except WebSocketDisconnect:
        chat_manager.disconnect(websocket)
        await chat_manager.broadcast({"type": "online_update", "online_count": len(chat_manager.active_connections)})
    except Exception:
        chat_manager.disconnect(websocket)

@app.get("/api/chat/messages")
async def get_chat_history():
    """استرجاع سجل رسائل الشات المحلي"""
    return db.get_recent_chat_messages(100)

@app.post("/api/chat/send")
async def send_chat_message_http(
    request: Request,
    content: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    token: Optional[str] = Form(None)
):
    """إرسال رسالة أو ملف مرفق عبر REST API للشات المحلي"""
    auth_token = token or request.cookies.get("face_session_token")
    user_info = ACTIVE_SESSIONS.get(auth_token) or (db.get_session_user(auth_token) if auth_token else None)
    if not user_info or not user_info.get("has_access"):
        raise HTTPException(status_code=401, detail="جلسة غير مصرحة")

    attachment_url = None
    attachment_name = None

    if attachment and attachment.filename:
        attachment_name = attachment.filename
        ext = os.path.splitext(attachment.filename)[1].lower()
        stored_name = f"chat_{uuid.uuid4().hex[:8]}{ext}"
        dest_path = os.path.join(STORAGE_DIR, stored_name)
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(attachment.file, buffer)
        attachment_url = f"/storage/{stored_name}"

    if not content.strip() and not attachment_url:
        raise HTTPException(status_code=400, detail="الرسالة فارغة")

    msg = db.add_chat_message(
        user_id=user_info["id"],
        user_name=user_info["name"],
        user_role=user_info["role"],
        user_photo=user_info["photo_url"],
        content=content.strip(),
        attachment_url=attachment_url,
        attachment_name=attachment_name
    )

    # بث الرسالة لجميع أعضاء الشبكة عبر WebSocket
    await chat_manager.broadcast({"type": "new_message", "message": msg})
    return {"success": True, "message": msg}

# ==================== سحابة تخزين ومشاركة الملفات (Local File Storage) ====================

@app.post("/api/files/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    token: Optional[str] = Form(None)
):
    """رفع ملف جديد إلى سحابة التخزين المحلية للشبكة"""
    auth_token = token or request.cookies.get("face_session_token")
    user_info = ACTIVE_SESSIONS.get(auth_token) or (db.get_session_user(auth_token) if auth_token else None)
    if not user_info or not user_info.get("has_access"):
        raise HTTPException(status_code=401, detail="جلسة غير مصرحة")

    orig_name = os.path.basename(file.filename)
    ext = os.path.splitext(orig_name)[1].lower()
    stored_name = f"vault_{uuid.uuid4().hex[:10]}{ext}"
    dest_path = os.path.join(STORAGE_DIR, stored_name)

    # حفظ الملف على القرص المحلي
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    file_size = os.path.getsize(dest_path)
    file_type = ext.replace(".", "").upper() or "FILE"

    saved_file = db.add_shared_file(
        filename=orig_name,
        stored_filename=stored_name,
        file_size=file_size,
        file_type=file_type,
        user_id=user_info["id"],
        user_name=user_info["name"],
        user_photo=user_info["photo_url"]
    )

    # إشعار تلقائي لطيف في الشات المحلي
    notice_msg = db.add_chat_message(
        user_id=user_info["id"],
        user_name=user_info["name"],
        user_role=user_info["role"],
        user_photo=user_info["photo_url"],
        content=f"📁 تم رفع ملف جديد إلى سحابة التخزين: {orig_name}",
        attachment_url=f"/api/files/{saved_file['id']}/download",
        attachment_name=orig_name
    )
    await chat_manager.broadcast({"type": "new_message", "message": notice_msg})

    return {
        "success": True,
        "file": saved_file,
        "stats": db.get_storage_stats()
    }

@app.get("/api/files")
async def list_files():
    """استعراض جميع الملفات المخزنة محلياً"""
    return {
        "files": db.get_all_shared_files(),
        "stats": db.get_storage_stats()
    }

@app.get("/api/files/{file_id}/download")
async def download_file(file_id: int):
    """تحميل الملف مع الحفاظ على اسمه الأصلي وزيادة عداد التحميل"""
    f = db.get_file_by_id(file_id)
    if not f:
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    
    file_path = os.path.join(STORAGE_DIR, f["stored_filename"])
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="الملف غير موجود على القرص")

    db.increment_file_download(file_id)
    return FileResponse(
        path=file_path,
        filename=f["filename"],
        media_type="application/octet-stream"
    )

@app.delete("/api/files/{file_id}")
async def delete_file(file_id: int, request: Request, token: Optional[str] = None):
    """حذف ملف من التخزين المحلي (لصاحب الملف أو المدير)"""
    auth_token = token or request.cookies.get("face_session_token")
    user_info = ACTIVE_SESSIONS.get(auth_token) or (db.get_session_user(auth_token) if auth_token else None)
    if not user_info:
        raise HTTPException(status_code=401, detail="جلسة غير مصرحة")

    f = db.get_file_by_id(file_id)
    if not f:
        raise HTTPException(status_code=404, detail="الملف غير موجود")

    is_admin = "admin" in user_info.get("role", "").lower() or "مدير" in user_info.get("role", "").lower()
    if f["uploaded_by_id"] != user_info["id"] and not is_admin:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية لحذف هذا الملف")

    stored_name = db.delete_shared_file(file_id)
    if stored_name:
        p = os.path.join(STORAGE_DIR, stored_name)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass

    return {"success": True, "stats": db.get_storage_stats()}

@app.get("/api/network-info")
async def network_info():
    """معلومات الشبكة المحلية والـ IP لمشاركتها مع الزملاء"""
    ip = get_local_ip()
    return {
        "ip": ip,
        "port": 8000,
        "access_url": f"http://{ip}:8000",
        "portal_url": f"http://{ip}:8000/portal"
    }

@app.get("/api/users")
async def list_users():
    """عرض قائمة المستخدمين"""
    return db.get_all_users()

@app.post("/api/users/{user_id}/toggle-access")
async def toggle_access(user_id: int, request: Request):
    """تبديل حالة الصلاحية (منح أو سحب الإذن بالدخول) - للإدارة فقط"""
    if not is_admin_authenticated(request):
        raise HTTPException(status_code=403, detail="تعديل الصلاحيات مخصص لمدير النظام فقط")
    new_status = db.toggle_user_access(user_id)
    if new_status is None:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return {"success": True, "has_access": new_status}

@app.delete("/api/users/{user_id}")
async def remove_user(user_id: int, request: Request):
    """حذف مستخدم من النظام - للإدارة فقط"""
    if not is_admin_authenticated(request):
        raise HTTPException(status_code=403, detail="حذف الموظفين مخصص لمدير النظام فقط")
    success = db.delete_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return {"success": True}

@app.get("/api/logs")
async def list_logs():
    """عرض سجلات محاولات الدخول"""
    return db.get_recent_logs(50)

@app.get("/api/attendance")
async def get_attendance(date: Optional[str] = None):
    """جلب سجل الحضور والانصراف وساعات العمل لليوم"""
    return db.get_daily_attendance(date)

@app.get("/api/attendance/export")
async def export_attendance(date: Optional[str] = None):
    """تصدير تقرير الحضور والانصراف كملف CSV متوافق مع Excel والأحرف العربية"""
    csv_data = db.export_attendance_csv(date)
    curr_date = date or datetime.now().strftime("%Y-%m-%d")
    filename = f"attendance_{curr_date}.csv"
    return Response(
        content=csv_data.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/logs/export")
async def export_logs():
    """تصدير سجل الحركات والمحاولات بالكامل كملف CSV"""
    csv_data = db.export_logs_csv()
    filename = f"access_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_data.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.post("/api/portal/presence-check")
async def check_user_presence(data: PresenceCheckRequest):
    """
    فحص تواجد المستخدم المستمر أمام شاشة الكمبيوتر:
    إذا ابتعد المستخدم عن الشاشة أو جلس شخص آخر أمامه، يتم تنبيه النظام أو قفله تلقائياً للحفاظ على الخصوصية.
    """
    user_info = ACTIVE_SESSIONS.get(data.token) or db.get_session_user(data.token)
    if not user_info:
        return JSONResponse(status_code=401, content={"status": "UNAUTHORIZED", "message": "انتهت الجلسة"})

    img = engine.decode_base64_image(data.image)
    if img is None:
        return JSONResponse(status_code=400, content={"status": "ERROR", "message": "تعذر قراءة صورة الكاميرا"})

    embedding, face_box, msg = engine.extract_face_embedding(img)
    if embedding is None:
        return JSONResponse(status_code=200, content={
            "status": "ABSENT",
            "message": "لم يتم رصد وجه أمام الشاشة",
            "should_lock": True
        })

    # مقارنة الوجه بالمسجلين
    registered_users = db.get_all_user_embeddings()
    matched_user, best_score, conf_pct = engine.identify_face(embedding, registered_users)

    if matched_user and matched_user["id"] == user_info["id"]:
        return JSONResponse(status_code=200, content={
            "status": "PRESENT",
            "user_name": user_info["name"],
            "confidence": conf_pct,
            "face_box": face_box,
            "should_lock": False
        })
    else:
        return JSONResponse(status_code=200, content={
            "status": "DIFFERENT_PERSON",
            "message": "⚠️ تم رصد شخص غير مصرح له أمام الشاشة!",
            "face_box": face_box,
            "should_lock": True
        })

@app.post("/api/logout")
async def logout(token: Optional[str] = Form(None)):
    """تسجيل الخروج وإنهاء جلسة الدخول ومسح الكوكيز"""
    if token:
        if token in ACTIVE_SESSIONS:
            del ACTIVE_SESSIONS[token]
        db.delete_session(token)
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie(key="face_session_token", path="/")
    return response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
