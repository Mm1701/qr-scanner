"use strict";

/* =========================================================
   GLOBAL STATE
========================================================= */

let fileId = null;
let fileData = null;
let pairs = [];

let currentOld = null;
let scanningType = "OLD";
let scanning = false;

let codeReader = null;
let videoElement = null;

let lastScannedCode = "";
let lastScanTime = 0;
let scanBusy = false;
const SCAN_COOLDOWN = 1000; // ms nghỉ giữa 2 lần quét

let audioContext = null;
let soundEnabled = localStorage.getItem("qr_sound") !== "off";

let videoDevices = [];
let currentDeviceIndex = 0;
let currentTrack = null;
let torchOn = false;
let torchSupported = false;

let wakeLock = null;

let sessionStart = Date.now();
let statsTimer = null;

let searchTerm = "";

let keyBuffer = "";
let keyBufferTimer = null;

/* =========================================================
   INIT
========================================================= */

document.addEventListener("DOMContentLoaded", initScanner);

async function initScanner() {

    if (sessionStorage.getItem("admin_logged_in") !== "true") {
        window.location.href = "index.html";
        return;
    }

    const params = new URLSearchParams(window.location.search);
    fileId = params.get("id");

    if (!fileId) {
        alert("Không tìm thấy file.");
        window.location.href = "dashboard.html";
        return;
    }

    videoElement = document.getElementById("camera");

    setupEvents();
    applySoundIcon();

    await loadFile();
    await loadPairs();
    await syncPendingPairs(true);

    updateUI();
    startStatsTimer();

    window.addEventListener("online", () => syncPendingPairs(false));
    window.addEventListener("beforeunload", () => {
        if (wakeLock) wakeLock.release().catch(() => {});
    });

    document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible" && scanning && !wakeLock) {
            requestWakeLock();
        }
    });
}

/* =========================================================
   EVENTS
========================================================= */

function setupEvents() {

    document.getElementById("cameraBtn").addEventListener("click", toggleCamera);
    document.getElementById("saveBtn").addEventListener("click", saveFile);
    document.getElementById("backBtn").addEventListener("click", goBack);

    document.getElementById("refreshBtn").addEventListener("click", async () => {
        await loadPairs();
        await syncPendingPairs(true);
        updateUI();
        toast("Đã làm mới danh sách.", "info");
    });

    document.getElementById("torchBtn").addEventListener("click", toggleTorch);
    document.getElementById("switchCamBtn").addEventListener("click", switchCamera);
    document.getElementById("soundBtn").addEventListener("click", toggleSound);
    document.getElementById("undoBtn").addEventListener("click", undoLastPair);

    document.getElementById("exportBtn").addEventListener("click", exportExcel);

    document.getElementById("manualBtn").addEventListener("click", submitManual);
    document.getElementById("manualInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submitManual();
        }
    });

    document.getElementById("searchInput").addEventListener("input", (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        renderPairs();
    });

    // Hỗ trợ súng bắn mã vạch (bàn phím ảo): gõ nhanh + Enter
    document.addEventListener("keydown", handleKeyboardWedge);
}

function handleKeyboardWedge(e) {

    const active = document.activeElement;
    const tag = active ? active.tagName : "";

    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "Enter") {

        if (keyBuffer.trim().length >= 3) {
            const code = keyBuffer.trim();
            keyBuffer = "";
            processCode(code, "wedge");
        }

        keyBuffer = "";
        return;
    }

    if (e.key.length === 1) {
        keyBuffer += e.key;
    }

    clearTimeout(keyBufferTimer);
    keyBufferTimer = setTimeout(() => { keyBuffer = ""; }, 400);
}

/* =========================================================
   LOAD FILE
========================================================= */

async function loadFile() {

    const { data, error } = await supabaseClient
        .from("scan_files")
        .select("*")
        .eq("id", Number(fileId))
        .single();

    if (error) {
        console.error(error);
        alert("Không thể tải file.");
        window.location.href = "dashboard.html";
        return;
    }

    fileData = data;

    document.getElementById("fileTitle").textContent = fileData.file_name;

    const status = document.getElementById("fileStatus");
    status.textContent = fileData.status;
    status.className = "status " + (fileData.status === "SAVED" ? "saved" : "draft");
}

/* =========================================================
   LOAD PAIRS
========================================================= */

async function loadPairs() {

    const { data, error } = await supabaseClient
        .from("scan_pairs")
        .select("*")
        .eq("file_id", Number(fileId))
        .order("sequence", { ascending: true });

    if (error) {
        console.error(error);
        toast("Không thể tải danh sách scan.", "error");
        return;
    }

    pairs = data || [];

    currentOld = null;
    scanningType = "OLD";
    scanBusy = false;
}

/* =========================================================
   CAMERA
========================================================= */

async function toggleCamera() {
    if (scanning) {
        stopCamera();
        return;
    }
    await startCamera();
}

async function startCamera() {

    if (typeof ZXing === "undefined") {
        toast("Không tải được thư viện QR Scanner.", "error");
        return;
    }

    try {
        initAudio();

        codeReader = new ZXing.BrowserQRCodeReader();

        const devices = await codeReader.listVideoInputDevices();

        if (!devices.length) {
            throw new Error("Không tìm thấy camera.");
        }

        videoDevices = devices;

        // Ưu tiên camera sau
        let deviceIndex = devices.findIndex((d) => {
            const label = (d.label || "").toLowerCase();
            return label.includes("back") || label.includes("rear") ||
                   label.includes("environment") || label.includes("sau");
        });

        if (deviceIndex === -1) deviceIndex = 0;
        currentDeviceIndex = deviceIndex;

        await startDecoding(devices[currentDeviceIndex].deviceId);

        scanning = true;
        scanBusy = false;

        const button = document.getElementById("cameraBtn");
        button.textContent = "⏹ TẮT CAMERA";
        button.classList.add("danger-camera");

        document.getElementById("switchCamBtn").classList.toggle("hidden", videoDevices.length < 2);

        setMessage("Đưa QR vào khung quét...", "normal");

        requestWakeLock();

    } catch (error) {
        console.error(error);
        scanning = false;
        setMessage(error.message || "Không thể bật camera.", "error");
        toast("Không thể bật camera.", "error");
    }
}

async function startDecoding(deviceId) {

    await codeReader.decodeFromVideoDevice(deviceId, videoElement, (result) => {
        if (result) {
            processCode(result.getText(), "camera");
        }
    });

    detectTorchSupport();
}

function detectTorchSupport() {

    try {
        currentTrack = videoElement.srcObject
            ? videoElement.srcObject.getVideoTracks()[0]
            : null;

        const caps = currentTrack && currentTrack.getCapabilities
            ? currentTrack.getCapabilities()
            : {};

        torchSupported = !!(caps && caps.torch);

        document.getElementById("torchBtn").classList.toggle("hidden", !torchSupported);

    } catch (error) {
        torchSupported = false;
        document.getElementById("torchBtn").classList.add("hidden");
    }
}

async function toggleTorch() {

    if (!currentTrack || !torchSupported) {
        toast("Camera này không hỗ trợ đèn flash.", "warning");
        return;
    }

    try {
        torchOn = !torchOn;
        await currentTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
        document.getElementById("torchBtn").classList.toggle("active", torchOn);
    } catch (error) {
        console.error(error);
        toast("Không thể bật đèn flash.", "error");
        torchOn = false;
    }
}

async function switchCamera() {

    if (videoDevices.length < 2) return;

    try {
        if (codeReader) codeReader.reset();

        currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;

        codeReader = new ZXing.BrowserQRCodeReader();
        await startDecoding(videoDevices[currentDeviceIndex].deviceId);

        torchOn = false;
        document.getElementById("torchBtn").classList.remove("active");

        toast("Đã đổi camera.", "info");

    } catch (error) {
        console.error(error);
        toast("Không thể đổi camera.", "error");
    }
}

async function requestWakeLock() {
    try {
        if ("wakeLock" in navigator) {
            wakeLock = await navigator.wakeLock.request("screen");
            wakeLock.addEventListener("release", () => { wakeLock = null; });
        }
    } catch (error) {
        // im lặng bỏ qua nếu thiết bị không hỗ trợ
    }
}

/* =========================================================
   STOP CAMERA
========================================================= */

function stopCamera() {

    scanning = false;
    scanBusy = false;
    torchOn = false;

    if (codeReader) {
        try { codeReader.reset(); } catch (error) { console.error(error); }
    }

    if (videoElement && videoElement.srcObject) {
        const tracks = videoElement.srcObject.getTracks();
        tracks.forEach((track) => track.stop());
        videoElement.srcObject = null;
    }

    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }

    const button = document.getElementById("cameraBtn");
    button.textContent = "📷 BẬT CAMERA";
    button.classList.remove("danger-camera");

    document.getElementById("torchBtn").classList.add("hidden");
    document.getElementById("switchCamBtn").classList.add("hidden");

    setMessage("Camera đã tắt.", "normal");
}

/* =========================================================
   MANUAL ENTRY
========================================================= */

function submitManual() {

    const input = document.getElementById("manualInput");
    const code = input.value.trim();

    if (!code) {
        toast("Vui lòng nhập mã.", "warning");
        return;
    }

    input.value = "";
    processCode(code, "manual");
}

/* =========================================================
   QR RESULT (camera / manual / keyboard wedge)
========================================================= */

function processCode(rawCode, source) {

    const code = String(rawCode || "").trim();
    if (!code) return;

    // Chỉ camera mới cần chống đọc trùng liên tục do quét nhiều frame
    if (source === "camera") {

        if (scanBusy) return;

        const now = Date.now();

        if (code === lastScannedCode && now - lastScanTime < SCAN_COOLDOWN) {
            return;
        }

        scanBusy = true;
        lastScannedCode = code;
        lastScanTime = now;
    }

    try {
        if (scanningType === "OLD") {
            handleOld(code);
        } else {
            handleNew(code);
        }
    } catch (error) {
        console.error(error);
    } finally {
        if (source === "camera") {
            setTimeout(() => { scanBusy = false; }, SCAN_COOLDOWN);
        }
    }
}

/* Giữ tên hàm cũ để tương thích nếu có nơi khác gọi tới */
function handleQRCode(rawCode) {
    processCode(rawCode, "camera");
}

/* =========================================================
   OLD
========================================================= */

function handleOld(code) {

    const condition = (fileData.old_condition || "").trim();

    if (condition && !code.includes(condition)) {
        flashResult(false, `QR phải chứa: ${condition}`);
        setMessage(`❌ OLD không hợp lệ.\nQR phải chứa: ${condition}`, "error");
        return;
    }

    if (isDuplicateCode(code)) {
        flashResult(false, "Mã đã quét trước đó");
        setMessage("❌ QR này đã được quét trước đó.", "error");
        return;
    }

    currentOld = code;
    scanningType = "NEW";

    flashResult(true, code);
    setMessage(`✓ OLD OK\n${code}\n\n→ Bây giờ quét NEW`, "success");

    updateUI();
}

/* =========================================================
   NEW
========================================================= */

async function handleNew(code) {

    if (!currentOld) {
        scanningType = "OLD";
        updateUI();
        return;
    }

    if (code === currentOld) {
        flashResult(false, "OLD và NEW trùng nhau");
        setMessage("❌ OLD và NEW không được trùng nhau.\n\nHãy quét NEW khác.", "error");
        return;
    }

    const condition = (fileData.new_condition || "").trim();

    if (condition && !code.includes(condition)) {
        flashResult(false, `QR phải chứa: ${condition}`);
        setMessage(`❌ NEW không hợp lệ.\nQR phải chứa: ${condition}`, "error");
        return;
    }

    if (isDuplicateCode(code)) {
        flashResult(false, "Mã đã quét trước đó");
        setMessage("❌ QR này đã được quét trước đó.", "error");
        return;
    }

    const nextSequence = pairs.length + 1;
    const oldBoxValue = currentOld;

    try {

        if (!navigator.onLine) {
            throw new Error("OFFLINE");
        }

        const { data, error } = await supabaseClient
            .from("scan_pairs")
            .insert({
                file_id: Number(fileId),
                sequence: nextSequence,
                old_box: oldBoxValue,
                new_box: code,
            })
            .select()
            .single();

        if (error) {

            if (error.code === "23505") {
                flashResult(false, "Mã bị trùng trong database");
                setMessage("❌ QR bị trùng trong database.", "error");
                return;
            }

            throw error;
        }

        pairs.push(data);

        flashResult(true, `${oldBoxValue} → ${code}`);
        setMessage(`✓ PASS\n\nOLD: ${oldBoxValue}\nNEW: ${code}`, "success");

        currentOld = null;
        scanningType = "OLD";

        updateUI();

    } catch (error) {

        console.error(error);

        // Mất mạng: lưu tạm cục bộ, tự đồng bộ khi có mạng lại
        if (error.message === "OFFLINE" || /fetch|network/i.test(error.message || "")) {

            queuePendingPair({
                file_id: Number(fileId),
                sequence: nextSequence,
                old_box: oldBoxValue,
                new_box: code,
            });

            pairs.push({
                id: "local-" + Date.now(),
                sequence: nextSequence,
                old_box: oldBoxValue,
                new_box: code,
                _pending: true,
            });

            flashResult(true, `${oldBoxValue} → ${code}`);
            setMessage(`✓ PASS (lưu offline)\n\nOLD: ${oldBoxValue}\nNEW: ${code}`, "success");
            toast("Mất mạng — đã lưu tạm, sẽ đồng bộ tự động.", "warning");

            currentOld = null;
            scanningType = "OLD";

            updateUI();
            return;
        }

        flashResult(false, "Lưu cặp thất bại");
        setMessage("❌ Lưu cặp thất bại:\n" + error.message, "error");
        toast("Lưu cặp thất bại.", "error");
    }
}

/* =========================================================
   OFFLINE QUEUE
========================================================= */

function pendingKey() {
    return "qr_pending_" + fileId;
}

function queuePendingPair(pair) {
    const list = JSON.parse(localStorage.getItem(pendingKey()) || "[]");
    list.push(pair);
    localStorage.setItem(pendingKey(), JSON.stringify(list));
}

async function syncPendingPairs(silent) {

    const list = JSON.parse(localStorage.getItem(pendingKey()) || "[]");

    if (!list.length || !navigator.onLine) return;

    let synced = 0;

    for (const item of [...list]) {

        try {
            const { error } = await supabaseClient
                .from("scan_pairs")
                .insert(item);

            if (error && error.code !== "23505") throw error;

            list.shift();
            synced++;

        } catch (error) {
            console.error("Sync lỗi:", error);
            break;
        }
    }

    localStorage.setItem(pendingKey(), JSON.stringify(list));

    if (synced > 0) {
        await loadPairs();
        updateUI();
        if (!silent) toast(`Đã đồng bộ ${synced} cặp offline.`, "success");
    }
}

/* =========================================================
   UNDO
========================================================= */

async function undoLastPair() {

    if (!pairs.length) return;

    const last = pairs[pairs.length - 1];

    const ok = confirm(`Hoàn tác cặp cuối?\n\nOLD: ${last.old_box}\nNEW: ${last.new_box}`);
    if (!ok) return;

    if (String(last.id).startsWith("local-")) {

        // Xoá khỏi hàng đợi offline
        const list = JSON.parse(localStorage.getItem(pendingKey()) || "[]");
        list.pop();
        localStorage.setItem(pendingKey(), JSON.stringify(list));

        pairs.pop();
        updateUI();
        toast("Đã hoàn tác cặp cuối.", "info");
        return;
    }

    await deletePair(last.id, true);
}

/* =========================================================
   DUPLICATE
========================================================= */

function isDuplicateCode(code) {
    return pairs.some((pair) => pair.old_box === code || pair.new_box === code);
}

/* =========================================================
   DELETE PAIR
========================================================= */

async function deletePair(id, skipConfirm) {

    if (!skipConfirm) {
        const ok = confirm("Xóa cặp này?");
        if (!ok) return;
    }

    try {
        const { error } = await supabaseClient.from("scan_pairs").delete().eq("id", id);
        if (error) throw error;

        await renumberPairs();
        await loadPairs();
        updateUI();
        toast("Đã xóa cặp.", "info");

    } catch (error) {
        console.error(error);
        toast("Xóa thất bại: " + error.message, "error");
    }
}

/* =========================================================
   RENUMBER
========================================================= */

async function renumberPairs() {

    const sorted = [...pairs].sort((a, b) => a.sequence - b.sequence);

    for (let i = 0; i < sorted.length; i++) {

        const item = sorted[i];
        const newSequence = i + 1;

        if (item.sequence === newSequence || String(item.id).startsWith("local-")) continue;

        const { error } = await supabaseClient
            .from("scan_pairs")
            .update({ sequence: newSequence })
            .eq("id", item.id);

        if (error) throw error;
    }
}

/* =========================================================
   EXPORT EXCEL
========================================================= */

function exportExcel() {

    if (!pairs.length) {
        toast("Chưa có dữ liệu để xuất.", "warning");
        return;
    }

    try {
        const rows = pairs.map((p, i) => ({
            "STT": i + 1,
            "OLD BOX": p.old_box,
            "NEW BOX": p.new_box,
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Pairs");

        const safeName = (fileData?.file_name || "scan").replace(/[^a-z0-9_\-]+/gi, "_");
        XLSX.writeFile(wb, `${safeName}.xlsx`);

        toast("Đã xuất file Excel.", "success");

    } catch (error) {
        console.error(error);
        toast("Xuất Excel thất bại.", "error");
    }
}

/* =========================================================
   SAVE
========================================================= */

async function saveFile() {

    if (currentOld) {
        alert("Đang có OLD chưa ghép NEW.\n\nHãy quét NEW trước khi SAVE.");
        return;
    }

    if (!pairs.length) {
        alert("Chưa có cặp nào.");
        return;
    }

    const pendingCount = JSON.parse(localStorage.getItem(pendingKey()) || "[]").length;

    if (pendingCount > 0) {
        alert(`Còn ${pendingCount} cặp chưa đồng bộ do mất mạng.\n\nVui lòng kiểm tra kết nối rồi bấm ↻ để đồng bộ trước khi SAVE.`);
        return;
    }

    const ok = confirm(`SAVE file "${fileData.file_name}" với ${pairs.length} cặp?`);
    if (!ok) return;

    try {
        const now = new Date().toISOString();

        const { error } = await supabaseClient
            .from("scan_files")
            .update({ status: "SAVED", updated_at: now, saved_at: now })
            .eq("id", Number(fileId));

        if (error) throw error;

        fileData.status = "SAVED";

        const status = document.getElementById("fileStatus");
        status.textContent = "SAVED";
        status.className = "status saved";

        flashResult(true, "ĐÃ SAVE FILE");
        setMessage("✓ ĐÃ SAVE FILE", "success");

    } catch (error) {
        console.error(error);
        flashResult(false, "SAVE thất bại");
        alert("SAVE thất bại:\n" + error.message);
    }
}

/* =========================================================
   SESSION STATS
========================================================= */

function startStatsTimer() {

    if (statsTimer) clearInterval(statsTimer);

    statsTimer = setInterval(() => {

        const elapsedMs = Date.now() - sessionStart;
        const totalSec = Math.floor(elapsedMs / 1000);
        const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
        const ss = String(totalSec % 60).padStart(2, "0");

        document.getElementById("statElapsed").textContent = `${mm}:${ss}`;

        const minutes = elapsedMs / 60000;
        const rate = minutes > 0 ? (pairs.length / minutes).toFixed(1) : "0";

        document.getElementById("statRate").textContent = rate;

    }, 1000);
}

/* =========================================================
   UI
========================================================= */

function updateUI() {

    document.getElementById("pairTitle").textContent = `CẶP #${pairs.length + 1}`;

    const mode = document.getElementById("scanMode");
    const modeText = document.getElementById("scanModeText");
    const currentOldBox = document.getElementById("currentOldBox");
    const currentOldValue = document.getElementById("currentOldValue");

    if (scanningType === "OLD") {
        modeText.textContent = "ĐANG QUÉT TEM CŨ (OLD)";
        mode.className = "scan-mode old-mode";
        mode.querySelector(".scan-mode-icon").textContent = "🔵";
        currentOldBox.classList.add("hidden");
    } else {
        modeText.textContent = "ĐANG QUÉT TEM MỚI (NEW)";
        mode.className = "scan-mode new-mode";
        mode.querySelector(".scan-mode-icon").textContent = "🟢";
        currentOldBox.classList.remove("hidden");
        currentOldValue.textContent = currentOld || "-";
    }

    const condition = document.getElementById("conditionText");

    if (scanningType === "OLD") {
        const value = fileData?.old_condition || "";
        condition.textContent = value ? `Điều kiện OLD: ${value}` : "OLD: Không giới hạn";
    } else {
        const value = fileData?.new_condition || "";
        condition.textContent = value ? `Điều kiện NEW: ${value}` : "NEW: Không giới hạn";
    }

    document.getElementById("pairCount").textContent = pairs.length;
    document.getElementById("oldCount").textContent = pairs.length + (currentOld ? 1 : 0);
    document.getElementById("newCount").textContent = pairs.length;

    document.getElementById("undoBtn").disabled = pairs.length === 0;

    renderPairs();
}

/* =========================================================
   RENDER PAIRS
========================================================= */

function renderPairs() {

    const tbody = document.getElementById("pairTable");

    let list = pairs;

    if (searchTerm) {
        list = pairs.filter((p) =>
            String(p.old_box).toLowerCase().includes(searchTerm) ||
            String(p.new_box).toLowerCase().includes(searchTerm)
        );
    }

    if (!list.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="no-data">
                    ${searchTerm ? "Không tìm thấy kết quả" : "Chưa có dữ liệu"}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = list
        .map((pair) => `
            <tr class="${pair._pending ? "row-flash" : ""}">
                <td>${pair.sequence}${pair._pending ? " ⏳" : ""}</td>
                <td class="qr-cell">${highlight(escapeHtml(pair.old_box))}</td>
                <td class="qr-cell">${highlight(escapeHtml(pair.new_box))}</td>
                <td>
                    ${pair._pending
                        ? ""
                        : `<button class="delete-row-btn" onclick="deletePair(${pair.id})" title="Xóa">🗑</button>`
                    }
                </td>
            </tr>
        `)
        .join("");
}

function highlight(text) {
    if (!searchTerm) return text;
    const re = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    return text.replace(re, '<span class="match">$1</span>');
}

/* =========================================================
   RESULT FLASH OVERLAY
========================================================= */

let flashTimer = null;

function flashResult(pass, text) {

    const el = document.getElementById("resultFlash");
    const icon = document.getElementById("resultFlashIcon");
    const label = document.getElementById("resultFlashText");

    clearTimeout(flashTimer);

    el.className = "result-flash show " + (pass ? "pass" : "fail");
    icon.textContent = pass ? "✓" : "✕";
    label.textContent = text || "";

    if (pass) {
        playPassSound();
    } else {
        playFailSound();
    }

    flashTimer = setTimeout(() => {
        el.classList.remove("show");
    }, 650);
}

/* =========================================================
   AUDIO + VIBRATION
========================================================= */

function initAudio() {
    try {
        if (!audioContext) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) audioContext = new AudioCtx();
        }
        if (audioContext && audioContext.state === "suspended") {
            audioContext.resume();
        }
    } catch (error) {
        console.warn("Không khởi tạo được âm thanh:", error);
    }
}

function vibrate(pattern) {
    try {
        if ("vibrate" in navigator) navigator.vibrate(pattern);
    } catch (error) {
        console.warn("Không rung được:", error);
    }
}

function playTone(frequency, duration, type = "sine", volume = 0.30) {

    if (!soundEnabled) return;

    try {
        initAudio();
        if (!audioContext) return;

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = type;
        oscillator.frequency.value = frequency;

        const now = audioContext.currentTime;

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + duration + 0.03);

    } catch (error) {
        console.warn("Không phát được âm thanh:", error);
    }
}

function playPassSound() {
    vibrate([80, 50, 120]);
    playTone(880, 0.14, "sine", 0.32);
    setTimeout(() => playTone(1320, 0.18, "sine", 0.36), 130);
}

function playFailSound() {
    vibrate([180, 80, 180]);
    playTone(240, 0.20, "square", 0.38);
    setTimeout(() => playTone(160, 0.25, "square", 0.40), 210);
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem("qr_sound", soundEnabled ? "on" : "off");
    applySoundIcon();
    toast(soundEnabled ? "Đã bật âm thanh." : "Đã tắt âm thanh.", "info");
}

function applySoundIcon() {
    const btn = document.getElementById("soundBtn");
    btn.textContent = soundEnabled ? "🔊 ÂM" : "🔇 ÂM";
    btn.classList.toggle("muted", !soundEnabled);
}

/* =========================================================
   TOAST
========================================================= */

function toast(message, type = "info") {

    const container = document.getElementById("toastContainer");
    const el = document.createElement("div");

    el.className = "toast " + type;
    el.textContent = message;

    container.appendChild(el);

    setTimeout(() => el.remove(), 3000);
}

/* =========================================================
   MESSAGE
========================================================= */

function setMessage(text, type = "normal") {
    const element = document.getElementById("scanMessage");
    element.textContent = text;
    element.className = "scan-message " + type;
}

/* =========================================================
   BACK
========================================================= */

function goBack() {

    if (currentOld) {
        const ok = confirm("Đang có OLD chưa ghép NEW.\n\nBạn có chắc muốn thoát?");
        if (!ok) return;
    }

    stopCamera();
    window.location.href = "dashboard.html";
}

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
