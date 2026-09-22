"use strict";


document.addEventListener("DOMContentLoaded", () => {

    const form =
        document.getElementById("loginForm");

    const message =
        document.getElementById("loginMessage");


    // Nếu đã đăng nhập
    if (
        sessionStorage.getItem("admin_logged_in") === "true"
    ) {

        window.location.href = "dashboard.html";

        return;
    }


    form.addEventListener("submit", async (event) => {

        event.preventDefault();


        const username =
            document
                .getElementById("username")
                .value
                .trim();

        const password =
            document
                .getElementById("password")
                .value;


        message.textContent =
            "Đang đăng nhập...";

        message.className =
            "login-message";


        try {

            const {
                data,
                error
            } = await supabaseClient
                .from("admins")
                .select("id, username")
                .eq("username", username)
                .eq("password_hash", password)
                .maybeSingle();


            if (error) {

                console.error(error);

                throw new Error(
                    "Không thể kết nối database."
                );
            }


            if (!data) {

                message.textContent =
                    "Sai username hoặc password.";

                message.className =
                    "login-message error";

                return;
            }


            sessionStorage.setItem(
                "admin_logged_in",
                "true"
            );


            sessionStorage.setItem(
                "admin_username",
                data.username
            );


            window.location.href =
                "dashboard.html";

        }
        catch (error) {

            console.error(error);

            message.textContent =
                error.message ||
                "Đăng nhập thất bại.";

            message.className =
                "login-message error";
        }

    });

});