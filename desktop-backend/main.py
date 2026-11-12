from pathlib import Path
import cv2
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "panoramas"

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="RoomView")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/stitch")
async def stitch_photos(files: list[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(400, "Upload at least two overlapping photos.")

    session = uuid.uuid4().hex
    session_dir = UPLOAD_DIR / session
    session_dir.mkdir(parents=True, exist_ok=True)

    image_paths = []
    try:
        for index, upload in enumerate(files):
            if not upload.content_type or not upload.content_type.startswith("image/"):
                raise HTTPException(400, f"{upload.filename} is not an image.")

            content = await upload.read()
            if len(content) > 25 * 1024 * 1024:
                raise HTTPException(413, f"{upload.filename} exceeds the 25 MB limit.")

            path = session_dir / f"{index}.jpg"
            path.write_bytes(content)
            image_paths.append(path)

        images = []
        for path in image_paths:
            image = cv2.imread(str(path))
            if image is None:
                raise HTTPException(400, "One of the uploaded images could not be decoded.")
            images.append(image)

        stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
        status, panorama = stitcher.stitch(images)

        if status != cv2.Stitcher_OK or panorama is None:
            messages = {
                cv2.Stitcher_ERR_NEED_MORE_IMGS: "Not enough usable images.",
                cv2.Stitcher_ERR_HOMOGRAPHY_EST_FAIL: "The photos could not be aligned. Retake them with more overlap.",
                cv2.Stitcher_ERR_CAMERA_PARAMS_ADJUST_FAIL: "The photos could not be calibrated. Try a steadier, more consistent set.",
            }
            raise HTTPException(422, messages.get(status, f"Panorama stitching failed (code {status})."))

        output_name = f"{session}.jpg"
        output_path = OUTPUT_DIR / output_name
        if not cv2.imwrite(str(output_path), panorama, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            raise HTTPException(500, "Could not save the panorama.")

        return {
            "message": "Panorama created.",
            "image": f"/panoramas/{output_name}",
            "width": int(panorama.shape[1]),
            "height": int(panorama.shape[0]),
        }
    finally:
        shutil.rmtree(session_dir, ignore_errors=True)


@app.get("/panoramas/{filename}")
def get_panorama(filename: str):
    if Path(filename).name != filename or not filename.lower().endswith(".jpg"):
        raise HTTPException(400, "Invalid filename.")
    path = OUTPUT_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Panorama not found.")
    return FileResponse(path, media_type="image/jpeg")
