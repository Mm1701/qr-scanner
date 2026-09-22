"use strict";


/* =========================================================
   GLOBAL
========================================================= */

let fileId = null;

let fileData = null;

let pairs = [];

let currentOld = null;

let scanningType = "OLD";

let scanning = false;

let codeReader = null;

let lastScannedCode = "";

let lastScanTime = 0;

let videoElement = null;


// =========================================================
// CHỐNG QUÉT QUÁ NHANH
// =========================================================

let scanBusy = false;

// Camera sẽ nghỉ 1 giây sau mỗi lần nhận QR
const SCAN_COOLDOWN = 1000;


// =========================================================
// AUDIO
// =========================================================

let audioContext = null;


/* =========================================================
   INIT
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    initScanner
);


async function initScanner() {

    if (
        sessionStorage.getItem(
            "admin_logged_in"
        ) !== "true"
    ) {

        window.location.href =
            "index.html";

        return;
    }


    const params =
        new URLSearchParams(
            window.location.search
        );


    fileId =
        params.get("id");


    if (!fileId) {

        alert(
            "Không tìm thấy file."
        );

        window.location.href =
            "dashboard.html";

        return;
    }


    videoElement =
        document.getElementById(
            "camera"
        );


    setupEvents();

    await loadFile();

    await loadPairs();

    updateUI();
}


/* =========================================================
   EVENTS
========================================================= */

function setupEvents() {

    document
        .getElementById("cameraBtn")
        .addEventListener(
            "click",
            toggleCamera
        );


    document
        .getElementById("saveBtn")
        .addEventListener(
            "click",
            saveFile
        );


    document
        .getElementById("backBtn")
        .addEventListener(
            "click",
            goBack
        );


    document
        .getElementById("refreshBtn")
        .addEventListener(
            "click",
            async () => {

                await loadPairs();

                updateUI();

            }
        );
}


/* =========================================================
   LOAD FILE
========================================================= */

async function loadFile() {

    const {
        data,
        error
    } = await supabaseClient
        .from("scan_files")
        .select("*")
        .eq(
            "id",
            Number(fileId)
        )
        .single();


    if (error) {

        console.error(error);

        alert(
            "Không thể tải file."
        );

        window.location.href =
            "dashboard.html";

        return;
    }


    fileData = data;


    document.getElementById(
        "fileTitle"
    ).textContent =
        fileData.file_name;


    const status =
        document.getElementById(
            "fileStatus"
        );


    status.textContent =
        fileData.status;


    status.className =
        "status " +
        (
            fileData.status === "SAVED"
                ? "saved"
                : "draft"
        );
}


/* =========================================================
   LOAD PAIRS
========================================================= */

async function loadPairs() {

    const {
        data,
        error
    } = await supabaseClient
        .from("scan_pairs")
        .select("*")
        .eq(
            "file_id",
            Number(fileId)
        )
        .order(
            "sequence",
            {
                ascending: true
            }
        );


    if (error) {

        console.error(error);

        alert(
            "Không thể tải danh sách scan."
        );

        return;
    }


    pairs =
        data || [];


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

    if (
        typeof ZXing ===
        "undefined"
    ) {

        alert(
            "Không tải được QR Scanner."
        );

        return;
    }


    try {

        // Bật AudioContext sau thao tác người dùng
        initAudio();


        codeReader =
            new ZXing.BrowserQRCodeReader();


        const devices =
            await codeReader
                .listVideoInputDevices();


        if (!devices.length) {

            throw new Error(
                "Không tìm thấy camera."
            );
        }


        let selectedDevice =
            devices[0];


        // Ưu tiên camera sau
        const rearCamera =
            devices.find(
                device => {

                    const label =
                        (
                            device.label ||
                            ""
                        ).toLowerCase();


                    return (
                        label.includes("back") ||
                        label.includes("rear") ||
                        label.includes("environment") ||
                        label.includes("sau")
                    );
                }
            );


        if (rearCamera) {

            selectedDevice =
                rearCamera;
        }


        scanning = true;

        scanBusy = false;


        const button =
            document.getElementById(
                "cameraBtn"
            );


        button.textContent =
            "⏹ TẮT CAMERA";


        button.classList.add(
            "danger-camera"
        );


        setMessage(
            "Đưa QR vào khung quét...",
            "normal"
        );


        await codeReader.decodeFromVideoDevice(

            selectedDevice.deviceId,

            videoElement,

            (
                result,
                error
            ) => {

                if (result) {

                    handleQRCode(
                        result.getText()
                    );
                }

            }

        );

    }
    catch (error) {

        console.error(error);

        scanning = false;

        setMessage(
            error.message ||
            "Không thể bật camera.",
            "error"
        );
    }
}


/* =========================================================
   STOP CAMERA
========================================================= */

function stopCamera() {

    scanning = false;

    scanBusy = false;


    if (codeReader) {

        try {

            codeReader.reset();

        }
        catch (error) {

            console.error(error);

        }

    }


    if (
        videoElement &&
        videoElement.srcObject
    ) {

        const tracks =
            videoElement
                .srcObject
                .getTracks();


        tracks.forEach(
            track =>
                track.stop()
        );


        videoElement.srcObject =
            null;
    }


    const button =
        document.getElementById(
            "cameraBtn"
        );


    button.textContent =
        "📷 BẬT CAMERA";


    button.classList.remove(
        "danger-camera"
    );


    setMessage(
        "Camera đã tắt.",
        "normal"
    );
}


/* =========================================================
   QR RESULT
========================================================= */

async function handleQRCode(rawCode) {

    const code =
        String(rawCode || "")
            .trim();


    if (!code) {
        return;
    }


    /*
     * CAMERA CÓ THỂ ĐỌC CÙNG 1 QR
     * TRONG NHIỀU FRAME LIÊN TIẾP.
     *
     * scanBusy giúp khóa hoàn toàn
     * trong lúc đang xử lý QR.
     */

    if (scanBusy) {
        return;
    }


    const now =
        Date.now();


    if (
        code === lastScannedCode &&
        now - lastScanTime <
            SCAN_COOLDOWN
    ) {

        return;
    }


    scanBusy = true;


    lastScannedCode =
        code;


    lastScanTime =
        now;


    try {

        if (
            scanningType === "OLD"
        ) {

            await handleOld(
                code
            );

        }
        else {

            await handleNew(
                code
            );
        }

    }
    catch (error) {

        console.error(error);

    }
    finally {

        /*
         * Cho camera nghỉ 1 giây.
         * Điều này giúp người dùng có thời gian
         * đưa tem tiếp theo vào camera.
         */

        setTimeout(
            () => {

                scanBusy = false;

            },
            SCAN_COOLDOWN
        );
    }
}


/* =========================================================
   OLD
========================================================= */

async function handleOld(code) {

    const condition =
        (
            fileData.old_condition ||
            ""
        ).trim();


    /*
     * KIỂM TRA ĐIỀU KIỆN OLD
     */

    if (
        condition &&
        !code.includes(condition)
    ) {

        playFailSound();


        setMessage(
            `❌ OLD không hợp lệ.\nQR phải chứa: ${condition}`,
            "error"
        );


        return;
    }


    /*
     * KHÔNG CHO QR ĐÃ TỪNG XUẤT HIỆN
     */

    if (
        isDuplicateCode(code)
    ) {

        playFailSound();


        setMessage(
            "❌ QR này đã được quét trước đó.",
            "error"
        );


        return;
    }


    /*
     * LƯU OLD
     */

    currentOld =
        code;


    scanningType =
        "NEW";


    playPassSound();


    setMessage(
        `✓ OLD OK\n${code}\n\n→ Bây giờ quét NEW`,
        "success"
    );


    updateUI();
}


/* =========================================================
   NEW
========================================================= */

async function handleNew(code) {

    if (!currentOld) {

        scanningType =
            "OLD";


        updateUI();


        return;
    }


    /*
     * QUAN TRỌNG:
     * OLD VÀ NEW KHÔNG ĐƯỢC TRÙNG NHAU
     */

    if (
        code === currentOld
    ) {

        playFailSound();


        setMessage(
            "❌ OLD và NEW không được trùng nhau.\n\nHãy quét NEW khác.",
            "error"
        );


        return;
    }


    /*
     * KIỂM TRA ĐIỀU KIỆN NEW
     */

    const condition =
        (
            fileData.new_condition ||
            ""
        ).trim();


    if (
        condition &&
        !code.includes(condition)
    ) {

        playFailSound();


        setMessage(
            `❌ NEW không hợp lệ.\nQR phải chứa: ${condition}`,
            "error"
        );


        return;
    }


    /*
     * KHÔNG CHO QR ĐÃ TỪNG XUẤT HIỆN
     */

    if (
        isDuplicateCode(code)
    ) {

        playFailSound();


        setMessage(
            "❌ QR này đã được quét trước đó.",
            "error"
        );


        return;
    }


    /*
     * SEQUENCE
     */

    const nextSequence =
        pairs.length + 1;


    try {

        const {
            data,
            error
        } = await supabaseClient
            .from("scan_pairs")
            .insert({

                file_id:
                    Number(fileId),

                sequence:
                    nextSequence,

                old_box:
                    currentOld,

                new_box:
                    code

            })
            .select()
            .single();


        if (error) {

            /*
             * DATABASE DUPLICATE
             */

            if (
                error.code ===
                "23505"
            ) {

                playFailSound();


                setMessage(
                    "❌ QR bị trùng trong database.",
                    "error"
                );


                return;
            }


            throw error;
        }


        /*
         * THÊM VÀO DANH SÁCH
         */

        pairs.push(data);


        /*
         * PASS
         */

        playPassSound();


        setMessage(
            `✓ PASS\n\nOLD: ${currentOld}\nNEW: ${code}`,
            "success"
        );


        /*
         * RESET VỀ OLD
         */

        currentOld =
            null;


        scanningType =
            "OLD";


        updateUI();

    }
    catch (error) {

        console.error(error);


        playFailSound();


        setMessage(
            "❌ Lưu cặp thất bại:\n" +
            error.message,
            "error"
        );
    }
}


/* =========================================================
   DUPLICATE
========================================================= */

function isDuplicateCode(code) {

    return pairs.some(
        pair =>
            pair.old_box === code ||
            pair.new_box === code
    );
}


/* =========================================================
   DELETE PAIR
========================================================= */

async function deletePair(id) {

    const ok =
        confirm(
            "Xóa cặp này?"
        );


    if (!ok) {

        return;
    }


    try {

        const {
            error
        } = await supabaseClient
            .from("scan_pairs")
            .delete()
            .eq(
                "id",
                id
            );


        if (error) {

            throw error;
        }


        await renumberPairs();

        await loadPairs();

        updateUI();

    }
    catch (error) {

        console.error(error);


        alert(
            "Xóa thất bại:\n" +
            error.message
        );
    }
}


/* =========================================================
   RENUMBER
========================================================= */

async function renumberPairs() {

    const sorted =
        [...pairs]
            .sort(
                (a, b) =>
                    a.sequence -
                    b.sequence
            );


    for (
        let i = 0;
        i < sorted.length;
        i++
    ) {

        const item =
            sorted[i];


        const newSequence =
            i + 1;


        if (
            item.sequence ===
            newSequence
        ) {

            continue;
        }


        const {
            error
        } = await supabaseClient
            .from("scan_pairs")
            .update({
                sequence:
                    newSequence
            })
            .eq(
                "id",
                item.id
            );


        if (error) {

            throw error;
        }
    }
}


/* =========================================================
   SAVE
========================================================= */

async function saveFile() {

    if (currentOld) {

        alert(
            "Đang có OLD chưa ghép NEW.\n\nHãy quét NEW trước khi SAVE."
        );


        return;
    }


    if (!pairs.length) {

        alert(
            "Chưa có cặp nào."
        );


        return;
    }


    const ok =
        confirm(
            `SAVE file "${fileData.file_name}" với ${pairs.length} cặp?`
        );


    if (!ok) {

        return;
    }


    try {

        const now =
            new Date()
                .toISOString();


        const {
            error
        } = await supabaseClient
            .from("scan_files")
            .update({

                status:
                    "SAVED",

                updated_at:
                    now,

                saved_at:
                    now

            })
            .eq(
                "id",
                Number(fileId)
            );


        if (error) {

            throw error;
        }


        fileData.status =
            "SAVED";


        document.getElementById(
            "fileStatus"
        ).textContent =
            "SAVED";


        document.getElementById(
            "fileStatus"
        ).className =
            "status saved";


        playPassSound();


        setMessage(
            "✓ ĐÃ SAVE FILE",
            "success"
        );

    }
    catch (error) {

        console.error(error);


        playFailSound();


        alert(
            "SAVE thất bại:\n" +
            error.message
        );
    }
}


/* =========================================================
   UI
========================================================= */

function updateUI() {

    document.getElementById(
        "pairTitle"
    ).textContent =
        `CẶP #${pairs.length + 1}`;


    const mode =
        document.getElementById(
            "scanMode"
        );


    if (
        scanningType === "OLD"
    ) {

        mode.textContent =
            "🔵 QUÉT TEM CŨ";


        mode.className =
            "scan-mode old-mode";

    }
    else {

        mode.textContent =
            "🟢 QUÉT TEM MỚI";


        mode.className =
            "scan-mode new-mode";
    }


    const condition =
        document.getElementById(
            "conditionText"
        );


    if (
        scanningType === "OLD"
    ) {

        const value =
            fileData?.old_condition ||
            "";


        condition.textContent =
            value
                ? `Điều kiện OLD: ${value}`
                : "OLD: Không giới hạn";

    }
    else {

        const value =
            fileData?.new_condition ||
            "";


        condition.textContent =
            value
                ? `Điều kiện NEW: ${value}`
                : "NEW: Không giới hạn";
    }


    document.getElementById(
        "pairCount"
    ).textContent =
        pairs.length;


    document.getElementById(
        "oldCount"
    ).textContent =
        pairs.length +
        (
            currentOld
                ? 1
                : 0
        );


    document.getElementById(
        "newCount"
    ).textContent =
        pairs.length;


    renderPairs();
}


/* =========================================================
   RENDER PAIRS
========================================================= */

function renderPairs() {

    const tbody =
        document.getElementById(
            "pairTable"
        );


    if (!pairs.length) {

        tbody.innerHTML = `

            <tr>

                <td
                    colspan="4"
                    class="no-data"
                >
                    Chưa có dữ liệu
                </td>

            </tr>

        `;


        return;
    }


    tbody.innerHTML =
        pairs
            .map(
                pair => `

                <tr>

                    <td>
                        ${pair.sequence}
                    </td>

                    <td class="qr-cell">
                        ${escapeHtml(
                            pair.old_box
                        )}
                    </td>

                    <td class="qr-cell">
                        ${escapeHtml(
                            pair.new_box
                        )}
                    </td>

                    <td>

                        <button
                            class="delete-row-btn"
                            onclick="deletePair(${pair.id})"
                            title="Xóa"
                        >
                            🗑
                        </button>

                    </td>

                </tr>

            `
            )
            .join("");
}


/* =========================================================
   AUDIO
========================================================= */

function initAudio() {

    try {

        if (!audioContext) {

            const AudioCtx =
                window.AudioContext ||
                window.webkitAudioContext;


            if (AudioCtx) {

                audioContext =
                    new AudioCtx();
            }
        }


        if (
            audioContext &&
            audioContext.state ===
                "suspended"
        ) {

            audioContext.resume();
        }

    }
    catch (error) {

        console.warn(
            "Không khởi tạo được âm thanh:",
            error
        );
    }
}


function playTone(
    frequency,
    duration,
    type = "sine",
    volume = 0.08
) {

    try {

        initAudio();


        if (!audioContext) {
            return;
        }


        const oscillator =
            audioContext.createOscillator();


        const gain =
            audioContext.createGain();


        oscillator.type =
            type;


        oscillator.frequency.value =
            frequency;


        gain.gain.setValueAtTime(
            0.0001,
            audioContext.currentTime
        );


        gain.gain.exponentialRampToValueAtTime(
            volume,
            audioContext.currentTime +
            0.01
        );


        gain.gain.exponentialRampToValueAtTime(
            0.0001,
            audioContext.currentTime +
            duration
        );


        oscillator.connect(gain);

        gain.connect(
            audioContext.destination
        );


        oscillator.start();


        oscillator.stop(
            audioContext.currentTime +
            duration +
            0.03
        );

    }
    catch (error) {

        console.warn(
            "Không phát được âm thanh:",
            error
        );
    }
}


/*
 * PASS:
 * 2 tiếng "beep beep"
 */

function playPassSound() {

    playTone(
        880,
        0.10,
        "sine",
        0.10
    );


    setTimeout(
        () => {

            playTone(
                1320,
                0.14,
                "sine",
                0.10
            );

        },
        110
    );
}


/*
 * FAIL:
 * 2 tiếng cảnh báo thấp
 */

function playFailSound() {

    playTone(
        220,
        0.20,
        "square",
        0.08
    );


    setTimeout(
        () => {

            playTone(
                160,
                0.22,
                "square",
                0.08
            );

        },
        180
    );
}


/* =========================================================
   MESSAGE
========================================================= */

function setMessage(
    text,
    type = "normal"
) {

    const element =
        document.getElementById(
            "scanMessage"
        );


    element.textContent =
        text;


    element.className =
        "scan-message " +
        type;
}


/* =========================================================
   BACK
========================================================= */

function goBack() {

    if (currentOld) {

        const ok =
            confirm(
                "Đang có OLD chưa ghép NEW.\n\nBạn có chắc muốn thoát?"
            );


        if (!ok) {

            return;
        }
    }


    stopCamera();


    window.location.href =
        "dashboard.html";
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {

    return String(value ?? "")
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}
