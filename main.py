import os
import uuid
import cv2
import secrets
import socket
import shutil
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Request, Form, HTTPException, Depends, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse
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
    """الحصول على عنوان IP المحلي للجهاز على شبكة الواي فاي / الشبكة المحلية"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def get_tunnel_url() -> Optional[str]:
    """الحصول على رابط Cloudflare HTTPS التلقائي الآمن للموبايل"""
    tunnel_log = os.path.join(BASE_DIR, "tunnel.log")
    if os.path.exists(tunnel_log):
        try:
            with open(tunnel_log, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            matches = re.findall(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", content)
            if matches:
                return matches[-1]
        except Exception:
            pass

    tunnel_file = os.path.join(BASE_DIR, "tunnel_url.txt")
    if os.path.exists(tunnel_file):
        try:
            with open(tunnel_file, "r", encoding="utf-8", errors="ignore") as f:
                url = f.read().strip()
            if url.startswith("https://") and "trycloudflare.com" in url:
                return url
        except Exception:
            pass
    return None

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

class FaceVerifyRequest(BaseModel):
    image: str  # Base64 data URL

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
    tunnel_url = get_tunnel_url()
    mobile_https = f"https://{local_ip}:8443"
    return {
        "local_ip": local_ip,
        "local_url": f"http://{local_ip}:8000",
        "tunnel_url": tunnel_url,
        "mobile_https_url": mobile_https,
        "mobile_url": tunnel_url or mobile_https
    }

@app.get("/", response_class=HTMLResponse)
async def home_page(request: Request):
    """الصفحة الرئيسية لنظام التعرف على الوجه"""
    users = db.get_all_users()
    logs = db.get_recent_logs(20)
    local_ip = get_local_ip()
    tunnel_url = get_tunnel_url()
    mobile_https = f"https://{local_ip}:8443"
    mobile_url = tunnel_url or mobile_https
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "users": users,
            "logs": logs,
            "total_users": len(users),
            "active_access_count": sum(1 for u in users if u["has_access"] == 1),
            "local_ip": local_ip,
            "tunnel_url": tunnel_url,
            "mobile_https_url": mobile_https,
            "mobile_url": mobile_url
        }
    )

@app.post("/api/register")
async def register_user(data: RegisterRequest):
    """
    تسجيل شخص جديد واستخراج بصمة الوجه وحفظ الملف الشخصي.
    يدعم التقاط زوايا متعددة (Center, Right, Left, Up, Down) لرفع دقة التعرف.
    """
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

    response = JSONResponse(status_code=200, content={
        "status": "GRANTED",
        "message": f"✅ مرحباً بك {user_name}! تم التحقق من الهوية ومنح الإذن بالدخول.",
        "user": {
            "id": user_id,
            "name": user_name,
            "role": user_role,
            "has_access": True,
            "photo_url": matched_user["photo_path"]
        },
        "confidence": conf_pct,
        "face_box": face_box,
        "token": session_token,
        "redirect_url": f"/portal?token={session_token}"
    })
    # تخزين التوكن في الكوكيز ليعمل الموقع المحمي حتى لو تم فتح /portal مباشرة
    response.set_cookie(key="face_session_token", value=session_token, max_age=86400, path="/")
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
async def toggle_access(user_id: int):
    """تبديل حالة الصلاحية (منح أو سحب الإذن بالدخول)"""
    new_status = db.toggle_user_access(user_id)
    if new_status is None:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return {"success": True, "has_access": new_status}

@app.delete("/api/users/{user_id}")
async def remove_user(user_id: int):
    """حذف مستخدم من النظام"""
    success = db.delete_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return {"success": True}

@app.get("/api/logs")
async def list_logs():
    """عرض سجلات محاولات الدخول"""
    return db.get_recent_logs(50)

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
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
