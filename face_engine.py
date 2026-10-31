import os
import cv2
import numpy as np
import base64
from typing import Optional, Tuple, List, Dict, Any

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(CURRENT_DIR, "models")
YUNET_PATH = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

class FaceEngine:
    def __init__(self):
        self.detector = None
        self.recognizer = None
        self.cosine_threshold = 0.363  # عتبة التطابق القياسية لنموذج SFace
        self.load_models()

    def load_models(self):
        if not os.path.exists(YUNET_PATH) or not os.path.exists(SFACE_PATH):
            print(f"[FaceEngine] Models not found: {YUNET_PATH} or {SFACE_PATH}")
            return False

        try:
            # تهيئة كاشف الوجوه YuNet
            self.detector = cv2.FaceDetectorYN.create(
                model=YUNET_PATH,
                config="",
                input_size=(320, 320),
                score_threshold=0.6,
                nms_threshold=0.3,
                top_k=5000,
                backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
                target_id=cv2.dnn.DNN_TARGET_CPU
            )
            
            # تهيئة نموذج التعرف على الوجوه SFace
            self.recognizer = cv2.FaceRecognizerSF.create(
                model=SFACE_PATH,
                config="",
                backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
                target_id=cv2.dnn.DNN_TARGET_CPU
            )
            print("[FaceEngine] Models loaded successfully!")
            return True
        except Exception as e:
            print(f"[FaceEngine] Error loading models: {e}")
            return False

    def decode_base64_image(self, base64_str: str) -> Optional[np.ndarray]:
        """فك تشفير صورة base64 إلى مصفوفة OpenCV (BGR)"""
        try:
            if "," in base64_str:
                base64_str = base64_str.split(",")[1]
            image_bytes = base64.b64decode(base64_str)
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            return img
        except Exception as e:
            print(f"[FaceEngine] Error decoding base64 image: {e}")
            return None

    def detect_faces(self, image: np.ndarray) -> Optional[np.ndarray]:
        """اكتشاف الوجوه في الصورة وتحديد إحداثياتها"""
        if self.detector is None:
            if not self.load_models():
                return None

        h, w = image.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(image)
        return faces

    def extract_face_embedding(self, image: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[dict], str]:
        """
        استخراج متجه الخصائص (Face Embedding) للوجه الأوضح في الصورة.
        يرجع: (embedding, face_box_dict, status_message)
        """
        faces = self.detect_faces(image)
        if faces is None or len(faces) == 0:
            return None, None, "لم يتم العثور على أي وجه في الصورة. يرجى التوجه أمام الكاميرا مباشرة وبإضاءة جيدة."

        # اختيار الوجه الأكبر مساحة في حال وجود أكثر من شخص
        best_face = None
        max_area = 0
        for f in faces:
            area = f[2] * f[3]
            if area > max_area:
                max_area = area
                best_face = f

        face_box = {
            "x": int(best_face[0]),
            "y": int(best_face[1]),
            "width": int(best_face[2]),
            "height": int(best_face[3]),
            "score": float(best_face[-1])
        }

        # محاذاة وقص الوجه ثم استخراج الـ Embedding
        try:
            aligned_face = self.recognizer.alignCrop(image, best_face)
            feature = self.recognizer.feature(aligned_face)
            # feature هو متجه 128-dimensional float32
            return feature.flatten(), face_box, "SUCCESS"
        except Exception as e:
            return None, None, f"خطأ أثناء استخراج بصمة الوجه: {e}"

    def calculate_similarity(self, feat1: np.ndarray, feat2: np.ndarray) -> float:
        """حساب معامل التشابه الكوزيني (Cosine Similarity) بين وجهين"""
        f1 = feat1.reshape(1, -1)
        f2 = feat2.reshape(1, -1)
        # استخدام دالة OpenCV SFace المدمجة للمطابقة الكوزينية
        if self.recognizer:
            score = self.recognizer.match(f1, f2, cv2.FaceRecognizerSF_FR_COSINE)
            return float(score)
        
        # كود بديل لحساب الكوزين يدوياً
        norm1 = np.linalg.norm(f1)
        norm2 = np.linalg.norm(f2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(np.dot(f1, f2.T)[0][0] / (norm1 * norm2))

    def score_to_confidence_percentage(self, score: float) -> float:
        """تحويل نتيجة المطابقة إلى نسبة مئوية سهلة القراءة للمستخدم"""
        # في SFace، عتبة المطابقة هي 0.363. الدرجات النموذجية للتطابق من 0.363 إلى 0.85+
        if score < 0.20:
            return max(0.0, score * 100.0)
        # تحويل تدريجي لعرض نسبة مئوية معبرة
        pct = (score - 0.20) / (0.80 - 0.20) * 100.0
        return float(np.clip(pct, 0.0, 99.9))

    def identify_face(self, target_feature: np.ndarray, registered_users: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], float, float]:
        """
        مقارنة بصمة الوجه مع جميع المستخدمين المسجلين في قاعدة البيانات.
        يدعم المستخدمين المسجلين بزاوية واحدة أو زوايا متعددة (Multi-Angle Biometric Ensembles).
        يرجع: (best_user_match, best_score, confidence_percentage)
        """
        best_match = None
        best_score = -1.0

        for user in registered_users:
            stored_emb = user.get("embedding")
            if stored_emb is None:
                continue

            # دعم كل من (128,) و (N, 128)
            if stored_emb.ndim == 1:
                stored_emb = stored_emb.reshape(1, -1)

            # مقارنة الوجه الحالي مع جميع زوايا المستخدم وحساب أعلى درجة تطابق
            user_scores = []
            for angle_emb in stored_emb:
                s = self.calculate_similarity(target_feature, angle_emb)
                user_scores.append(s)

            user_best_score = max(user_scores) if user_scores else -1.0

            if user_best_score > best_score:
                best_score = user_best_score
                best_match = user

        conf_pct = self.score_to_confidence_percentage(best_score) if best_score > 0 else 0.0

        # التحقق هل تخطى عتبة التعرف (0.363)
        if best_score >= self.cosine_threshold:
            return best_match, best_score, conf_pct
        else:
            return None, best_score, conf_pct

    def process_multi_angle_images(self, images_dict: Dict[str, str]) -> Tuple[Optional[np.ndarray], Dict[str, Any], List[str]]:
        """
        معالجة صور متعددة للزوايا المختلفة (Center, Left, Right, Up, Down).
        ترجع: (stacked_embeddings, angle_boxes, errors)
        """
        embeddings = []
        angle_boxes = {}
        errors = []

        angle_names = {
            "center": "الأمام",
            "right": "اليمين",
            "left": "اليسار",
            "up": "الأعلى",
            "down": "الأسفل"
        }

        for angle_key, b64_str in images_dict.items():
            if not b64_str:
                continue
            img = self.decode_base64_image(b64_str)
            if img is None:
                errors.append(f"تعذر قراءة صورة زاوية ({angle_names.get(angle_key, angle_key)})")
                continue

            emb, box, msg = self.extract_face_embedding(img)
            if emb is not None:
                embeddings.append(emb)
                angle_boxes[angle_key] = box
            else:
                errors.append(f"لم يتم كشف الوجه في زاوية ({angle_names.get(angle_key, angle_key)}): {msg}")

        if not embeddings:
            return None, angle_boxes, errors

        stacked = np.array(embeddings, dtype=np.float32)
        return stacked, angle_boxes, errors

# Create singleton instance
engine = FaceEngine()
