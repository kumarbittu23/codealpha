const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function createClient(baseUrl) {
  let cookie = "";
  let csrfToken = "";

  return {
    async request(route, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      if (options.body) headers["Content-Type"] = "application/json";
      if (options.method && options.method !== "GET") {
        if (!csrfToken) {
          const sessionResponse = await fetch(`${baseUrl}/api/session`, { headers });
          const sessionCookies = sessionResponse.headers.getSetCookie();
          cookie = sessionCookies.map((value) => value.split(";")[0]).join("; ");
          csrfToken = (await sessionResponse.json()).csrfToken;
          if (cookie) headers.Cookie = cookie;
        }
        headers["X-CSRF-Token"] = csrfToken;
      }

      const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length) cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
      if (response.status === 204) return { response, body: null };
      const body = await response.json();
      if (body.csrfToken) csrfToken = body.csrfToken;
      return { response, body };
    },
    async raw(route) {
      const headers = cookie ? { Cookie: cookie } : {};
      return fetch(`${baseUrl}${route}`, { headers });
    },
    async initialize() {
      const { response, body } = await this.request("/api/session");
      assert.equal(response.status, 200);
      csrfToken = body.csrfToken;
    }
  };
}

test("admin can manage catalog and process orders while customers stay restricted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corner-admin-test-"));
  const databasePath = path.join(directory, "test.sqlite");
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DATABASE_PATH: databasePath,
    PORT: String(port),
    ADMIN_NAME: "Test Admin",
    ADMIN_EMAIL: "admin@example.test",
    ADMIN_PASSWORD: "test-admin-password-123"
  };
  let server;

  try {
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE product_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (product_id, image_url)
      )
    `);
    legacyDatabase.close();

    const setup = spawn(process.execPath, [path.join(__dirname, "..", "src", "create-admin.js")], { env, stdio: "ignore" });
    const [setupCode] = await once(setup, "exit");
    assert.equal(setupCode, 0, "admin provisioning should succeed");

    server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: "ignore" });

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null) assert.fail(`server exited with code ${server.exitCode}`);
      try {
        const response = await fetch(`${baseUrl}/api/session`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(ready, "server should start");

    for (const route of [
      "/", "/account.html", "/cart.html", "/product.html", "/seller.html", "/admin.html",
      "/styles.css", "/common.js", "/css/styles.css", "/js/common.js", "/js/shop.js",
      "/js/product.js", "/js/cart.js", "/js/account.js", "/js/seller.js", "/js/admin.js",
      "/category/fashion/men/"
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 200, `${route} should resolve after the public assets move`);
    }

    const admin = createClient(baseUrl);
    const customer = createClient(baseUrl);
    await admin.initialize();
    await customer.initialize();

    let result = await customer.request("/api/payment-options");
    assert.equal(result.body.currency, "INR");
    assert.equal(result.body.razorpayEnabled, false);

    result = await admin.request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.role, "admin");

    result = await customer.request("/api/admin/overview");
    assert.equal(result.response.status, 401);

    result = await customer.request("/api/admin/categories", { method: "POST", body: JSON.stringify({ name: "Blocked category" }) });
    assert.equal(result.response.status, 401);

    result = await admin.request("/api/categories");
    const fashion = result.body.find((category) => category.slug === "fashion");
    const mensShirts = fashion.children.find((category) => category.slug === "men")
      .children.find((category) => category.slug === "clothing")
      .children.find((category) => category.slug === "shirts");
    assert.ok(mensShirts, "seeded category tree should contain Fashion / Men / Clothing / Shirts");
    const categoryPageResponse = await fetch(`${baseUrl}/category/fashion/men/clothing/shirts/`);
    assert.equal(categoryPageResponse.status, 200);
    assert.match(await categoryPageResponse.text(), /category-heading/);

    result = await admin.request("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Category Test Shirt",
        sku: "TSHIRT-1001",
        categoryId: mensShirts.id,
        description: "A category test shirt assigned to the men's shirts leaf.",
        pricePaise: 125000,
        imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
        additionalImageUrls: [
          "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?view=side",
          "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?view=back"
        ],
        stock: 4
      })
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const categoryProductId = result.body.id;
    result = await admin.request(`/api/products/${categoryProductId}`);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.additionalImageUrls, [
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?view=side",
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?view=back"
    ]);
    result = await admin.request(`/api/admin/products/${categoryProductId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "Category Test Shirt",
        sku: "TSHIRT-1001",
        categoryId: mensShirts.id,
        description: "A category test shirt assigned to the men's shirts leaf.",
        pricePaise: 125000,
        imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
        productImages: [
          { imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?profile=average", modelProfile: "male-average", viewLabel: "Front view" },
          { imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?profile=athletic", modelProfile: "male-athletic", viewLabel: "Side view" }
        ],
        stock: 4
      })
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    result = await admin.request(`/api/products/${categoryProductId}`);
    assert.equal(result.body.sku, "TSHIRT-1001", "editing a product should preserve its SKU");
    assert.deepEqual(result.body.productImages, [
      { imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?profile=average", modelProfile: "male-average", viewLabel: "Front view" },
      { imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?profile=athletic", modelProfile: "male-athletic", viewLabel: "Side view" }
    ]);
    assert.deepEqual(result.body.additionalImageUrls, [
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?profile=average",
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?profile=athletic"
    ], "the legacy URL-only response should remain available");
    result = await admin.request("/api/products?categoryPath=fashion/men/clothing/shirts");
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.products.map((product) => product.id), [categoryProductId]);
    assert.equal(result.body.products[0].categoryPathLabel, "Fashion / Men / Clothing / Shirts");
    result = await admin.request("/api/products?search=men+shirts");
    assert.equal(result.response.status, 200);
    assert.ok(result.body.products.some((product) => product.id === categoryProductId), "search should match both product category ancestors and leaf");
    result = await admin.request("/api/products?search=shirt+cotton&limit=5&suggestions=true");
    assert.equal(result.response.status, 200);
    assert.ok(result.body.relatedProducts.some((product) => product.id === categoryProductId), "autocomplete should recommend related catalog products when all typed words do not match");
    result = await admin.request("/api/products?search=TSHIRT-1001");
    assert.ok(result.body.products.some((product) => product.id === categoryProductId), "search should find products by scanned SKU/barcode");
    result = await admin.request(`/api/admin/categories/${mensShirts.id}`, { method: "DELETE" });
    assert.equal(result.response.status, 409);
    result = await admin.request("/api/products?categoryPath=grocery");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.products.some((product) => product.id === categoryProductId), false);

    result = await admin.request("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ name: "Temporary taxonomy", slug: "temporary-taxonomy", displayOrder: 15 })
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const temporaryCategoryId = result.body.id;
    result = await admin.request(`/api/admin/categories/${temporaryCategoryId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Temporary taxonomy updated", active: false })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.active, 0);
    result = await admin.request("/api/products?categoryPath=temporary-taxonomy");
    assert.equal(result.response.status, 404);
    result = await admin.request(`/api/admin/categories/${temporaryCategoryId}`, { method: "DELETE" });
    assert.equal(result.response.status, 204);
    result = await admin.request(`/api/admin/products/${categoryProductId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "Updated Category Test Shirt",
        sku: "TSHIRT-1001",
        category: "Accessories",
        description: "Updated test product details for the category workflow.",
        pricePaise: 125000,
        imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
        stock: 4
      })
    });
    assert.equal(result.response.status, 200);

    result = await admin.request("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Market Tote",
        category: "Accessories",
        description: "A test product used to verify the admin catalog workflow.",
        pricePaise: 250000,
        imageUrl: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7",
        stock: 2,
        featured: true
      })
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const productId = result.body.id;

    result = await admin.request(`/api/admin/products/${productId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "Updated Market Tote",
        category: "Accessories",
        description: "Updated test product details for the catalog workflow.",
        pricePaise: 280000,
        imageUrl: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7",
        stock: 2,
        featured: false
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.pricePaise, 280000);

    result = await customer.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Test Customer", email: "customer@example.test", password: "customer-password-123" })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.user.role, "customer");
    result = await customer.request("/api/account/rewards");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.walletEnabled, false);
    assert.equal(result.body.points, 0);
    result = await customer.request("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated Test Customer", email: "customer@example.test" })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.name, "Updated Test Customer");
    result = await customer.request("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated Test Customer", email: "new@example.test" })
    });
    assert.equal(result.response.status, 403);

    result = await admin.request("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Duplicate barcode shirt",
        sku: "TSHIRT-1001",
        categoryId: mensShirts.id,
        description: "This product should be rejected due to duplicated SKU.",
        pricePaise: 125000,
        imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
        stock: 2
      })
    });
    assert.equal(result.response.status, 400);

    result = await customer.request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: "Test Customer",
        shippingAddress: "123 Example Street, Test City",
        items: [{ productId: categoryProductId, quantity: 3 }]
      })
    });
    assert.equal(result.response.status, 201);
    const fastOrderId = result.body.id;
    result = await customer.request("/api/products?sort=selling_fast");
    const fastProduct = result.body.products.find((product) => product.id === categoryProductId);
    assert.equal(fastProduct.recentUnitsSold, 3);
    assert.equal(fastProduct.sellingFast, 1);
    result = await customer.request(`/api/orders/${fastOrderId}/cancel`, { method: "POST", body: JSON.stringify({}) });
    assert.equal(result.response.status, 200);
    result = await customer.request("/api/products?sort=selling_fast");
    assert.equal(result.body.products.find((product) => product.id === categoryProductId).recentUnitsSold, 0);

    result = await customer.request("/api/payments/razorpay/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: "Test Customer",
        shippingAddress: "123 Example Street, Test City",
        items: [{ productId, quantity: 1 }]
      })
    });
    assert.equal(result.response.status, 503);

    result = await customer.request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: "Test Customer",
        shippingAddress: "123 Example Street, Test City",
        items: [{ productId, quantity: 1 }]
      })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.totalPaise, 280000);
    const firstOrderId = result.body.id;
    result = await customer.request("/api/products?sort=bestsellers");
    assert.equal(result.response.status, 200);
    const bestseller = result.body.products.find((product) => product.id === productId);
    assert.equal(bestseller.unitsSold, 1);
    assert.equal(bestseller.bestseller, 1);
    result = await customer.request("/api/products?sort=selling_fast");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.products.find((product) => product.id === productId).recentUnitsSold, 1);

    result = await admin.request(`/api/admin/orders/${firstOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "processing" })
    });
    assert.equal(result.response.status, 200);

    result = await admin.request(`/api/admin/orders/${firstOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "shipped" })
    });
    assert.equal(result.response.status, 200);

    result = await admin.request(`/api/admin/orders/${firstOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" })
    });
    assert.equal(result.response.status, 409);

    result = await customer.request("/api/orders");
    assert.equal(result.body[0].status, "shipped");
    assert.equal(result.body[0].paymentMethod, "cash_on_delivery");
    assert.equal(result.body[0].paymentStatus, "pending");

    result = await customer.request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: "Test Customer",
        shippingAddress: "123 Example Street, Test City",
        items: [{ productId, quantity: 1 }]
      })
    });
    assert.equal(result.response.status, 201);

    result = await admin.request(`/api/admin/orders/${result.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" })
    });
    assert.equal(result.response.status, 200);

    result = await fetch(`${baseUrl}/api/products/${productId}`);
    const restoredProduct = await result.json();
    assert.equal(restoredProduct.stock, 1);

    result = await customer.request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: "Test Customer",
        shippingAddress: "123 Example Street, Test City",
        items: [{ productId, quantity: 1 }]
      })
    });
    assert.equal(result.response.status, 201);
    const deliveryOrderId = result.body.id;
    for (const status of ["processing", "shipped", "delivered"]) {
      result = await admin.request(`/api/admin/orders/${deliveryOrderId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      assert.equal(result.response.status, 200);
    }
    result = await admin.request(`/api/admin/orders/${deliveryOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" })
    });
    assert.equal(result.response.status, 409);
    result = await customer.request("/api/orders");
    assert.equal(result.body[0].paymentStatus, "paid");

    result = await admin.request(`/api/admin/products/${productId}`, { method: "DELETE" });
    assert.equal(result.response.status, 409);

    const overview = await admin.request("/api/admin/overview");
    assert.equal(overview.response.status, 200);
    assert.equal(overview.body.orders.length, 4);
    assert.equal(overview.body.products.find((product) => product.id === productId).name, "Updated Market Tote");

    result = await customer.request("/api/account/addresses", {
      method: "POST",
      body: JSON.stringify({
        recipientName: "Test Customer",
        phone: "9876543210",
        line1: "123 Example Street",
        line2: "Near Test Park",
        city: "Test City",
        state: "Karnataka",
        postalCode: "560001"
      })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.postalCode, "560001");
    result = await customer.request("/api/account/addresses");
    assert.equal(result.body.length, 1);

    result = await customer.request(`/api/wishlist/${productId}`, {
      method: "POST",
      body: JSON.stringify({})
    });
    assert.equal(result.response.status, 201);
    result = await customer.request("/api/wishlist");
    assert.equal(result.body[0].id, productId);

    result = await customer.request("/api/seller/apply", {
      method: "POST",
      body: JSON.stringify({ storeName: "Test Seller Store", phone: "9876543210", gstin: "" })
    });
    assert.equal(result.response.status, 201);
    const sellerId = result.body.id;
    result = await customer.request("/api/seller/overview");
    assert.equal(result.response.status, 403);

    result = await admin.request(`/api/admin/sellers/${sellerId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "rejected" })
    });
    assert.equal(result.response.status, 200);
    result = await customer.request("/api/seller/apply", {
      method: "POST",
      body: JSON.stringify({ storeName: "Updated Test Seller", phone: "9876543210", gstin: "" })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "pending");

    result = await admin.request(`/api/admin/sellers/${sellerId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" })
    });
    assert.equal(result.response.status, 200);

    result = await admin.request("/api/admin/settings/commission", {
      method: "PATCH",
      body: JSON.stringify({ percent: 12.5 })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.commissionBasisPoints, 1250);

    result = await customer.request("/api/seller/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Seller Test Candle",
        category: "Home",
        description: "A product listed by the approved test seller account.",
        imageUrl: "https://images.unsplash.com/photo-1603006905003-be475563bc59",
        pricePaise: 10000,
        stock: 4,
        featured: false
      })
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const sellerProductId = result.body.id;
    result = await customer.request(`/api/seller/orders/${deliveryOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "processing" })
    });
    assert.equal(result.response.status, 404, "a seller must not manage a different seller's fulfillment");
    result = await customer.request(`/api/seller/products/${productId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "Unauthorized product edit",
        category: "Home",
        description: "This edit must not affect a different seller's product.",
        imageUrl: "https://images.unsplash.com/photo-1603006905003-be475563bc59",
        pricePaise: 1,
        stock: 4
      })
    });
    assert.equal(result.response.status, 404);

    result = await admin.request("/api/admin/coupons", {
      method: "POST",
      body: JSON.stringify({ code: "TEST10", percent: 10, minOrderPaise: 0, maxDiscountPaise: null, usageLimit: 5 })
    });
    assert.equal(result.response.status, 201);
    result = await customer.request("/api/coupons/quote", {
      method: "POST",
      body: JSON.stringify({ code: "TEST10", items: [{ productId: sellerProductId, quantity: 1 }] })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.discountPaise, 1000);
    assert.equal(result.body.totalPaise, 9000);

    result = await customer.request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: "Test Customer",
        shippingAddress: "123 Example Street, Test City",
        items: [{ productId: sellerProductId, quantity: 1 }]
      })
    });
    assert.equal(result.response.status, 201);
    const customerCancelledOrderId = result.body.id;
    result = await customer.request(`/api/orders/${customerCancelledOrderId}/cancel`, {
      method: "POST",
      body: JSON.stringify({})
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "cancelled");

    result = await customer.request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: "Test Customer",
        shippingAddress: "123 Example Street, Test City",
        couponCode: "TEST10",
        items: [{ productId: sellerProductId, quantity: 1 }]
      })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.totalPaise, 9000);
    const sellerOrderId = result.body.id;
    result = await customer.request(`/api/seller/orders/${sellerOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "processing" })
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    result = await customer.request(`/api/seller/orders/${sellerOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "shipped", trackingCarrier: "Test Courier", trackingCode: "TRACK123" })
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    result = await customer.request("/api/orders");
    assert.equal(result.body[0].status, "shipped");
    assert.deepEqual(result.body[0].shipments, [{
      sellerName: "Updated Test Seller",
      status: "shipped",
      trackingCarrier: "Test Courier",
      trackingCode: "TRACK123"
    }]);
    result = await customer.request(`/api/seller/orders/${sellerOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "delivered" })
    });
    assert.equal(result.response.status, 200);
    result = await customer.request("/api/orders");
    assert.equal(result.body[0].status, "delivered");
    assert.equal(result.body[0].paymentStatus, "paid", "seller delivery confirmation should complete COD payment status");
    assert.equal(result.body[0].shipments[0].status, "delivered");
    const sellerOverview = await customer.request("/api/seller/overview");
    assert.equal(sellerOverview.response.status, 200);
    assert.equal(sellerOverview.body.orders.find((order) => order.id === sellerOrderId).status, "delivered");

    result = await customer.request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        shippingName: "Test Customer",
        shippingAddress: "123 Example Street, Test City",
        items: [{ productId: sellerProductId, quantity: 1 }, { productId: categoryProductId, quantity: 1 }]
      })
    });
    assert.equal(result.response.status, 201);
    const multiSellerOrderId = result.body.id;
    result = await customer.request("/api/orders");
    const multiSellerOrder = result.body.find((order) => order.id === multiSellerOrderId);
    assert.equal(multiSellerOrder.shipments.length, 2, "mixed carts should create a separate shipment for each seller");
    result = await customer.request(`/api/seller/orders/${multiSellerOrderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "processing" })
    });
    assert.equal(result.response.status, 200);
    result = await customer.request("/api/orders");
    assert.equal(result.body.find((order) => order.id === multiSellerOrderId).status, "processing",
      "the overall order should remain in progress while another seller has not started fulfillment");
    result = await admin.request(`/api/admin/orders/${multiSellerOrderId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "shipped", trackingCarrier: "Platform Courier", trackingCode: "PLATFORM123" })
      });
    assert.equal(result.response.status, 200);
    result = await customer.request("/api/orders");
    const updatedMultiSellerOrder = result.body.find((order) => order.id === multiSellerOrderId);
    assert.ok(updatedMultiSellerOrder.shipments.every((shipment) => shipment.status === "shipped"),
      "admin status updates should stay synchronized with seller shipment records");

    const reviewImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCkAAAAAASUVORK5CYII=";
    result = await customer.request(`/api/products/${sellerProductId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ rating: 5, body: "Excellent quality and exactly as described.", imageData: reviewImage })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.hasImage, true);
    const fiveStarReviewId = result.body.id;
    result = await customer.request(`/api/products/${sellerProductId}`);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.ratingBreakdown, { total: 1, fiveStar: 1, moderate: 0, bad: 0 });
    assert.equal(result.body.reviews[0].hasImage, 1);
    let imageResponse = await customer.raw(`/api/reviews/${fiveStarReviewId}/image`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");
    result = await customer.request(`/api/products/${sellerProductId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ rating: 4, body: "Invalid image should be rejected.", imageData: "data:image/png;base64,not-a-real-image" })
    });
    assert.equal(result.response.status, 400);

    for (const rating of [3, 1]) {
      result = await customer.request("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          shippingName: "Test Customer",
          shippingAddress: "123 Example Street, Test City",
          items: [{ productId: sellerProductId, quantity: 1 }]
        })
      });
      assert.equal(result.response.status, 201);
      const ratingOrderId = result.body.id;
      for (const status of ["processing", "shipped", "delivered"]) {
        result = await admin.request(`/api/admin/orders/${ratingOrderId}`, {
          method: "PATCH",
          body: JSON.stringify({ status })
        });
        assert.equal(result.response.status, 200);
      }
      result = await customer.request(`/api/products/${sellerProductId}/reviews`, {
        method: "POST",
        body: JSON.stringify({ rating, body: rating === 3 ? "A moderate, acceptable experience." : "A poor experience that needs work." })
      });
      assert.equal(result.response.status, 201);
    }
    result = await customer.request(`/api/products/${sellerProductId}`);
    assert.deepEqual(result.body.ratingBreakdown, { total: 3, fiveStar: 1, moderate: 1, bad: 1 });

    result = await customer.request(`/api/orders/${sellerOrderId}/returns`, {
      method: "POST",
      body: JSON.stringify({ reason: "The product arrived with a damaged outer box." })
    });
    assert.equal(result.response.status, 201);
    result = await admin.request("/api/admin/overview");
    const returnRequest = result.body.returnRequests.find((item) => item.orderId === sellerOrderId);
    assert.equal(returnRequest.status, "pending");
    result = await admin.request(`/api/admin/returns/${returnRequest.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" })
    });
    assert.equal(result.response.status, 200);
    result = await admin.request(`/api/admin/returns/${returnRequest.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "refunded" })
    });
    assert.equal(result.response.status, 200);
    result = await customer.request("/api/orders");
    assert.equal(result.body.find((order) => order.id === sellerOrderId).returnStatus, "refunded");
    result = await admin.request("/api/admin/overview");
    const visibleReview = result.body.reviews.find((review) => review.productName === "Seller Test Candle" && review.hasImage);
    assert.equal(visibleReview.status, "approved");
    assert.equal(visibleReview.hasImage, 1);
    result = await admin.request(`/api/admin/reviews/${visibleReview.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "hidden" })
    });
    assert.equal(result.response.status, 200);
    imageResponse = await customer.raw(`/api/reviews/${visibleReview.id}/image`);
    assert.equal(imageResponse.status, 404);
    imageResponse = await admin.raw(`/api/admin/reviews/${visibleReview.id}/image`);
    assert.equal(imageResponse.status, 200);

    result = await customer.request("/api/seller/overview");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.pendingPaise, 25375);
    result = await admin.request(`/api/admin/sellers/${sellerId}/payouts`, {
      method: "POST",
      body: JSON.stringify({ reference: "TEST-UTR-12345" })
    });
    assert.equal(result.response.status, 201);
    result = await customer.request("/api/seller/overview");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.pendingPaise, 0);
    assert.equal(result.body.payouts[0].reference, "TEST-UTR-12345");
  } finally {
    if (server && server.exitCode === null) {
      server.kill();
      await once(server, "exit");
    }
    await rm(directory, { recursive: true, force: true });
  }
});
