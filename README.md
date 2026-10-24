# Corner Store

An India-focused e-commerce demo built with Express, SQLite, and vanilla HTML, CSS, and JavaScript. All catalog, order, and payment amounts are stored as paise and displayed/charged in INR.

For a plain-language system diagram, role guide, and customer/seller/admin workflows, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Run locally

1. Install Node.js 22.5 or newer.
2. Run `npm install`.
3. Create an administrator from a terminal, using your own details:

   **PowerShell**
   ```powershell
   $env:ADMIN_NAME = "Store Admin"
   $env:ADMIN_EMAIL = "admin@yourstore.com"
   $env:ADMIN_PASSWORD = "replace-with-a-unique-password-of-12-or-more-characters"
   npm run create-admin
   Remove-Item Env:ADMIN_NAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
   ```

   **Command Prompt**
   ```cmd
   set "ADMIN_NAME=Store Admin"
   set "ADMIN_EMAIL=admin@yourstore.com"
   set "ADMIN_PASSWORD=replace-with-a-unique-password-of-12-or-more-characters"
   npm run create-admin
   set ADMIN_NAME=
   set ADMIN_EMAIL=
   set ADMIN_PASSWORD=
   ```

4. Set a private `SESSION_SECRET` before deploying; the built-in fallback is for local development only.
5. Run `npm start` and open [http://localhost:3000](http://localhost:3000).
6. Open [http://localhost:3000/admin.html](http://localhost:3000/admin.html) and sign in with the administrator details you created.
7. A person who wants to sell creates a normal customer account, then applies at [http://localhost:3000/seller.html](http://localhost:3000/seller.html). They do **not** need an administrator account. The platform administrator reviews and approves the seller; after approval, the seller signs in with that same account to manage their own listings and orders.

The server entry point is `src/server.js`; the Express app is configured in `src/app.js`. Frontend assets are organized under `public/customer/`, `public/seller/`, `public/admin/`, `public/css/`, and `public/js/`. Existing page URLs such as `/account.html` remain available. Catalog, account, seller, review, order/payment, and admin route registrations live in separate modules under `src/routes/`. Catalog, account, seller, review, and order/payment features delegate through controllers and repositories; validation and payment workflows live under `src/services/`. Admin overview, product, and category operations use an admin repository, with category validation in an admin service; some other admin workflows still query the database in the controller. Authentication also has its own controller, service, and repository, with shared middleware and currency formatting separated under `src/`. The root `server.js` and `database.js` remain compatibility launchers. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the current structure.

Use `.env.example` as a checklist for optional environment variables. This app does not load `.env` files automatically; set the values in your terminal or hosting provider. `.env` is ignored by Git. Never commit credentials.

If port 3000 is already occupied, stop the other server or start this one on another port with `set "PORT=3001" && npm start` in Command Prompt.

## Payments in India

- **Cash on delivery** is available without payment-gateway credentials. Staff mark the COD payment as collected when they mark an order delivered.
- **Razorpay online checkout** supports the payment methods enabled for your Razorpay account, such as UPI, cards, and netbanking. To enable it, create a Razorpay account, start with its **Test Mode** API keys, then stop the server and set these variables in the same Command Prompt before restarting:

  ```cmd
  set "RAZORPAY_KEY_ID=rzp_test_your_key_id"
  set "RAZORPAY_KEY_SECRET=your_test_key_secret"
  npm start
  ```

  Use your actual Test Mode values, not the example strings. The Key ID is sent to the browser as Razorpay requires; the Key Secret stays on the server. Never paste payment keys into chat, HTML, or JavaScript. Enable automatic payment capture in your Razorpay dashboard for orders to be confirmed after checkout. Test keys allow simulated payments only. Switch to live keys only after completing Razorpay merchant onboarding and testing the whole checkout.

- Without both Razorpay variables, the site offers COD only. The server creates payment orders in INR paise and confirms an online order only after checking Razorpay's signature and captured payment against the server-side order amount.
- An online order reserves inventory while its payment is pending. If a customer closes the payment window, the admin should check its status in the Razorpay dashboard before cancelling it. Cancelling releases the stock; this demo does not automatically issue gateway refunds.
- The checkout does not calculate shipping or tax. Delivery charges, if applicable, must be confirmed by the store before dispatch.

The SQLite database (`store.sqlite`) is created in the project root at first start and seeded with sample products priced in rupees. Its baseline schema is in `database/schema.sql`; the database initializer applies compatibility migrations from `database/migrations/` and performs safe category/data seeding. It stores customer accounts, administrator roles, orders, payment status, and order items. User passwords are hashed before storage. Admin accounts are never created with a preset public password.

On first startup after this currency update, a database from the earlier USD demo is migrated to INR using an approximate rate of ₹83 per USD. Review the migrated catalog prices in the admin panel before accepting real orders.

## Included

- Product catalog with ranked multi-word search, live product suggestions, category/price filters, sorting, pagination, seller names, ratings, multi-angle image galleries, and individual product pages
- Bestseller and fast-moving product views ranked from real order history, with recent demand clearly limited to the last 30 days
- Database-managed, nested product categories with seeded shopping departments, admin category management, and category/subcategory landing pages
- Shopping bag with quantity editing and browser-local cart persistence
- Customer registration, login, order history, saved Indian delivery addresses, wishlist, and verified-purchase product reviews
- Account settings, order search/status filters, eligible COD cancellation, buy-again cart refill, help guidance, and delivery-based demo rewards
- Optional browser voice search and camera barcode/QR scan using product SKU/barcodes
- Verified-purchase reviews with optional resized customer photos and a 5-star / moderate / bad rating breakdown
- Coupon creation and activation controls, with server-side quote and checkout validation
- Seller applications, approval/suspension, seller-owned catalog and inventory management, per-seller order fulfillment and tracking, and payout history
- Admin back office for products, inventory, seller applications, configurable marketplace commission, coupons, and review moderation
- Order management with fulfillment status updates, courier/tracking details, customer cancellation of eligible unshipped COD orders, return requests, and inventory restoration on eligible cancellations
- INR checkout with cash on delivery and optional Razorpay payment verification
- Server-side price, quantity, coupon, payment signature, authorization, and stock validation
- SQLite-backed catalog, hierarchical categories, accounts, seller applications, addresses, wishlist, reviews, coupons, orders, and payout records

### Categories and product placement

The first startup creates a category hierarchy in SQLite and safely assigns existing products to matching seeded categories without replacing product, user, or order records. Administrators can add, edit, reorder, deactivate, and safely delete categories in **Admin → Categories and subcategories**. Deletion is blocked while a category has products or child categories. Products must be assigned to an active leaf category; the product form reveals each child selector only after its parent is chosen. Customers can browse category pages such as `/category/fashion/men/clothing/shirts/`, which include products assigned to that category or its descendants.

Category IDs and parent relationships are checked by the server. A category that is inactive, has an inactive ancestor, or is not the most specific active category cannot be assigned to a new or edited product. Existing free-text category labels are retained for compatibility while migrated products receive a normalized `category_id`.

### Search and sales signals

Catalog search matches all entered words across product names, descriptions, seller/store names, and assigned category names—including parent categories. Results prioritize exact and name-prefix matches. Typing at least two characters displays matching products plus related suggestions from the catalog based on overlapping product names, categories, and descriptions; selecting a suggestion opens its product page, while the catalog filters live as you type.

“Bestsellers” sorts by units in non-cancelled orders that are no longer awaiting online payment. “Selling fast” is an observed recent-sales signal: at least three units ordered in the last 30 days. These are order-history indicators, not a machine-learning forecast or a guarantee of future demand. Cancelled and pending-payment orders are excluded.

Voice search and camera barcode scanning depend on browser support and user permission. Scanned barcode values can match the optional unique SKU field, which administrators and approved sellers can set on a product. Account reward points are a demo counter (one point per ₹100 on delivered orders), have no cash value, and cannot be redeemed. The wallet UI is informational only; wallet balances, cash-out, and wallet checkout are not enabled. Buy-again loads current product prices and stock into the bag, which should be reviewed before checkout.

Product forms accept up to eight extra HTTPS image URLs. Add one image per line as `profile | view angle | HTTPS image URL`; a URL by itself remains a general gallery image. Supported profiles are `male-slim`, `male-average`, `male-athletic`, `male-plus`, `female-petite`, `female-average`, `female-curvy`, `female-plus`, and `kids-2-4`, `kids-5-8`, `kids-9-12`, or `kids-13-16`. The first image remains the catalog/primary image; product pages show selectable thumbnails for alternate views. Clothing products with tagged seller photos offer a profile selector for those example images. This does not generate a photo of the customer or predict fit; customer photos are not requested or uploaded, and no API key or AI provider is needed. Seller model photos are examples only and are not a size guarantee.

The default seller commission is 10%; an administrator can change it (0–50%) for future orders in the admin dashboard. Commission and seller earnings are snapshotted on each new order. Each approved seller can process, ship, add courier tracking, and confirm delivery for only their own items. A multi-seller order is tracked as separate seller shipments; the order is marked delivered when all shipments are delivered. Administrators retain platform oversight and can update the overall order status. Payouts are manual: the retailer transfers money using their bank and records the transfer reference in the admin panel. The site does not store seller bank details or initiate transfers. Customers can cancel a COD order before processing and request a return after delivery. The admin reviews return requests and records externally completed refunds; the application does not issue refunds automatically.

Customers can attach one optional JPEG, PNG, or WebP photo to a review after the associated order is delivered. The browser resizes photos and the server validates type, file signature, and a 700 KB stored-size limit. Review photos are stored in SQLite and served only for approved reviews; administrators can inspect photos while moderating. Rating summaries show counts and percentages for 5-star, moderate (3–4 star), and bad (1–2 star) reviews.

This is a learning/demo marketplace, not a production-ready Amazon replacement. Before serving real customers, arrange and validate seller KYC and bank onboarding, GST/tax handling, shipping operations, legal policies, secure hosting and backups, email/SMS notifications, support workflows, payment webhooks, and automated/manual refund procedures. Razorpay onboarding and live API keys are also required for online payments. This application does not calculate tax or shipping, execute bank payouts, send notifications, process refunds, or reconcile asynchronous gateway events automatically.
