(() => {
  const accountView = document.getElementById("account-view");
  const notice = document.getElementById("account-notice");
  const next = new URLSearchParams(window.location.search).get("next");
  let accountAddresses = [];
  let wishlistProducts = [];
  let accountOrders = [];
  let signedInUser = null;

  function renderAuth(mode = "login") {
    const registering = mode === "register";
    accountView.innerHTML = `
      <section class="account-card">
        <p class="eyebrow">${registering ? "Make yourself at home" : "Welcome back"}</p>
        <h1>${registering ? "Create your account" : "Sign in"}<span>.</span></h1>
        <p class="account-intro">${registering ? "A little account makes checking out a little easier." : "Sign in to check out and see your orders."}</p>
        <form id="auth-form" class="checkout-form">
          ${registering ? '<label>Your name<input name="name" autocomplete="name" minlength="2" maxlength="80" required></label>' : ""}
          <label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
          <label>Password<input name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="${registering ? "8" : "1"}" maxlength="128" required>${registering ? '<span class="field-hint">At least 8 characters.</span>' : ""}</label>
          <button class="button button-dark full-button" type="submit">${registering ? "Create account" : "Sign in"} <span aria-hidden="true">↗</span></button>
        </form>
        <p class="switch-auth">${registering ? "Already have an account?" : "New around here?"} <button class="text-button" id="switch-auth" type="button">${registering ? "Sign in" : "Create an account"}</button></p>
      </section>`;
    document.getElementById("switch-auth").addEventListener("click", () => renderAuth(registering ? "login" : "register"));
  }

  async function renderAccount(user) {
    signedInUser = user;
    accountView.innerHTML = `
      <section class="account-welcome"><div><p class="eyebrow">Your corner of the shop</p><h1>Hello, ${Store.escapeHtml(user.name.split(" ")[0])}<span>.</span></h1><p class="account-intro">${Store.escapeHtml(user.email)}</p></div>
      <button class="text-button" id="sign-out" type="button">Sign out ↗</button></section>
      <nav class="account-shortcuts" aria-label="Account sections">
        <a href="#orders">Orders</a><a href="#wallet-rewards">Wallet &amp; rewards</a><a href="#saved-addresses-section">Addresses</a>
        <a href="#account-settings">Settings</a><a href="#account-help">Help</a>
      </nav>
      <section class="order-history account-panel" id="orders"><h2>Your orders</h2>
        <div class="order-filters"><label>Search orders<input id="order-search" type="search" placeholder="Order number or product"></label>
        <label>Status<select id="order-status-filter"><option value="all">All orders</option><option value="active">In progress</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select></label></div>
        <div id="orders-list"><p class="loading-message">Checking in on your orders…</p></div></section>
      <section class="order-history account-panel" id="wallet-rewards"><h2>Wallet &amp; rewards</h2><div id="rewards-panel"><p class="loading-message">Loading rewards…</p></div></section>
      <section class="order-history account-panel" id="saved-addresses-section"><h2>Saved addresses</h2><div id="saved-addresses"></div>
        <form class="address-form" id="address-form">
          <label>Recipient name<input name="recipientName" autocomplete="name" minlength="2" maxlength="100" required></label>
          <label>Mobile number<input name="phone" type="tel" inputmode="numeric" pattern="[6-9][0-9]{9}" maxlength="10" placeholder="10-digit Indian number" required></label>
          <label>Address line 1<input name="line1" autocomplete="address-line1" minlength="3" maxlength="150" required></label>
          <label>Address line 2<input name="line2" autocomplete="address-line2" maxlength="150"></label>
          <label>City<input name="city" autocomplete="address-level2" minlength="2" maxlength="80" required></label>
          <label>State<input name="state" autocomplete="address-level1" minlength="2" maxlength="80" required></label>
          <label>PIN code<input name="postalCode" inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength="6" autocomplete="postal-code" required></label>
          <button class="button button-dark" type="submit">Save address</button>
        </form>
      </section>
      <section class="order-history account-panel" id="account-settings"><h2>Account settings</h2>
        <form class="address-form account-settings-form" id="profile-form">
          <label>Your name<input name="name" autocomplete="name" minlength="2" maxlength="80" value="${Store.escapeHtml(user.name)}" required></label>
          <label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" value="${Store.escapeHtml(user.email)}" required></label>
          <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" maxlength="128"></label>
          <label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128"></label>
          <p class="field-hint">Current password is required only when changing your email or password.</p>
          <button class="button button-dark" type="submit">Save account settings</button>
        </form>
      </section>
      <section class="order-history account-panel" id="account-help"><h2>Help &amp; support</h2>
        <div class="account-help-list">
          <article><h3>Where is my order?</h3><p>Check each seller shipment’s status and courier tracking in Your orders. Orders with products from multiple sellers may arrive in separate packages.</p></article>
          <article><h3>Can I cancel?</h3><p>Eligible cash-on-delivery orders can be cancelled before processing. For paid orders or orders already being processed, contact the store administrator before taking further action.</p></article>
          <article><h3>Need help with a return?</h3><p>After delivery, request a return from the order card. The store reviews the request; any refund is handled by the store outside this demo.</p></article>
          <article><h3>Account or payment issue?</h3><p>Keep your order number and contact the store administrator. Never share your password, card PIN, or one-time password.</p></article>
        </div>
      </section>
      <section class="order-history account-panel"><h2>Your wishlist</h2><div id="wishlist-list"><p class="loading-message">Loading saved finds…</p></div></section>
      <p class="seller-account-link">Have products to sell? <a class="text-button" href="/seller.html">Apply to become a seller ↗</a></p>`;
    document.getElementById("sign-out").addEventListener("click", async () => {
      try {
        await Store.apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
        renderAuth();
      } catch (error) {
        Store.showNotice(notice, error.message);
      }
    });
    try {
      const [orders, addresses, wishlist, rewards] = await Promise.all([
        Store.apiRequest("/api/orders"),
        Store.apiRequest("/api/account/addresses"),
        Store.apiRequest("/api/wishlist"),
        Store.apiRequest("/api/account/rewards")
      ]);
      accountOrders = orders;
      accountAddresses = addresses;
      wishlistProducts = wishlist;
      renderOrderList();
      renderRewards(rewards);
      renderAddresses();
      renderWishlist();
      document.getElementById("order-search").addEventListener("input", renderOrderList);
      document.getElementById("order-status-filter").addEventListener("change", renderOrderList);
    } catch (error) {
      Store.showNotice(notice, error.message);
    }

    function renderOrderList() {
      const container = document.getElementById("orders-list");
      if (!container) return;
      const query = document.getElementById("order-search")?.value.trim().toLowerCase() || "";
      const statusFilter = document.getElementById("order-status-filter")?.value || "all";
      const filtered = accountOrders.filter((order) => {
        const matchesStatus = statusFilter === "all" || statusFilter === "active" && !["cancelled", "delivered"].includes(order.status)
          || order.status === statusFilter;
        const matchesQuery = !query || String(order.id).includes(query)
          || order.items.some((item) => item.productName.toLowerCase().includes(query));
        return matchesStatus && matchesQuery;
      });
      if (filtered.length === 0) {
        container.innerHTML = accountOrders.length
          ? '<p class="no-orders">No orders match those filters.</p>'
          : '<div class="no-orders"><p>No orders just yet. The good stuff is waiting.</p><a class="text-button" href="/">Explore the collection ↗</a></div>';
        return;
      }
      container.innerHTML = filtered.map((order) => `
        <article class="order-card"><div class="order-heading"><div><p class="product-category">Order #${order.id}</p><strong>${new Date(order.createdAt + " UTC").toLocaleDateString(undefined, { dateStyle: "medium" })}</strong></div><span class="order-status">${Store.escapeHtml(order.status)}</span></div>
          <ul>${order.items.map((item) => `<li>${Store.escapeHtml(item.productName)} <span>× ${item.quantity}</span></li>`).join("")}</ul>
          <div class="order-footer"><span>Delivering to ${Store.escapeHtml(order.shippingName)} · ${Store.escapeHtml(order.paymentMethod === "razorpay" ? "Online payment" : "Cash on delivery")} (${Store.escapeHtml(order.paymentStatus)})${order.trackingCode ? `<br>Tracking: ${Store.escapeHtml(order.trackingCarrier || "Carrier")} · ${Store.escapeHtml(order.trackingCode)}` : ""}</span><strong>${Store.formatMoney(order.totalPaise)}</strong></div>
          ${order.shipments?.length ? `<div class="order-shipments"><strong>Seller shipments</strong>${order.shipments.map((shipment) => `<p><span>${Store.escapeHtml(shipment.sellerName)} · ${Store.escapeHtml(shipment.status)}</span>${shipment.trackingCode ? `<small>${Store.escapeHtml(shipment.trackingCarrier || "Carrier")} · ${Store.escapeHtml(shipment.trackingCode)}</small>` : ""}</p>`).join("")}</div>` : ""}
          ${order.returnStatus ? `<p class="admin-payment-info">Return request: ${Store.escapeHtml(order.returnStatus)}${order.returnReason ? ` · ${Store.escapeHtml(order.returnReason)}` : ""}</p>` : ""}
          <div class="order-actions">${order.status === "placed" && order.paymentMethod === "cash_on_delivery" ? `<button class="text-button admin-delete" type="button" data-cancel-order="${order.id}">Cancel order</button>` : ""}
          ${order.status === "delivered" && !order.returnStatus ? `<button class="text-button" type="button" data-return-order="${order.id}">Request a return</button>` : ""}
          <button class="text-button" type="button" data-buy-again="${order.id}">Buy again</button></div>
        </article>`).join("");
    }

    function renderRewards(rewards) {
      const container = document.getElementById("rewards-panel");
      if (!container) return;
      container.innerHTML = `<div class="account-rewards-grid">
        <article><span>Rewards points</span><strong>${rewards.points}</strong><small>1 point per ₹100 on delivered orders</small></article>
        <article><span>Wallet balance</span><strong>${Store.formatMoney(rewards.walletBalancePaise)}</strong><small>Wallet payments and cash-out are not enabled in this demo.</small></article>
        <article><span>Qualifying orders</span><strong>${rewards.deliveredOrderCount}</strong><small>Delivered orders, excluding completed refunds</small></article>
      </div><p class="account-intro">Points are a demo loyalty counter and have no cash value. They cannot be redeemed or transferred.</p>`;
    }
  }

  function renderAddresses() {
    const container = document.getElementById("saved-addresses");
    if (!container) return;
    container.innerHTML = accountAddresses.length ? `<div class="saved-address-list">${accountAddresses.map((address) => `
      <article class="saved-address-card"><div><strong>${Store.escapeHtml(address.recipientName)} ${address.isDefault ? '<span class="default-address-label">Default</span>' : ""}</strong>
      <p>${Store.escapeHtml(address.line1)}${address.line2 ? `, ${Store.escapeHtml(address.line2)}` : ""}<br>${Store.escapeHtml(address.city)}, ${Store.escapeHtml(address.state)} ${Store.escapeHtml(address.postalCode)}<br>+91 ${Store.escapeHtml(address.phone)}</p></div>
      <button class="text-button admin-delete" type="button" data-address-delete="${address.id}">Remove</button></article>`).join("")}</div>` : '<p class="empty-admin">You have not saved an address.</p>';
  }

  function renderWishlist() {
    const container = document.getElementById("wishlist-list");
    if (!container) return;
    container.innerHTML = wishlistProducts.length ? `<div class="wishlist-grid">${wishlistProducts.map((product) => `
      <article class="wishlist-card"><a href="/product.html?id=${product.id}"><img src="${Store.escapeHtml(product.imageUrl)}" alt="${Store.escapeHtml(product.name)}"><strong>${Store.escapeHtml(product.name)}</strong></a>
      <span>${Store.formatMoney(product.pricePaise)}</span><button class="text-button" type="button" data-wishlist-remove="${product.id}">Remove</button></article>`).join("")}</div>` : '<p class="empty-admin">Your saved products will appear here.</p>';
  }

  async function start() {
    try {
      const session = await Store.getSession();
      if (session.user) await renderAccount(session.user);
      else renderAuth("login");
    } catch (error) {
      Store.showNotice(notice, error.message);
    }
  }

  accountView.addEventListener("submit", async (event) => {
    if (event.target.id !== "auth-form") return;
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button[type=submit]");
    const registering = Boolean(form.elements.name);
    button.disabled = true;
    button.textContent = registering ? "Creating account…" : "Signing in…";
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      const result = await Store.apiRequest(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (next === "cart") window.location.href = "/cart.html";
      else if (next === "seller") window.location.href = "/seller.html";
      else await renderAccount(result.user);
    } catch (error) {
      Store.showNotice(notice, error.message);
      button.disabled = false;
      button.innerHTML = `${registering ? "Create account" : "Sign in"} <span aria-hidden="true">↗</span>`;
    }
  });

  accountView.addEventListener("submit", async (event) => {
    if (event.target.id === "profile-form") {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector("button[type=submit]");
      const data = new FormData(form);
      button.disabled = true;
      try {
        const result = await Store.apiRequest("/api/account/profile", {
          method: "PATCH",
          body: JSON.stringify(Object.fromEntries(data.entries()))
        });
        signedInUser = result.user;
        Store.showNotice(notice, "Account settings saved.", "success");
        await renderAccount(signedInUser);
      } catch (error) {
        Store.showNotice(notice, error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.id !== "address-form") return;
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await Store.apiRequest("/api/account/addresses", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      form.reset();
      accountAddresses = await Store.apiRequest("/api/account/addresses");
      renderAddresses();
      Store.showNotice(notice, "Address saved.", "success");
    } catch (error) {
      Store.showNotice(notice, error.message);
    } finally {
      button.disabled = false;
    }
  });

  accountView.addEventListener("click", async (event) => {
    const cancelButton = event.target.closest("[data-cancel-order]");
    const returnButton = event.target.closest("[data-return-order]");
    const buyAgainButton = event.target.closest("[data-buy-again]");
    if (buyAgainButton) {
      buyAgainButton.disabled = true;
      try {
        const order = accountOrders.find((item) => item.id === Number(buyAgainButton.dataset.buyAgain));
        const result = await Promise.all(order.items.map(async (item) => {
          try {
            const product = await Store.apiRequest(`/api/products/${item.productId}`);
            return { product, desired: item.quantity };
          } catch (error) {
            if (error.message === "Product not found.") return null;
            throw error;
          }
        }));
        const cart = Store.getCart();
        let added = 0;
        for (const entry of result) {
          if (!entry || entry.product.stock < 1) continue;
          const existing = cart.find((item) => item.id === entry.product.id);
          const quantity = Math.min(entry.desired, entry.product.stock, 20);
          if (existing) existing.quantity = Math.min(entry.product.stock, 20, existing.quantity + quantity);
          else cart.push({ id: entry.product.id, quantity });
          added += 1;
        }
        if (!added) {
          Store.showNotice(notice, "None of the products in this order are currently available.");
        } else {
          Store.saveCart(cart);
          Store.showNotice(notice, "Available items were added to your bag. Check current prices and quantities before checkout.", "success");
          window.location.href = "/cart.html";
        }
      } catch (error) {
        Store.showNotice(notice, error.message);
        buyAgainButton.disabled = false;
      }
      return;
    }
    if (cancelButton) {
      if (!window.confirm("Cancel this COD order? Items will be returned to stock.")) return;
      cancelButton.disabled = true;
      try {
        await Store.apiRequest(`/api/orders/${cancelButton.dataset.cancelOrder}/cancel`, {
          method: "POST", body: JSON.stringify({})
        });
        Store.showNotice(notice, "Order cancelled.", "success");
        await renderAccount(signedInUser);
      } catch (error) {
        Store.showNotice(notice, error.message);
        cancelButton.disabled = false;
      }
      return;
    }
    if (returnButton) {
      const reason = window.prompt("Tell us why you would like to return this order (at least 10 characters).");
      if (!reason) return;
      returnButton.disabled = true;
      try {
        await Store.apiRequest(`/api/orders/${returnButton.dataset.returnOrder}/returns`, {
          method: "POST", body: JSON.stringify({ reason })
        });
        Store.showNotice(notice, "Return request sent to the store for review.", "success");
        await renderAccount(signedInUser);
      } catch (error) {
        Store.showNotice(notice, error.message);
        returnButton.disabled = false;
      }
      return;
    }
    const addressButton = event.target.closest("[data-address-delete]");
    const wishlistButton = event.target.closest("[data-wishlist-remove]");
    const button = addressButton || wishlistButton;
    if (!button) return;
    button.disabled = true;
    try {
      if (addressButton) {
        await Store.apiRequest(`/api/account/addresses/${addressButton.dataset.addressDelete}`, { method: "DELETE" });
        accountAddresses = await Store.apiRequest("/api/account/addresses");
        renderAddresses();
      } else {
        await Store.apiRequest(`/api/wishlist/${wishlistButton.dataset.wishlistRemove}`, { method: "DELETE" });
        wishlistProducts = wishlistProducts.filter((product) => product.id !== Number(wishlistButton.dataset.wishlistRemove));
        renderWishlist();
      }
    } catch (error) {
      Store.showNotice(notice, error.message);
      button.disabled = false;
    }
  });

  start();
})();
