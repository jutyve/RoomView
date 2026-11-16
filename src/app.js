import * as THREE from "three";
import "./style.css";

const canvasHost = document.getElementById("canvasHost");
const welcome = document.getElementById("welcome");
const statusEl = document.getElementById("status");
const uploadPanel = document.getElementById("uploadPanel");
const panoramaInput = document.getElementById("panoramaInput");
const savedPanoramasEl = document.getElementById("savedPanoramas");
const uploadMessage = document.getElementById("uploadMessage");
const gyroButton = document.getElementById("gyroButton");
const vrButton = document.getElementById("vrButton");
const permissionNotice = document.getElementById("permissionNotice");
const viewerHint = document.getElementById("viewerHint");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
camera.position.set(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvasHost.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = "none";

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(500, 80, 60),
  new THREE.MeshBasicMaterial({ color: 0x202832, side: THREE.BackSide })
);
scene.add(sphere);

let panoramaTexture = null;
let yaw = 0;
let pitch = 0;
let targetYaw = 0;
let targetPitch = 0;
let zoom = 75;
let gyroEnabled = false;
let stereoEnabled = false;
let lastDeviceYaw = null;
let lastDevicePitch = null;
let lastDeviceTimestamp = null;
let activePointers = new Map();

// Use yaw only to choose left/right; panorama panning stays at a steady speed.
const GYRO_PAN_SPEED = THREE.MathUtils.degToRad(40);
const GYRO_TURN_DEAD_ZONE = THREE.MathUtils.degToRad(5);
const GYRO_RATE_SMOOTHING_SECONDS = 0.06;
const GYRO_PITCH_SENSITIVITY = 0.25;
const MAX_GYRO_PITCH_SPEED = THREE.MathUtils.degToRad(45);
const GYRO_PITCH_DEAD_ZONE = THREE.MathUtils.degToRad(0.06);
let filteredDeviceYawRate = 0;
let lastX = 0;
let lastY = 0;
let pinchDistance = 0;

const databasePromise = new Promise((resolve, reject) => {
  const request = indexedDB.open("RoomViewDatabase", 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("panoramas")) {
      database.createObjectStore("panoramas", { keyPath: "id" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function databaseAction(mode, action) {
  const database = await databasePromise;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("panoramas", mode);
    const request = action(transaction.objectStore("panoramas"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePanorama(file) {
  const record = {
    id: crypto.randomUUID(),
    name: file.name || "Room panorama",
    blob: file,
    createdAt: Date.now()
  };
  await databaseAction("readwrite", store => store.put(record));
  await renderSavedPanoramas();
  return record;
}

async function renderSavedPanoramas() {
  savedPanoramasEl.replaceChildren();
  try {
    const records = await databaseAction("readonly", store => store.getAll());
    records.sort((a, b) => b.createdAt - a.createdAt);
    if (!records.length) {
      savedPanoramasEl.textContent = "No saved panoramas yet.";
      return;
    }
    for (const record of records) {
      const row = document.createElement("div");
      row.className = "saved-row";
      const openButton = document.createElement("button");
      openButton.className = "saved-open";
      openButton.textContent = record.name;
      openButton.addEventListener("click", () => {
        const url = URL.createObjectURL(record.blob);
        loadPanorama(url, `Loaded · ${record.name}`);
      });
      const deleteButton = document.createElement("button");
      deleteButton.className = "saved-delete";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", async () => {
        await databaseAction("readwrite", store => store.delete(record.id));
        await renderSavedPanoramas();
      });
      row.append(openButton, deleteButton);
      savedPanoramasEl.append(row);
    }
  } catch (error) {
    savedPanoramasEl.textContent = "Phone storage is unavailable in this session.";
  }
}

function resize() {
  const width = canvasHost.clientWidth;
  const height = canvasHost.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.fov = zoom;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(canvasHost);
resize();

function setStatus(message) {
  statusEl.textContent = message;
}

function updateViewerHint() {
  if (gyroEnabled) {
    viewerHint.textContent = "Turn phone left or right to pan steadily · Tilt to look up or down";
  } else if (stereoEnabled) {
    viewerHint.textContent = "Place phone in a compatible viewer · Drag to look around";
  } else {
    viewerHint.textContent = "Drag to look around · Pinch to zoom";
  }
}

function showMessage(message, error = false) {
  uploadMessage.textContent = message;
  uploadMessage.classList.toggle("error", error);
}

function loadPanorama(source, label = "Panorama loaded") {
  const loader = new THREE.TextureLoader();
  loader.load(
    source,
    texture => {
      if (panoramaTexture) panoramaTexture.dispose();
      panoramaTexture = texture;
      panoramaTexture.colorSpace = THREE.SRGBColorSpace;
      sphere.material.map = texture;
      sphere.material.color.set(0xffffff);
      sphere.material.needsUpdate = true;
      welcome.classList.add("hidden");
      uploadPanel.classList.add("hidden");
      targetYaw = yaw = 0;
      targetPitch = pitch = 0;
      setStatus(label);
    },
    undefined,
    error => {
      console.error(error);
      showMessage("The image could not be loaded. Choose a valid panorama image.", true);
    }
  );
}

function openPanel() {
  uploadPanel.classList.remove("hidden");
  renderSavedPanoramas();
}
function closePanel() {
  uploadPanel.classList.add("hidden");
}

document.getElementById("uploadToggle").addEventListener("click", openPanel);
document.getElementById("startUpload").addEventListener("click", openPanel);
document.getElementById("closeUpload").addEventListener("click", closePanel);

panoramaInput.addEventListener("change", async () => {
  const file = panoramaInput.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  loadPanorama(url, `Loaded · ${file.name}`);
  showMessage("Saving panorama on this phone…");
  try {
    await savePanorama(file);
    showMessage("Panorama saved. You can open it again without internet.");
  } catch (error) {
    showMessage("Panorama opened, but phone storage could not save it.", true);
  }
  panoramaInput.value = "";
});

renderer.domElement.addEventListener("pointerdown", event => {
  if (gyroEnabled) return;
  renderer.domElement.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 1) {
    lastX = event.clientX;
    lastY = event.clientY;
  } else if (activePointers.size === 2) {
    const points = Array.from(activePointers.values());
    pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }
});

renderer.domElement.addEventListener("pointermove", event => {
  if (!activePointers.has(event.pointerId) || gyroEnabled) return;
  const previous = activePointers.get(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 1) {
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    targetYaw -= dx * 0.004;
    targetPitch -= dy * 0.004;
    targetPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, targetPitch));
  } else if (activePointers.size === 2) {
    const points = Array.from(activePointers.values());
    const nextDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    if (pinchDistance > 0) {
      zoom = Math.max(35, Math.min(100, zoom - (nextDistance - pinchDistance) * 0.08));
      camera.fov = zoom;
      camera.updateProjectionMatrix();
    }
    pinchDistance = nextDistance;
  }
});

function stopPointer(event) {
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) pinchDistance = 0;
}
renderer.domElement.addEventListener("pointerup", stopPointer);
renderer.domElement.addEventListener("pointercancel", stopPointer);
renderer.domElement.addEventListener("wheel", event => {
  event.preventDefault();
  zoom = Math.max(35, Math.min(100, zoom + event.deltaY * 0.035));
  camera.fov = zoom;
  camera.updateProjectionMatrix();
}, { passive: false });

function updateCamera() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function renderStereo(width, height) {
  const half = Math.floor(width / 2);
  const eyeSeparation = 0.032;
  renderer.setScissorTest(true);
  camera.aspect = half / height;
  camera.updateProjectionMatrix();
  camera.position.x = -eyeSeparation / 2;
  renderer.setViewport(0, 0, half, height);
  renderer.setScissor(0, 0, half, height);
  renderer.render(scene, camera);
  camera.position.x = eyeSeparation / 2;
  renderer.setViewport(half, 0, width - half, height);
  renderer.setScissor(half, 0, width - half, height);
  renderer.render(scene, camera);
  camera.position.x = 0;
  renderer.setScissorTest(false);
}

function animate() {
  requestAnimationFrame(animate);
  yaw = normalizeAngle(yaw + normalizeAngle(targetYaw - yaw) * 0.12);
  pitch += (targetPitch - pitch) * 0.12;
  updateCamera();
  const width = canvasHost.clientWidth;
  const height = canvasHost.clientHeight;
  if (stereoEnabled) {
    renderStereo(width, height);
  } else {
    camera.position.set(0, 0, 0);
    camera.aspect = width / Math.max(height, 1);
    camera.fov = zoom;
    camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, width, height);
    renderer.render(scene, camera);
  }
}
animate();

document.getElementById("resetButton").addEventListener("click", () => {
  targetYaw = 0;
  targetPitch = 0;
  zoom = 75;
  camera.fov = zoom;
  camera.updateProjectionMatrix();
});

document.getElementById("fullscreenButton").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.getElementById("viewer").requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.error("Fullscreen failed:", error);
  }
});

function normalizeAngle(value) {
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function handleDeviceOrientation(event) {
  if (!gyroEnabled || event.alpha == null || event.beta == null || event.gamma == null) return;
  const alpha = THREE.MathUtils.degToRad(event.alpha);
  const beta = THREE.MathUtils.degToRad(event.beta);
  const gamma = THREE.MathUtils.degToRad(event.gamma);
  const orientation = screen.orientation?.angle ?? window.orientation ?? 0;
  const screenAngle = THREE.MathUtils.degToRad(Number(orientation) || 0);
  const euler = new THREE.Euler(beta, alpha, -gamma, "YXZ");
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screenAngle));
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const nextYaw = Math.atan2(-direction.x, -direction.z);
  const nextPitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));
  const timestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();

  // The first sample only establishes a reference, so enabling motion never jumps the view.
  if (lastDeviceYaw === null || lastDevicePitch === null || lastDeviceTimestamp === null) {
    lastDeviceYaw = nextYaw;
    lastDevicePitch = nextPitch;
    lastDeviceTimestamp = timestamp;
    return;
  }

  const rawElapsed = (timestamp - lastDeviceTimestamp) / 1000;
  const yawDelta = normalizeAngle(nextYaw - lastDeviceYaw);
  const pitchDelta = nextPitch - lastDevicePitch;
  lastDeviceYaw = nextYaw;
  lastDevicePitch = nextPitch;
  lastDeviceTimestamp = timestamp;
  if (!Number.isFinite(rawElapsed) || rawElapsed <= 0 || rawElapsed > 0.5) {
    filteredDeviceYawRate = 0;
    return;
  }

  const elapsed = THREE.MathUtils.clamp(rawElapsed, 1 / 120, 0.1);
  const measuredYawRate = yawDelta / elapsed;
  const smoothing = 1 - Math.exp(-elapsed / GYRO_RATE_SMOOTHING_SECONDS);
  filteredDeviceYawRate += (measuredYawRate - filteredDeviceYawRate) * smoothing;

  // A right/left turn selects direction; the panorama then pans at a steady rate.
  if (Math.abs(filteredDeviceYawRate) > GYRO_TURN_DEAD_ZONE) {
    targetYaw = normalizeAngle(
      targetYaw + Math.sign(filteredDeviceYawRate) * GYRO_PAN_SPEED * elapsed
    );
  }

  const filteredPitchDelta = Math.abs(pitchDelta) < GYRO_PITCH_DEAD_ZONE ? 0 : pitchDelta;
  const maxPitchStep = MAX_GYRO_PITCH_SPEED * elapsed;
  const pitchStep = THREE.MathUtils.clamp(
    filteredPitchDelta * GYRO_PITCH_SENSITIVITY,
    -maxPitchStep,
    maxPitchStep
  );
  targetPitch = THREE.MathUtils.clamp(
    targetPitch + pitchStep,
    -Math.PI / 2 + 0.01,
    Math.PI / 2 - 0.01
  );
}

function resetDeviceMotionReference() {
  lastDeviceYaw = null;
  lastDevicePitch = null;
  lastDeviceTimestamp = null;
  filteredDeviceYawRate = 0;
}

async function enableGyroscope() {
  try {
    if (!("DeviceOrientationEvent" in window)) {
      throw new Error("This device does not provide orientation events.");
    }
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") throw new Error("Motion permission was not granted.");
    }
    resetDeviceMotionReference();
    gyroEnabled = true;
    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    gyroButton.classList.add("active");
    gyroButton.textContent = "Motion enabled";
    permissionNotice.classList.add("hidden");
    updateViewerHint();
  } catch (error) {
    permissionNotice.textContent = error.message || "Could not enable motion controls.";
    permissionNotice.classList.remove("hidden");
  }
}

function disableGyroscope() {
  gyroEnabled = false;
  window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
  resetDeviceMotionReference();
  gyroButton.classList.remove("active");
  gyroButton.textContent = "Enable motion";
  updateViewerHint();
}

gyroButton.addEventListener("click", () => {
  if (gyroEnabled) disableGyroscope();
  else enableGyroscope();
});

vrButton.addEventListener("click", () => {
  stereoEnabled = !stereoEnabled;
  vrButton.classList.toggle("active", stereoEnabled);
  vrButton.textContent = stereoEnabled ? "Exit VR view" : "VR view";
  updateViewerHint();
  resize();
});

renderSavedPanoramas();
