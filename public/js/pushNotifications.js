(() => {
    "use strict";

    const CONFIG = {
        serviceWorker: "/sw.js",
        publicKeyEndpoint: "/push/public-key",
        subscribeEndpoint: "/push/subscribe",
        statusEndpoint: "/push/status",
        autoPromptDelay: 1200,
        dismissedKey: "blogify-push-prompt-dismissed"
    };

    const state = { registration: null, publicKey: null, initialized: false };

    function supported() {
        return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
        const rawData = window.atob(base64);
        return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
    }

    async function getPublicKey() {
        if (state.publicKey) return state.publicKey;
        const response = await fetch(CONFIG.publicKeyEndpoint, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        if (response.status === 401) return null;
        if (!response.ok) {
            let detail = `HTTP ${response.status}`;
            try { detail = (await response.json()).error || detail; } catch (_) {}
            throw new Error(`Push public-key request failed: ${detail}`);
        }
        const data = await response.json();
        if (!data.success || !data.publicKey) throw new Error("Push public key is missing");
        state.publicKey = data.publicKey;
        return state.publicKey;
    }

    async function registerServiceWorker() {
        if (!supported()) return null;
        if (!state.registration) {
            state.registration = await navigator.serviceWorker.register(CONFIG.serviceWorker, { scope: "/", updateViaCache: "none" });
        }
        await navigator.serviceWorker.ready;
        return state.registration;
    }

    async function saveSubscription(subscription) {
        const response = await fetch(CONFIG.subscribeEndpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            cache: "no-store",
            body: JSON.stringify({
                subscription: subscription.toJSON(),
                deviceName: `${navigator.platform || "Browser"} • ${navigator.userAgent.includes("Mobile") ? "Mobile" : "Web"}`
            })
        });
        if (!response.ok) {
            let detail = `HTTP ${response.status}`;
            try { detail = (await response.json()).error || detail; } catch (_) {}
            throw new Error(`Push subscribe failed: ${detail}`);
        }
        return response.json();
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
        prompt.innerHTML = `<div class="push-icon"><i class="fas fa-bell"></i></div><div class="push-copy"><strong>Stay updated on Blogify</strong><span>Get alerts for messages, comments, follows and other important activity.</span></div><div class="push-actions"><button type="button" class="push-later">Not now</button><button type="button" class="push-enable">Enable notifications</button></div>`;
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
                if (result) prompt.remove();
                else if (Notification.permission !== "denied") {
                    button.disabled = false;
                    button.textContent = "Enable notifications";
                }
            } catch (error) {
                console.error("Blogify push enable error:", error);
                button.disabled = false;
                button.textContent = "Try again";
            }
        });
    }

    async function enablePush() {
        if (!supported()) return false;
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (permission !== "granted") return false;

        const [registration, publicKey] = await Promise.all([registerServiceWorker(), getPublicKey()]);
        if (!registration || !publicKey) return false;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
        }
        await saveSubscription(subscription);
        return true;
    }

    async function syncGrantedPermission() {
        if (!supported() || Notification.permission !== "granted") return false;
        try { return await enablePush(); }
        catch (error) { console.error("Blogify push sync error:", error); return false; }
    }

    async function getStatus() {
        if (!supported()) return { supported: false, permission: "unsupported" };
        let server = null;
        try {
            const response = await fetch(CONFIG.statusEndpoint, { credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" });
            if (response.ok) server = await response.json();
        } catch (_) {}
        let subscription = null;
        try {
            const registration = await registerServiceWorker();
            subscription = registration ? await registration.pushManager.getSubscription() : null;
        } catch (_) {}
        return {
            supported: true,
            permission: Notification.permission,
            serviceWorker: Boolean(state.registration),
            browserSubscription: Boolean(subscription),
            server
        };
    }

    async function init() {
        if (state.initialized || !supported()) return;
        state.initialized = true;

        const publicKeyResponse = await fetch(CONFIG.publicKeyEndpoint, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
        if (!publicKeyResponse || publicKeyResponse.status === 401) return;
        if (!publicKeyResponse.ok) {
            console.warn("Blogify push initialization unavailable:", publicKeyResponse.status);
            return;
        }

        if (Notification.permission === "granted") {
            await syncGrantedPermission();
            return;
        }
        if (Notification.permission === "denied") return;

        let dismissed = false;
        try { dismissed = sessionStorage.getItem(CONFIG.dismissedKey) === "1"; } catch (_) {}
        if (!dismissed) window.setTimeout(showPermissionPrompt, CONFIG.autoPromptDelay);
    }

    window.BlogifyPush = {
        enable: enablePush,
        init,
        status: getStatus,
        supported,
        permission: () => supported() ? Notification.permission : "unsupported"
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})();
