"use strict";


let files = [];


document.addEventListener(
    "DOMContentLoaded",
    initDashboard
);


async function initDashboard() {

    checkLogin();

    setupEvents();

    await loadFiles();
}


/* =========================================
   LOGIN
========================================= */

function checkLogin() {

    const logged =
        sessionStorage.getItem(
            "admin_logged_in"
        );

    if (logged !== "true") {

        window.location.href =
            "index.html";

        return;
    }


    const username =
        sessionStorage.getItem(
            "admin_username"
        ) || "admin";


    document.getElementById(
        "usernameDisplay"
    ).textContent = username;
}


/* =========================================
   EVENTS
========================================= */

function setupEvents() {

    document
        .getElementById("createFileBtn")
        .addEventListener(
            "click",
            openCreateModal
        );


    document
        .getElementById("closeModalBtn")
        .addEventListener(
            "click",
            closeCreateModal
        );


    document
        .getElementById("cancelCreateBtn")
        .addEventListener(
            "click",
            closeCreateModal
        );


    document
        .getElementById("confirmCreateBtn")
        .addEventListener(
            "click",
            createFile
        );


    document
        .getElementById("logoutBtn")
        .addEventListener(
            "click",
            logout
        );
}


/* =========================================
   LOAD FILES
========================================= */

async function loadFiles() {

    const fileList =
        document.getElementById(
            "fileList"
        );

    fileList.innerHTML =
        `<div class="loading">Đang tải...</div>`;


    try {

        const {
            data,
            error
        } = await supabaseClient
            .from("scan_files")
            .select("*")
            .order(
                "updated_at",
                {
                    ascending: false
                }
            );


        if (error) {

            throw error;
        }


        files = data || [];


        const counts =
            await loadPairCounts(files);


        renderFiles(counts);

    }
    catch (error) {

        console.error(error);

        fileList.innerHTML = `
            <div class="error-box">
                Không thể tải dữ liệu.
                <br>
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}


/* =========================================
   PAIR COUNTS
========================================= */

async function loadPairCounts(fileData) {

    const result = {};


    if (!fileData.length) {

        return result;
    }


    const ids =
        fileData.map(
            item => item.id
        );


    const {
        data,
        error
    } = await supabaseClient
        .from("scan_pairs")
        .select("file_id")
        .in("file_id", ids);


    if (error) {

        console.error(error);

        return result;
    }


    for (const row of data || []) {

        result[row.file_id] =
            (result[row.file_id] || 0) + 1;
    }


    return result;
}


/* =========================================
   RENDER
========================================= */

function renderFiles(counts) {

    const fileList =
        document.getElementById(
            "fileList"
        );

    const empty =
        document.getElementById(
            "emptyState"
        );


    if (!files.length) {

        fileList.innerHTML = "";

        empty.classList.remove(
            "hidden"
        );

        return;
    }


    empty.classList.add(
        "hidden"
    );


    fileList.innerHTML =
        files
            .map(file => {

                const count =
                    counts[file.id] || 0;


                const statusClass =
                    file.status === "SAVED"
                        ? "saved"
                        : "draft";


                const statusText =
                    file.status === "SAVED"
                        ? "ĐÃ SAVE"
                        : "DRAFT";


                return `

                <div class="file-card">

                    <div class="file-card-top">

                        <div class="file-icon">
                            📦
                        </div>

                        <span class="status ${statusClass}">
                            ${statusText}
                        </span>

                    </div>


                    <h3>
                        ${escapeHtml(file.file_name)}
                    </h3>


                    <div class="file-info">

                        <div>
                            <span>OLD:</span>
                            ${escapeHtml(
                                file.old_condition || "Không giới hạn"
                            )}
                        </div>

                        <div>
                            <span>NEW:</span>
                            ${escapeHtml(
                                file.new_condition || "Không giới hạn"
                            )}
                        </div>

                        <div>
                            <span>Số cặp:</span>
                            <strong>${count}</strong>
                        </div>

                    </div>


                    <div class="file-actions">

                        <button
                            class="primary-btn small"
                            onclick="openFile(${file.id})"
                        >
                            ${file.status === "DRAFT"
                                ? "TIẾP TỤC"
                                : "MỞ"}
                        </button>


                        <button
                            class="secondary-btn small"
                            onclick="exportExcel(${file.id})"
                        >
                            XLSX
                        </button>


                        <button
                            class="danger-btn small"
                            onclick="deleteFile(${file.id})"
                        >
                            XÓA
                        </button>

                    </div>

                </div>

                `;
            })
            .join("");
}


/* =========================================
   CREATE MODAL
========================================= */

function openCreateModal() {

    document
        .getElementById("createModal")
        .classList.remove("hidden");


    document
        .getElementById("fileName")
        .focus();
}


function closeCreateModal() {

    document
        .getElementById("createModal")
        .classList.add("hidden");


    document
        .getElementById("fileName")
        .value = "";

    document
        .getElementById("oldCondition")
        .value = "";

    document
        .getElementById("newCondition")
        .value = "";

    document
        .getElementById("createMessage")
        .textContent = "";
}


/* =========================================
   CREATE FILE
========================================= */

async function createFile() {

    const fileName =
        document
            .getElementById("fileName")
            .value
            .trim();


    const oldCondition =
        document
            .getElementById("oldCondition")
            .value
            .trim();


    const newCondition =
        document
            .getElementById("newCondition")
            .value
            .trim();


    const message =
        document.getElementById(
            "createMessage"
        );


    if (!fileName) {

        message.textContent =
            "Phải nhập tên file.";

        return;
    }


    message.textContent =
        "Đang tạo...";


    try {

        const {
            data,
            error
        } = await supabaseClient
            .from("scan_files")
            .insert({

                file_name: fileName,

                old_condition:
                    oldCondition,

                new_condition:
                    newCondition,

                status: "DRAFT"

            })
            .select()
            .single();


        if (error) {

            throw error;
        }


        window.location.href =
            `scanner.html?id=${data.id}`;

    }
    catch (error) {

        console.error(error);

        message.textContent =
            error.message ||
            "Tạo file thất bại.";
    }
}


/* =========================================
   OPEN FILE
========================================= */

function openFile(id) {

    window.location.href =
        `scanner.html?id=${id}`;
}


/* =========================================
   DELETE FILE
========================================= */

async function deleteFile(id) {

    const file =
        files.find(
            item => item.id === id
        );


    if (!file) {

        return;
    }


    const ok =
        confirm(
            `Xóa file "${file.file_name}"?\n\nTất cả dữ liệu scan trong file cũng sẽ bị xóa.`
        );


    if (!ok) {

        return;
    }


    try {

        const {
            error
        } = await supabaseClient
            .from("scan_files")
            .delete()
            .eq("id", id);


        if (error) {

            throw error;
        }


        await loadFiles();

    }
    catch (error) {

        console.error(error);

        alert(
            "Xóa thất bại: " +
            error.message
        );
    }
}


/* =========================================
   EXPORT XLSX
========================================= */

async function exportExcel(id) {

    try {

        const {
            data: file,
            error: fileError
        } = await supabaseClient
            .from("scan_files")
            .select("file_name")
            .eq("id", id)
            .single();


        if (fileError) {

            throw fileError;
        }


        const {
            data,
            error
        } = await supabaseClient
            .from("scan_pairs")
            .select(
                "sequence, old_box, new_box"
            )
            .eq("file_id", id)
            .order(
                "sequence",
                {
                    ascending: true
                }
            );


        if (error) {

            throw error;
        }


        const rows =
            (data || []).map(item => ({

                oldBox:
                    item.old_box,

                newBox:
                    item.new_box

            }));


        const worksheet =
            XLSX.utils.json_to_sheet(
                rows,
                {
                    header: [
                        "oldBox",
                        "newBox"
                    ]
                }
            );


        worksheet["!cols"] = [
            {
                wch: 30
            },
            {
                wch: 30
            }
        ];


        const workbook =
            XLSX.utils.book_new();


        XLSX.utils.book_append_sheet(
            workbook,
            worksheet,
            "BOX"
        );


        const safeName =
            file.file_name
                .replace(
                    /[\\/:*?"<>|]/g,
                    "_"
                );


        XLSX.writeFile(
            workbook,
            `${safeName}.xlsx`
        );

    }
    catch (error) {

        console.error(error);

        alert(
            "Xuất Excel thất bại:\n" +
            error.message
        );
    }
}


/* =========================================
   LOGOUT
========================================= */

function logout() {

    sessionStorage.removeItem(
        "admin_logged_in"
    );

    sessionStorage.removeItem(
        "admin_username"
    );


    window.location.href =
        "index.html";
}


/* =========================================
   HTML ESCAPE
========================================= */

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