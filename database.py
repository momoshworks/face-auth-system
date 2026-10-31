import sqlite3
import numpy as np
import os
import threading
from datetime import datetime
from typing import List, Optional, Dict, Any

DB_PATH = os.path.join(os.path.dirname(__file__), "face_auth.db")
DB_LOCK = threading.RLock()

def get_connection():
    """
    إنشاء اتصال SQLite مهيأ بنمط WAL والانتظار حتى 30 ثانية
    لمنع خطأ database is locked تماماً أثناء التزامن.
    """
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn

def init_db():
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            
            # جدول المستخدمين والملفات الشخصية
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                role TEXT NOT NULL DEFAULT 'User',
                has_access INTEGER NOT NULL DEFAULT 1,
                photo_path TEXT,
                embedding BLOB NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL
            );
            """)
            
            # جدول سجلات الدخول ومحاولات التحقق
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                user_name TEXT,
                status TEXT NOT NULL,
                confidence REAL,
                snapshot_path TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            """)

            # جدول الجلسات المعتمدة بعد التحقق بالوجه (لضمان بقاء الجلسة حتى لو أُعيد تشغيل السيرفر)
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """)

            # جدول رسائل الشات المحلي لأعضاء الشبكة
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                user_role TEXT,
                user_photo TEXT,
                content TEXT NOT NULL,
                attachment_url TEXT,
                attachment_name TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """)

            # جدول الملفات المشتركة على السحابة المحلية
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS shared_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_type TEXT,
                uploaded_by_id INTEGER,
                uploaded_by_name TEXT,
                uploaded_by_photo TEXT,
                download_count INTEGER DEFAULT 0,
                uploaded_at TEXT NOT NULL,
                FOREIGN KEY(uploaded_by_id) REFERENCES users(id) ON DELETE SET NULL
            );
            """)
            
            conn.commit()
        finally:
            conn.close()

def add_user(name: str, email: str, role: str, has_access: bool, photo_path: str, embedding: np.ndarray, notes: str = "") -> int:
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            embedding_bytes = embedding.astype(np.float32).tobytes()
            created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            cursor.execute("""
            INSERT INTO users (name, email, role, has_access, photo_path, embedding, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (name, email, role, 1 if has_access else 0, photo_path, embedding_bytes, notes, created_at))
            
            user_id = cursor.lastrowid
            conn.commit()
            return user_id
        finally:
            conn.close()

def get_all_users() -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, email, role, has_access, photo_path, embedding, notes, created_at FROM users ORDER BY id DESC")
        rows = cursor.fetchall()
        users = []
        for row in rows:
            u = dict(row)
            if row["embedding"]:
                angles_count = len(row["embedding"]) // (128 * 4)
            else:
                angles_count = 1
            u["angles_count"] = max(1, angles_count)
            del u["embedding"]
            users.append(u)
        return users
    finally:
        conn.close()

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, email, role, has_access, photo_path, notes, created_at FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def get_all_user_embeddings() -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, email, role, has_access, photo_path, embedding FROM users")
        rows = cursor.fetchall()
        results = []
        for row in rows:
            emb = np.frombuffer(row["embedding"], dtype=np.float32).reshape(-1, 128)
            results.append({
                "id": row["id"],
                "name": row["name"],
                "email": row["email"],
                "role": row["role"],
                "has_access": bool(row["has_access"]),
                "photo_path": row["photo_path"],
                "embedding": emb,
                "angles_count": emb.shape[0]
            })
        return results
    finally:
        conn.close()

def toggle_user_access(user_id: int) -> Optional[bool]:
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT has_access FROM users WHERE id = ?", (user_id,))
            row = cursor.fetchone()
            if not row:
                return None
            new_status = 0 if row["has_access"] == 1 else 1
            cursor.execute("UPDATE users SET has_access = ? WHERE id = ?", (new_status, user_id))
            conn.commit()
            return bool(new_status)
        finally:
            conn.close()

def delete_user(user_id: int) -> bool:
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
            deleted = cursor.rowcount > 0
            conn.commit()
            return deleted
        finally:
            conn.close()

def log_access_attempt(status: str, user_id: Optional[int] = None, user_name: Optional[str] = None, confidence: float = 0.0, snapshot_path: Optional[str] = None):
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("""
            INSERT INTO access_logs (user_id, user_name, status, confidence, snapshot_path, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (user_id, user_name, status, round(confidence, 2), snapshot_path, timestamp))
            conn.commit()
        finally:
            conn.close()

def get_recent_logs(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM access_logs ORDER BY id DESC LIMIT ?", (limit,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()

def create_session(token: str, user_id: int):
    """حفظ جلسة الدخول في قاعدة البيانات لضمان بقائها حتى لو أعيد تشغيل الخادم"""
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("INSERT OR REPLACE INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user_id, created_at))
            conn.commit()
        finally:
            conn.close()

def get_session_user(token: str) -> Optional[Dict[str, Any]]:
    """التحقق من التوكن وجلب بيانات المستخدم المرتبط بالجلسة"""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT u.id, u.name, u.email, u.role, u.has_access, u.photo_path, s.created_at as login_time, s.token
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ?
        """, (token,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def delete_session(token: str):
    """إنهاء الجلسة وحذفها"""
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
        finally:
            conn.close()

# ----------------- دوال الشات المحلي (Local Chat) -----------------

def add_chat_message(user_id: int, user_name: str, user_role: str, user_photo: str, content: str, attachment_url: Optional[str] = None, attachment_name: Optional[str] = None) -> Dict[str, Any]:
    """إضافة رسالة جديدة للشات المحلي وتوثيق هاتف/صورة المرسل"""
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            timestamp = datetime.now().strftime("%I:%M %p • %Y-%m-%d")
            cursor.execute("""
            INSERT INTO chat_messages (user_id, user_name, user_role, user_photo, content, attachment_url, attachment_name, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (user_id, user_name, user_role, user_photo, content, attachment_url, attachment_name, timestamp))
            msg_id = cursor.lastrowid
            conn.commit()
            return {
                "id": msg_id,
                "user_id": user_id,
                "user_name": user_name,
                "user_role": user_role,
                "user_photo": user_photo,
                "content": content,
                "attachment_url": attachment_url,
                "attachment_name": attachment_name,
                "timestamp": timestamp
            }
        finally:
            conn.close()

def get_recent_chat_messages(limit: int = 100) -> List[Dict[str, Any]]:
    """جلب آخر رسائل الشات المحلي مرتبة زمنياً"""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM chat_messages ORDER BY id ASC LIMIT ?", (limit,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()

# ----------------- دوال سحابة الملفات المشتركة (Local File Storage) -----------------

def add_shared_file(filename: str, stored_filename: str, file_size: int, file_type: str, user_id: int, user_name: str, user_photo: str) -> Dict[str, Any]:
    """حفظ بيانات الملف المرفوع في قاعدة البيانات"""
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            uploaded_at = datetime.now().strftime("%Y-%m-%d %I:%M %p")
            cursor.execute("""
            INSERT INTO shared_files (filename, stored_filename, file_size, file_type, uploaded_by_id, uploaded_by_name, uploaded_by_photo, download_count, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
            """, (filename, stored_filename, file_size, file_type, user_id, user_name, user_photo, uploaded_at))
            file_id = cursor.lastrowid
            conn.commit()
            return {
                "id": file_id,
                "filename": filename,
                "stored_filename": stored_filename,
                "file_size": file_size,
                "file_type": file_type,
                "uploaded_by_id": user_id,
                "uploaded_by_name": user_name,
                "uploaded_by_photo": user_photo,
                "download_count": 0,
                "uploaded_at": uploaded_at
            }
        finally:
            conn.close()

def get_all_shared_files() -> List[Dict[str, Any]]:
    """استعراض جميع الملفات المخزنة محلياً"""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM shared_files ORDER BY id DESC")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()

def get_file_by_id(file_id: int) -> Optional[Dict[str, Any]]:
    """جلب تفاصيل ملف محدد"""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM shared_files WHERE id = ?", (file_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def increment_file_download(file_id: int):
    """زيادة عداد تحميلات الملف"""
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("UPDATE shared_files SET download_count = download_count + 1 WHERE id = ?", (file_id,))
            conn.commit()
        finally:
            conn.close()

def delete_shared_file(file_id: int) -> Optional[str]:
    """حذف ملف من قاعدة البيانات وإرجاع اسمه الفيزيائي لحذفه من القرص"""
    with DB_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT stored_filename FROM shared_files WHERE id = ?", (file_id,))
            row = cursor.fetchone()
            if not row:
                return None
            stored_name = row["stored_filename"]
            cursor.execute("DELETE FROM shared_files WHERE id = ?", (file_id,))
            conn.commit()
            return stored_name
        finally:
            conn.close()

def get_storage_stats() -> Dict[str, Any]:
    """إحصائيات مساحة التخزين المحلية"""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as total_files, COALESCE(SUM(file_size), 0) as total_bytes, COALESCE(SUM(download_count), 0) as total_downloads FROM shared_files")
        row = cursor.fetchone()
        total_files = row["total_files"]
        total_bytes = row["total_bytes"]
        total_downloads = row["total_downloads"]

        # تحويل الحجم إلى صيغة مقروءة (KB / MB / GB)
        if total_bytes < 1024 * 1024:
            size_formatted = f"{total_bytes / 1024:.1f} KB"
        elif total_bytes < 1024 * 1024 * 1024:
            size_formatted = f"{total_bytes / (1024 * 1024):.1f} MB"
        else:
            size_formatted = f"{total_bytes / (1024 * 1024 * 1024):.2f} GB"

        return {
            "total_files": total_files,
            "total_bytes": total_bytes,
            "size_formatted": size_formatted,
            "total_downloads": total_downloads
        }
    finally:
        conn.close()

# تهيئة قاعدة البيانات
init_db()
