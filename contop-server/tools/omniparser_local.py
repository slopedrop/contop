"""
In-process OmniParser V2 — auto-downloads models from HuggingFace and runs
UI element detection locally (no separate server needed).

Models used:
- YOLOv8 (finetuned) for icon/UI element detection (~40 MB)
- Florence-2-base (finetuned) for icon captioning (~1.08 GB)
- EasyOCR for text detection (~100 MB, auto-downloaded by easyocr)

Total first-run download: ~1.2 GB.  Models are cached in ~/.cache/huggingface.
Supports both GPU (float16, ~2 GB VRAM) and CPU (float32, slower).
"""
import asyncio
import base64
import io
import logging
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from tools.omniparser_client import ParsedElement, ParseResult

logger = logging.getLogger(__name__)

# HuggingFace model ID for OmniParser V2 weights
HF_MODEL_ID = "microsoft/OmniParser-v2.0"
# Default cache dir — follows HuggingFace convention
_WEIGHTS_DIR: Path | None = None

# Detection thresholds
BOX_THRESHOLD = 0.20  # Raised from 0.05 — eliminates low-confidence noise while keeping real UI elements
IOU_THRESHOLD = 0.7
OCR_CONFIDENCE = 0.8
YOLO_IMGSZ = 640  # Overridden to 416 on CPU at runtime (see _run_yolo)
CAPTION_BATCH_SIZE = 4  # Keep small — CPU can't handle large batches (128 needs ~2.4 GB)
ICON_CROP_SIZE = 64

# Color palette for bounding box annotations
_COLORS = [
    "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
    "#FF8000", "#8000FF", "#0080FF", "#FF0080", "#80FF00", "#00FF80",
    "#FF4040", "#40FF40", "#4040FF", "#FFAA00", "#AA00FF", "#00AAFF",
]


def _get_weights_dir() -> Path:
    """Download OmniParser weights if needed and return the local path."""
    global _WEIGHTS_DIR
    if _WEIGHTS_DIR is not None:
        return _WEIGHTS_DIR

    from huggingface_hub import snapshot_download

    cache_dir = os.environ.get(
        "OMNIPARSER_WEIGHTS_DIR",
        str(Path.home() / ".cache" / "omniparser"),
    )
    logger.info("Downloading OmniParser V2 weights to %s (first run only)...", cache_dir)
    local_dir = snapshot_download(
        HF_MODEL_ID,
        local_dir=cache_dir,
        # Only download the model files we need
        allow_patterns=[
            "icon_detect/*",
            "icon_caption/*",
        ],
    )
    _WEIGHTS_DIR = Path(local_dir)
    logger.info("OmniParser weights ready at %s", _WEIGHTS_DIR)
    return _WEIGHTS_DIR


class OmniParserLocal:
    """In-process OmniParser V2 with lazy model loading and auto-download."""

    _instance: "OmniParserLocal | None" = None

    def __init__(self) -> None:
        self._loaded = False
        self._loading = False  # True while models are being loaded
        self._yolo = None
        self._caption_model = None
        self._caption_processor = None
        self._ocr_reader = None
        self._device = None
        self._dtype = None
        self._load_status: str = ""  # Human-readable loading status

    @property
    def is_loading(self) -> bool:
        """True while models are being loaded (first use or preload)."""
        return self._loading

    @property
    def is_loaded(self) -> bool:
        """True once all models are ready."""
        return self._loaded

    @property
    def load_status(self) -> str:
        """Human-readable status of what's currently loading."""
        return self._load_status

    def _ensure_loaded(self) -> None:
        """Lazy-load all models on first use."""
        if self._loaded:
            return

        self._loading = True
        try:
            self._load_models()
        finally:
            self._loading = False

    def _load_models(self) -> None:
        """Load all models sequentially, updating load_status for UI feedback."""
        import torch
        from ultralytics import YOLO

        self._load_status = "Downloading OmniParser models..."
        weights = _get_weights_dir()

        self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._dtype = torch.float16 if self._device.type != "cpu" else torch.float32
        logger.info("OmniParser using device=%s, dtype=%s", self._device, self._dtype)

        if self._device.type == "cpu":
            logger.warning(
                "CUDA not available. OmniParser running on CPU (slower). "
                "Run the ML setup to enable GPU acceleration."
            )

        # YOLO icon detector
        self._load_status = "Loading UI element detector (YOLO)..."
        yolo_path = weights / "icon_detect" / "model.pt"
        self._yolo = YOLO(str(yolo_path))
        logger.info("YOLO model loaded from %s", yolo_path)

        # Florence-2 icon captioner — only loaded on GPU.
        # On CPU, captioning is skipped (too slow at ~30s per screenshot) and the
        # agent identifies elements visually from the annotated screenshot instead.
        if self._device.type != "cpu":
            from transformers import AutoModelForCausalLM, AutoProcessor
            self._load_status = "Loading icon captioner (Florence-2, ~1 GB)..."
            caption_path = weights / "icon_caption"
            self._caption_processor = AutoProcessor.from_pretrained(
                "microsoft/Florence-2-base-ft", trust_remote_code=True,
            )
            self._caption_model = AutoModelForCausalLM.from_pretrained(
                str(caption_path),
                dtype=self._dtype,
                trust_remote_code=True,
                attn_implementation="eager",
            ).to(self._device)
            logger.info("Florence-2 caption model loaded from %s", caption_path)
        else:
            logger.info("Skipping Florence-2 load (CPU mode — captioning disabled for speed)")

        # EasyOCR
        self._load_status = "Loading text recognition (EasyOCR)..."
        import easyocr
        self._ocr_reader = easyocr.Reader(
            ["en"], gpu=(self._device.type == "cuda"),
        )
        logger.info("EasyOCR reader initialized")

        self._loaded = True
        self._load_status = ""

    # ── Public API ─────────────────────────────────────────────────────────

    async def parse(self, image_b64: str) -> ParseResult | None:
        """Parse a screenshot for UI elements. Thread-safe, runs in executor."""
        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(None, self._parse_sync, image_b64)
        except Exception:
            logger.exception("OmniParser local parse failed")
            return None

    # ── Internal pipeline ──────────────────────────────────────────────────

    def _parse_sync(self, image_b64: str) -> ParseResult:
        """Run the full OmniParser pipeline synchronously."""
        self._ensure_loaded()

        # Decode image
        img_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img_w, img_h = image.size
        img_np = np.array(image)

        # Step 1: OCR
        ocr_elements = self._run_ocr(img_np, img_w, img_h)

        # Step 2: YOLO detection
        icon_boxes = self._run_yolo(image, img_w, img_h)

        # Step 3: Deduplicate overlapping OCR/icon boxes
        merged = self._deduplicate(ocr_elements, icon_boxes)

        # Step 4: Caption icons that don't have OCR text
        self._caption_icons(merged, img_np, img_w, img_h)

        # Step 5: Assign IDs and build elements
        elements = []
        for idx, elem in enumerate(merged):
            elements.append(ParsedElement(
                element_id=idx,
                type=elem["type"],
                content=elem["content"] or "",
                bbox=elem["bbox"],
                interactivity=elem["interactivity"],
                source=elem["source"],
            ))

        # Step 6: Draw annotated image
        annotated = self._draw_annotations(image.copy(), elements)
        buf = io.BytesIO()
        annotated.save(buf, "PNG")
        annotated_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        logger.info("OmniParser detected %d elements (%d text, %d icon)",
                     len(elements),
                     sum(1 for e in elements if e.type == "text"),
                     sum(1 for e in elements if e.type == "icon"))

        return ParseResult(
            annotated_image_b64=annotated_b64,
            elements=elements,
        )

    def _run_ocr(self, img_np: np.ndarray, w: int, h: int) -> list[dict]:
        """Run EasyOCR and return normalized element dicts."""
        results = self._ocr_reader.readtext(img_np)
        elements = []
        for bbox_points, text, conf in results:
            if conf < OCR_CONFIDENCE:
                continue
            # EasyOCR returns [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
            xs = [p[0] for p in bbox_points]
            ys = [p[1] for p in bbox_points]
            x1, y1 = min(xs) / w, min(ys) / h
            x2, y2 = max(xs) / w, max(ys) / h
            elements.append({
                "type": "text",
                "bbox": [x1, y1, x2, y2],
                "content": text,
                "interactivity": False,
                "source": "ocr",
            })
        return elements

    def _run_yolo(self, image: Image.Image, w: int, h: int) -> list[dict]:
        """Run YOLO detection and return normalized element dicts."""
        # Use smaller input size on CPU for ~2.4x speedup with minimal accuracy loss
        imgsz = 416 if self._device.type == "cpu" else YOLO_IMGSZ
        results = self._yolo.predict(
            source=image,
            conf=BOX_THRESHOLD,
            iou=IOU_THRESHOLD,
            imgsz=imgsz,
            verbose=False,
        )
        elements = []
        if results and len(results) > 0:
            boxes = results[0].boxes
            if boxes is not None:
                for box in boxes:
                    xyxy = box.xyxy[0].cpu().numpy()
                    x1 = float(xyxy[0]) / w
                    y1 = float(xyxy[1]) / h
                    x2 = float(xyxy[2]) / w
                    y2 = float(xyxy[3]) / h
                    elements.append({
                        "type": "icon",
                        "bbox": [x1, y1, x2, y2],
                        "content": None,  # Will be captioned later
                        "interactivity": True,
                        "source": "icon_detection",
                    })
        return elements

    def _deduplicate(
        self, ocr_elements: list[dict], icon_elements: list[dict],
    ) -> list[dict]:
        """Remove overlapping OCR/icon boxes, preferring icons.

        Logic (matches OmniParser):
        - If OCR box is mostly inside an icon box: remove OCR, absorb text
        - If icon is inside an OCR box: remove icon
        - YOLO-YOLO overlap: keep smaller box
        """
        # Start with all OCR elements
        result = list(ocr_elements)
        ocr_live = list(range(len(result)))  # indices into result

        for icon in icon_elements:
            # Check icon-icon overlap (against already-added icons)
            skip_icon = False
            for i, existing in enumerate(result):
                if existing["type"] != "icon":
                    continue
                iou = self._compute_overlap(icon["bbox"], existing["bbox"])
                if iou > IOU_THRESHOLD:
                    # Keep the smaller one
                    icon_area = self._box_area(icon["bbox"])
                    exist_area = self._box_area(existing["bbox"])
                    if icon_area >= exist_area:
                        skip_icon = True
                        break
                    else:
                        result[i] = icon  # Replace with smaller
                        skip_icon = True
                        break

            if skip_icon:
                continue

            # Check against OCR elements
            absorbed_text = None
            remove_ocr_indices = []
            icon_inside_ocr = False

            for idx in ocr_live:
                ocr_elem = result[idx]
                overlap = self._compute_overlap(icon["bbox"], ocr_elem["bbox"])
                if overlap > 0.8:
                    # Check which is inside which
                    ocr_area = self._box_area(ocr_elem["bbox"])
                    icon_area = self._box_area(icon["bbox"])
                    intersection = self._intersection_area(icon["bbox"], ocr_elem["bbox"])

                    if ocr_area > 0 and intersection / ocr_area > 0.8:
                        # OCR is inside icon — absorb text
                        absorbed_text = ocr_elem["content"]
                        remove_ocr_indices.append(idx)
                    elif icon_area > 0 and intersection / icon_area > 0.8:
                        # Icon is inside OCR — discard icon
                        icon_inside_ocr = True
                        break

            if icon_inside_ocr:
                continue

            # Remove absorbed OCR elements (in reverse order to preserve indices)
            for idx in sorted(remove_ocr_indices, reverse=True):
                ocr_live.remove(idx)
                result.pop(idx)
                # Adjust remaining ocr_live indices
                ocr_live = [i if i < idx else i - 1 for i in ocr_live]

            # Add icon (with absorbed text if any)
            if absorbed_text:
                icon = dict(icon)
                icon["content"] = absorbed_text
                icon["source"] = "icon_with_ocr"
            result.append(icon)

        return result

    def _caption_icons(
        self, elements: list[dict], img_np: np.ndarray, w: int, h: int,
    ) -> None:
        """Caption icon elements that have no text content using Florence-2.

        On CPU, captioning is skipped entirely — it takes ~30s per screenshot
        and the agent can identify elements visually from the annotated screenshot
        with numbered bounding boxes. Icons get a generic "icon" label instead.
        """
        import torch

        uncaptioned = [(i, e) for i, e in enumerate(elements)
                       if e["type"] == "icon" and not e["content"]]
        if not uncaptioned:
            return

        # Skip captioning on CPU — too slow (~30s), agent uses visual screenshot instead
        if self._device.type == "cpu":
            for idx, _ in uncaptioned:
                elements[idx]["content"] = "icon"
            logger.info(
                "Skipped Florence-2 captioning for %d icons (CPU mode — too slow)",
                len(uncaptioned),
            )
            return

        # Crop and resize each icon region
        crops = []
        for _, elem in uncaptioned:
            bbox = elem["bbox"]
            x1 = int(bbox[0] * w)
            y1 = int(bbox[1] * h)
            x2 = int(bbox[2] * w)
            y2 = int(bbox[3] * h)
            # Clamp to image bounds
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)
            if x2 <= x1 or y2 <= y1:
                crops.append(None)
                continue
            crop = Image.fromarray(img_np[y1:y2, x1:x2])
            crop = crop.resize((ICON_CROP_SIZE, ICON_CROP_SIZE), Image.LANCZOS)
            crops.append(crop)

        # Batch caption with Florence-2
        for batch_start in range(0, len(uncaptioned), CAPTION_BATCH_SIZE):
            batch_end = min(batch_start + CAPTION_BATCH_SIZE, len(uncaptioned))
            batch_crops = [c for c in crops[batch_start:batch_end] if c is not None]
            if not batch_crops:
                continue

            prompt = "<CAPTION>"
            inputs = self._caption_processor(
                text=[prompt] * len(batch_crops),
                images=batch_crops,
                return_tensors="pt",
                padding=True,
            ).to(self._device, self._dtype)

            with torch.no_grad():
                generated_ids = self._caption_model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=20,
                    num_beams=1,
                    do_sample=False,
                    use_cache=False,  # Florence-2's custom code crashes with KV cache on some versions
                )

            captions = self._caption_processor.batch_decode(
                generated_ids, skip_special_tokens=True,
            )

            # Assign captions back
            caption_idx = 0
            for j in range(batch_start, batch_end):
                if crops[j] is not None:
                    idx, _ = uncaptioned[j]
                    elements[idx]["content"] = captions[caption_idx].strip()
                    caption_idx += 1

    def _draw_annotations(
        self, image: Image.Image, elements: list[ParsedElement],
    ) -> Image.Image:
        """Draw numbered bounding boxes on the image."""
        draw = ImageDraw.Draw(image)
        w, h = image.size

        # Try to load a readable font, fall back to default
        try:
            font = ImageFont.truetype("arial.ttf", max(12, int(h * 0.018)))
        except (OSError, IOError):
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                                          max(12, int(h * 0.018)))
            except (OSError, IOError):
                font = ImageFont.load_default()

        for elem in elements:
            color = _COLORS[elem.element_id % len(_COLORS)]
            x1 = int(elem.bbox[0] * w)
            y1 = int(elem.bbox[1] * h)
            x2 = int(elem.bbox[2] * w)
            y2 = int(elem.bbox[3] * h)

            # Draw bounding box
            draw.rectangle([x1, y1, x2, y2], outline=color, width=2)

            # Draw label background + number
            label = str(elem.element_id)
            text_bbox = draw.textbbox((0, 0), label, font=font)
            text_w = text_bbox[2] - text_bbox[0] + 6
            text_h = text_bbox[3] - text_bbox[1] + 4

            label_x = x1
            label_y = max(0, y1 - text_h - 2)
            draw.rectangle(
                [label_x, label_y, label_x + text_w, label_y + text_h],
                fill=color,
            )
            draw.text(
                (label_x + 3, label_y + 1), label, fill="white", font=font,
            )

        return image

    # ── Geometry helpers ───────────────────────────────────────────────────

    @staticmethod
    def _box_area(bbox: list[float]) -> float:
        return max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1])

    @staticmethod
    def _intersection_area(a: list[float], b: list[float]) -> float:
        x1 = max(a[0], b[0])
        y1 = max(a[1], b[1])
        x2 = min(a[2], b[2])
        y2 = min(a[3], b[3])
        return max(0, x2 - x1) * max(0, y2 - y1)

    @staticmethod
    def _compute_overlap(a: list[float], b: list[float]) -> float:
        """Compute overlap as max(IoU, intersection/area_a, intersection/area_b)."""
        inter = OmniParserLocal._intersection_area(a, b)
        area_a = OmniParserLocal._box_area(a)
        area_b = OmniParserLocal._box_area(b)
        union = area_a + area_b - inter

        iou = inter / union if union > 0 else 0
        ratio_a = inter / area_a if area_a > 0 else 0
        ratio_b = inter / area_b if area_b > 0 else 0
        return max(iou, ratio_a, ratio_b)


# ── Singleton ──────────────────────────────────────────────────────────────

_local_instance: OmniParserLocal | None = None


def get_omniparser_local() -> OmniParserLocal:
    """Return the module-level OmniParserLocal singleton."""
    global _local_instance
    if _local_instance is None:
        _local_instance = OmniParserLocal()
    return _local_instance


async def preload_omniparser() -> None:
    """Eagerly load OmniParser models in a background thread.

    Call this at server startup so models are warm by the time the first
    observe_screen request arrives.  Safe to call multiple times — loading
    is idempotent.
    """
    local = get_omniparser_local()
    if local.is_loaded or local.is_loading:
        return
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, local._ensure_loaded)
