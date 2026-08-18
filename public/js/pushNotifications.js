(() => {
    "use strict";

    const CONFIG = {
        serviceWorker: "/sw.js",
        publicKeyEndpoint: "/push/public-key",
        subscribeEndpoint: "/push/subscribe",
        autoPromptDelay: 1200,
        dismissedKey: "blogify-push-prompt-dismissed"
    };

    const state = {
        registration: null,
        publicKey: null,
        initialized: false
    };

    function supported() {
        return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
        const rawData = window.atob(base64);
        return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
    }

    function isLoggedInResponse(response) {
        return response.status !== 401 && response.ok;
    }

    async function getPublicKey() {
        if (state.publicKey) return state.publicKey;
        const response = await fetch(CONFIG.publicKeyEndpoint, { credentials: "same-origin", headers: { Accept: "application/json" } });
        if (!isLoggedInResponse(response)) return null;
        const data = await response.json();
        if (!data.success || !data.publicKey) return null;
        state.publicKey = data.publicKey;
        return state.publicKey;
    }

    async function registerServiceWorker() {
        if (!supported()) return null;
        if (!state.registration) state.registration = await navigator.serviceWorker.register(CONFIG.serviceWorker, { scope: "/" });
        await navigator.serviceWorker.ready;
        return state.registration;
    }

    function showPermissionPrompt() {
        if (document.getElementById("blogify-push-permission-prompt")) return;

        const style = document.createElement("style");
        style.id = "blogify-push-permission-style";
        style.textContent = `
            #blogify-push-permission-prompt{position:fixed;left:18px;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:14px;padding:15px 16px;border:1px solid var(--border,#e2e8f0);border-radius:16px;background:var(--surface,#fff);color:var(--text,#1e293b);box-shadow:0 18px 55px rgba(0,0,0,.18);font-family:Inter,system-ui,sans-serif}
            #blogify-push-permission-prompt .push-icon{width:42px;height:42px;min-width:42px;border-radius:12px;display:grid;place-items:center;background:#6366f1;color:#fff;font-size:18px}
            #blogify-push-permission-prompt .push-copy{min-width:0;flex:1}.push-copy strong{display:block;font-size:15px;margin-bottom:3px}.push-copy span{display:block;font-size:12px;color:var(--muted,#64748b);line-height:1.4}
            #blogify-push-permission-prompt .push-actions{display:flex;gap:8px;flex-shrink:0}.push-actions button{border:0;border-radius:10px;padding:9px 13px;font-weight:700;cursor:pointer}.push-enable{background:#6366f1;color:#fff}.push-later{background:var(--soft,#f8fafc);color:var(--text,#1e293b);border:1px solid var(--border,#e2e8f0)!important}
            @media(max-width:600px){#blogify-push-permission-prompt{left:10px;right:10px;bottom:10px;align-items:flex-start;flex-wrap:wrap}.push-copy{flex-basis:calc(100% - 60px)}.push-actions{width:100%;padding-left:56px}.push-actions button{flex:1}}
        `;
        document.head.appendChild(style);

        const prompt = document.createElement("div");
        prompt.id = "blogify-push-permission-prompt";
        prompt.innerHTML = `
            <div class="push-icon"><i class="fas fa-bell"></i></div>
            <div class="push-copy"><strong>Stay updated on Blogify</strong><span>Get alerts for messages, comments, follows and other important activity.</span></div>
            <div class="push-actions"><button type="button" class="push-later">Not now</button><button type="button" class="push-enable">Enable notifications</button></div>
        `;
        document.body.appendChild(prompt);

        prompt.querySelector(".push-later").addEventListener("click", () => {
            try { sessionStorage.setItem(CONFIG.dismissedKey, "1"); } catch (_) {}
            prompt.remove();
        });
        prompt.querySelector(".push-enable").addEventListener("click", async () => {
            const button = prompt.querySelector(".push-enable");
            button.disabled = true;
            button.textContent = "Enabling...";
            try {
                const result = await enablePush();
                prompt.remove();
                if (!result && Notification.permission !== "denied") button.disabled = false;
            } catch (error) {
                console.error("Blogify push enable error:", error);
                button.disabled = false;
                button.textContent = "Enable notifications";
            }
        });
    }

    async function enablePush() {
        if (!supported()) return false;

        const permission = Notification.permission === "granted"
            ? "granted"
            : await Notification.requestPermission();

        if (permission !== "granted") return false;

        const registration = await registerServiceWorker();
        const publicKey = await getPublicKey();
        if (!registration || !publicKey) return false;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
        }

        const response = await fetch(CONFIG.subscribeEndpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                subscription: subscription.toJSON(),
                deviceName: `${navigator.platform || "Browser"} • ${navigator.userAgent.includes("Mobile") ? "Mobile" : "Web"}`
            })
        });

        if (!response.ok) throw new Error(`Push subscribe failed (${response.status})`);
        return true;
    }

    async function syncGrantedPermission() {
        if (!supported() || Notification.permission !== "granted") return false;
        try {
            return await enablePush();
        } catch (error) {
            console.error("Blogify push sync error:", error);
            return false;
        }
    }

    async function init() {
        if (state.initialized || !supported()) return;
        state.initialized = true;

        // Anonymous visitors cannot subscribe to a user-specific push endpoint.
        const publicKeyResponse = await fetch(CONFIG.publicKeyEndpoint, { credentials: "same-origin" }).catch(() => null);
        if (!publicKeyResponse || publicKeyResponse.status === 401) return;
        if (!publicKeyResponse.ok) return;

        if (Notification.permission === "granted") {
            await syncGrantedPermission();
            return;
        }

        // Do not repeatedly ask after an explicit denial. Browsers expose the denial
        // through Notification.permission and users can re-enable it in site settings.
        if (Notification.permission === "denied") return;

        let dismissed = false;
        try { dismissed = sessionStorage.getItem(CONFIG.dismissedKey) === "1"; } catch (_) {}
        if (dismissed) return;

        // Browsers increasingly require a user gesture for permission prompts.
        // We show our own in-page prompt on visit, then request browser permission
        // from the user's click on "Enable notifications".
        window.setTimeout(showPermissionPrompt, CONFIG.autoPromptDelay);
    }

    window.BlogifyPush = {
        enable: enablePush,
        init,
        supported: supported,
        permission: () => supported() ? Notification.permission : "unsupported"
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})();
