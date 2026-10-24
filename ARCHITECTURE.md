# Corner Store: Architecture and Workflows

This describes the marketplace that exists in this project today. It is a simple map of how the customer website, seller tools, administrator tools, server, and database work together.

## 1. Big-picture architecture

```text
 CUSTOMER BROWSER                 SELLER BROWSER                  ADMIN BROWSER
 Shop, search, cart, account      Seller studio                   Admin dashboard
          |                            |                                |
          +----------------------------+--------------------------------+
                                       |
                              HTTPS / JSON requests
                                       |
                         EXPRESS APPLICATION (src/server.js)
                  Login/session checks · validation · business rules
                    Customer APIs · seller APIs · admin APIs
                                       |
                    +------------------+------------------+
                    |                                     |
           STATIC WEBSITE FILES                    SQLITE DATABASE
           public/customer, seller, admin,   Users, sellers, products,
           css, and js                       stock, orders, shipments,
                                            payments, reviews, returns
```

The browser shows the pages and sends requests. Express checks who is signed in, validates the request, applies the marketplace rules, and reads or updates SQLite. The database is the source of truth for products, stock, users, and orders.

## 2. People and permissions

| Role | How they get access | What they can do |
|---|---|---|
| Customer | Create an account or sign in | Browse products, shop, place orders, view shipments, request eligible cancellations/returns, and leave delivered-purchase reviews |
| Seller | Create a normal customer account, apply on the Seller page, and wait for the store admin to approve | Manage their own products and stock; process, ship, add tracking, and confirm delivery for their own order items |
| Store admin | Sign in at the Admin page with the separately provisioned admin account | Approve or suspend sellers, manage the catalog and categories, oversee orders, configure commission/coupons, moderate reviews, and record manual payouts |
| App runner | Start the Node.js process on the computer/server hosting the site | Keep the website process running and configure its environment; this is not a website login or marketplace role |

**Important:** Sellers do not need the store administrator's password. The app runner may also be the store owner, but these are different responsibilities.

## 3. Main customer-to-delivery pipeline

```text
Customer browses products
        |
Adds items to bag (bag is stored in that browser)
        |
Signs in and submits checkout
        |
Server checks product availability, price, quantity, and stock
        |
Server creates one order and reserves stock
        |
One seller shipment is created for each seller in the order
        |
Each seller handles only their own shipment:
  Placed -> Processing -> Shipped (courier + tracking) -> Delivered
        |
Customer sees each shipment in account order history
        |
Overall order becomes Delivered after every seller shipment is Delivered
```

If a customer buys from two sellers, the checkout is still one customer order, but it has two seller shipments. Those sellers may ship separately. The customer can see the tracking details for each shipment.

### Payment path

- Cash on delivery can be selected without payment-provider credentials. In this demo, COD is marked paid when all shipments have been delivered.
- Razorpay checkout is optional and requires the store owner to configure Razorpay credentials. Online fulfillment is blocked until payment is confirmed.
- The app records payment state; it does not itself move physical money between customer, marketplace, or seller.

## 4. Seller onboarding pipeline

```text
Create customer account
        -> Open Seller page
        -> Submit store name and contact details
        -> Application waits for admin review
        -> Admin approves or rejects
        -> Approved seller signs in with the same account
        -> Seller studio becomes available
```

An approved seller can only edit or remove products belonging to that seller. The server checks seller ownership for product changes and fulfillment updates; hiding another seller's controls in the browser is not the security boundary.

## 5. Returns and seller payouts

```text
Return:
Customer requests return after delivery
  -> Admin reviews the request
  -> Store owner arranges any refund outside this demo
  -> Admin records the result

Seller payout:
App calculates/records seller earnings
  -> Store owner sends the seller money separately (for example, bank transfer)
  -> Admin records the transfer reference in the dashboard
```

These are human-operated steps. The app does not book a courier, collect a parcel, transfer seller earnings, or send a refund.

## 6. What happens when the app starts

```text
App runner opens a terminal in the project folder
  -> Runs `npm start`
  -> Node.js starts `src/server.js`
  -> Express opens the configured port (3000 by default)
  -> Database module opens/creates root `store.sqlite` and applies `database/schema.sql` plus compatibility migrations
  -> Browser requests pages and API data from the running server
```

If the selected port is already in use, another program is listening there. Stop the other server or choose another port before starting this one.

## 7. Where the code lives

| Location | Responsibility |
|---|---|
| `src/server.js` | Starts Express and listens on the configured port |
| `src/app.js` | Express app setup and middleware wiring |
| `src/routes/` | Page, authentication, catalog, account, seller, review, order/payment, and admin route modules |
| `src/controllers/`, `src/services/`, `src/repositories/` | Authentication, account, seller, catalog, review, order/payment, and admin controllers; feature validation/workflows; domain repositories for SQL and transactions; shared marketplace helpers |
| `src/middleware/` | Authentication, authorization, CSRF, and centralized error handling |
| `src/utils/` | Shared currency-formatting utility |
| `src/config/database.js` | Database compatibility entry used by application modules |
| `database/schema.sql` | Baseline schema used to create new databases |
| `database/migrations/` | Compatibility migrations for legacy databases |
| `database/database.js` | SQLite initialization, compatibility upgrades, and safe sample/category seeding |
| `server.js`, `database.js` | Backward-compatible launch/database entries for older scripts |
| `public/customer/`, `public/seller/`, `public/admin/` | Customer, seller, and administrator pages |
| `public/css/`, `public/js/` | Shared styling and browser scripts |
| `tests/*.test.js` | Automated integration tests for core workflows and legacy migrations |
| `src/create-admin.js` | Creates the initial administrator from private environment variables |
| `store.sqlite` | Local application data; preserved in the project root and ignored by Git |

The project now uses the requested physical layout while preserving existing public URLs and the existing root database file. Route registrations are grouped into feature-specific route modules outside the Express bootstrap. Account, seller, catalog, reviews, orders/payments, and admin delegate HTTP handling to controllers, validation/workflows to services, and SQL plus state-changing transactions to repositories. Shared catalog helpers remain in `src/services/marketplace.shared.js` where they are used by multiple features. The root compatibility files should remain until any external scripts that depend on them are updated.

## 8. Build and verification pipeline

This project does not currently have a hosted CI/CD pipeline. For each code change, use this local development/check pipeline:

```text
Make a focused code change
  -> Run `npm test`
  -> Check changed JavaScript with `node --check <file>`
  -> Start/restart with `npm start`
  -> Open the affected page and verify the workflow in a browser
  -> Back up the database before deploying changes to a live server
```

Tests use temporary SQLite databases so test orders and products do not need to be created in the normal local store.

## 9. Demo boundaries before real launch

This is a learning/demo marketplace, not a complete production marketplace. Before real customers use it, plan and implement operational services for courier booking and parcel tracking, seller identity/business verification, secure seller payouts, customer refunds, tax and shipping rules, customer notifications, data backups, and production hosting/monitoring. Use a real payment provider configuration only after testing its complete payment and refund process.
