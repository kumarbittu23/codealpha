(() => {
  const cartKey = "corner-store-cart";

  function getCart() {
    try {
      const stored = JSON.parse(localStorage.getItem(cartKey) || "[]");
      if (!Array.isArray(stored)) return [];
      return stored.filter((item) => Number.isSafeInteger(item.id) && item.id > 0 && Number.isSafeInteger(item.quantity) && item.quantity > 0);
    } catch (error) {
      console.error("Could not read the shopping bag.", error);
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(cartKey, JSON.stringify(cart));
    updateCartCount();
    window.dispatchEvent(new Event("cartchange"));
  }

  function updateCartCount() {
    const count = getCart().reduce((sum, item) => sum + item.quantity, 0);
    document.querySelectorAll("#cart-count").forEach((element) => {
      element.textContent = String(count);
    });
  }

  function formatMoney(paise) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
  }

  async function getSession() {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error("Could not load your session.");
    return response.json();
  }

  async function apiRequest(url, options = {}) {
    const method = options.method || "GET";
    const headers = { ...(options.headers || {}) };
    if (options.body) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") {
      const sessionData = await getSession();
      headers["X-CSRF-Token"] = sessionData.csrfToken;
    }
    const response = await fetch(url, { ...options, headers });
    if (response.status === 204) return null;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
    return body;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function showNotice(element, message, kind = "error") {
    element.textContent = message;
    element.classList.remove("hidden", "notice-error", "notice-success");
    element.classList.add(kind === "success" ? "notice-success" : "notice-error");
  }

  async function updateAccountLink() {
    const link = document.getElementById("account-link");
    if (!link) return;
    try {
      const { user } = await getSession();
      if (user) link.textContent = "Hi, " + user.name.split(" ")[0];
    } catch (error) {
      console.error(error);
    }
  }

  window.Store = { getCart, saveCart, updateCartCount, formatMoney, getSession, apiRequest, escapeHtml, showNotice };
  updateCartCount();
  updateAccountLink();
})();
