const database = require("../config/database");
const { readCategories } = require("../services/marketplace.shared");

function listProducts(query) {
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 80) : "";
  const category = typeof query.category === "string" ? query.category.trim().slice(0, 40) : "";
  const categoryId = Number.parseInt(query.categoryId, 10);
  const categoryPath = typeof query.categoryPath === "string" ? query.categoryPath.trim().slice(0, 500) : "";
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, Number.parseInt(query.limit, 10) || 12));
  const sort = typeof query.sort === "string" ? query.sort : "featured";
  const minPrice = Math.max(0, Number.parseInt(query.minPrice, 10) || 0);
  const maxPrice = Math.max(0, Number.parseInt(query.maxPrice, 10) || 0);
  const conditions = [];
  const parameters = [];
  if (search) {
    const tokens = [...new Set(search.toLowerCase().split(/[\s,.;:/\\_-]+/).filter(Boolean))].slice(0, 8);
    const searchableFields = [
      "lower(products.name)",
      "lower(products.sku)",
      "lower(products.description)",
      "lower(products.category)",
      "lower(categories.name)",
      "lower(categories.slug)",
      "lower(sellers.store_name)"
    ];
    for (const token of tokens) {
      const pattern = `%${token}%`;
      conditions.push(`(${searchableFields.map((field) => `${field} LIKE ?`).join(" OR ")} OR EXISTS (
        WITH RECURSIVE ancestors(id, parent_id, name, slug) AS (
          SELECT id, parent_id, name, slug FROM categories WHERE id = products.category_id
          UNION ALL
          SELECT parent.id, parent.parent_id, parent.name, parent.slug
          FROM categories parent JOIN ancestors child ON parent.id = child.parent_id
        )
        SELECT 1 FROM ancestors WHERE lower(name || ' ' || slug) LIKE ?
      ))`);
      parameters.push(...searchableFields.map(() => pattern), pattern);
    }
  }
  if (category && category !== "All") {
    conditions.push("products.category = ?");
    parameters.push(category);
  }
  if (categoryId > 0) {
    conditions.push(`products.category_id IN (
      WITH RECURSIVE category_tree(id) AS (
        SELECT id FROM categories WHERE id = ? AND active = 1
        UNION ALL
        SELECT categories.id FROM categories JOIN category_tree ON categories.parent_id = category_tree.id
        WHERE categories.active = 1
      ) SELECT id FROM category_tree
    )`);
    parameters.push(categoryId);
  } else if (categoryPath) {
    const pathParts = categoryPath.split("/").filter(Boolean);
    let parentId = null;
    let selected = null;
    for (const slug of pathParts) {
      selected = database.prepare(`
        SELECT id, parent_id AS parentId FROM categories WHERE slug = ? AND active = 1
          AND ${parentId === null ? "parent_id IS NULL" : "parent_id = ?"}
      `).get(...(parentId === null ? [slug] : [slug, parentId]));
      if (!selected) return { categoryNotFound: true };
      parentId = selected.id;
    }
    if (selected) {
      conditions.push(`products.category_id IN (
        WITH RECURSIVE category_tree(id) AS (
          SELECT id FROM categories WHERE id = ? AND active = 1
          UNION ALL
          SELECT categories.id FROM categories JOIN category_tree ON categories.parent_id = category_tree.id
          WHERE categories.active = 1
        ) SELECT id FROM category_tree
      )`);
      parameters.push(selected.id);
    }
  }
  if (minPrice > 0) {
    conditions.push("products.price_paise >= ?");
    parameters.push(minPrice);
  }
  if (maxPrice > 0) {
    conditions.push("products.price_paise <= ?");
    parameters.push(maxPrice);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = {
    featured: "products.featured DESC, products.id DESC",
    newest: "products.id DESC",
    price_low: "products.price_paise ASC, products.id DESC",
    price_high: "products.price_paise DESC, products.id DESC",
    rating: "average_rating DESC, review_count DESC, products.id DESC",
    bestsellers: "COALESCE(sales.units_sold, 0) DESC, products.id DESC",
    selling_fast: "COALESCE(sales.recent_units_sold, 0) DESC, COALESCE(sales.units_sold, 0) DESC, products.id DESC"
  }[sort] || "products.featured DESC, products.id DESC";
  const searchRank = search
    ? "CASE WHEN lower(products.name) = lower(?) THEN 0 WHEN lower(products.name) LIKE ? THEN 1 WHEN lower(categories.name) LIKE ? THEN 2 ELSE 3 END"
    : "0";
  const searchRankParameters = search ? [search, `${search.toLowerCase()}%`, `%${search.toLowerCase()}%`] : [];
  const from = `
    FROM products
    JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
    JOIN categories ON categories.id = products.category_id AND categories.active = 1
    LEFT JOIN reviews ON reviews.product_id = products.id AND reviews.status = 'approved'
    LEFT JOIN (
      SELECT product_id, units_sold, recent_units_sold,
        RANK() OVER (ORDER BY units_sold DESC) AS bestseller_rank
      FROM (
        SELECT order_items.product_id,
          SUM(order_items.quantity) AS units_sold,
          SUM(CASE WHEN orders.created_at >= datetime('now', '-30 days') THEN order_items.quantity ELSE 0 END) AS recent_units_sold
        FROM order_items JOIN orders ON orders.id = order_items.order_id
        WHERE orders.status NOT IN ('cancelled', 'pending_payment')
        GROUP BY order_items.product_id
      )
    ) sales ON sales.product_id = products.id
    ${where}
  `;
  const total = database.prepare(`SELECT COUNT(DISTINCT products.id) AS total ${from}`).get(...parameters).total;
  const products = database.prepare(`
    SELECT products.id, products.name, products.sku, products.category, products.category_id AS categoryId, products.description,
      products.price_paise AS pricePaise, products.image_url AS imageUrl, products.stock,
      products.featured, sellers.store_name AS sellerName, categories.slug AS categorySlug,
      categories.name AS categoryName,
      COALESCE(sales.units_sold, 0) AS unitsSold,
      COALESCE(sales.recent_units_sold, 0) AS recentUnitsSold,
      CASE WHEN COALESCE(sales.units_sold, 0) > 0 AND sales.bestseller_rank <= 3 THEN 1 ELSE 0 END AS bestseller,
      CASE WHEN COALESCE(sales.recent_units_sold, 0) >= 3 THEN 1 ELSE 0 END AS sellingFast,
      ${searchRank} AS searchRank,
      COALESCE(AVG(reviews.rating), 0) AS averageRating, COUNT(reviews.id) AS reviewCount
    ${from}
    GROUP BY products.id
    ORDER BY ${search ? "searchRank ASC, " : ""}${orderBy}
    LIMIT ? OFFSET ?
  `).all(...searchRankParameters, ...parameters, limit, (page - 1) * limit);
  let relatedProducts = [];
  if (query.suggestions === "true" && search) {
    const suggestionTokens = [...new Set(search.toLowerCase().split(/[\s,.;:/\\_-]+/).filter((token) => token.length >= 2))]
      .filter((token) => !["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"].includes(token))
      .slice(0, 6);
    if (suggestionTokens.length) {
      const suggestionFields = ["lower(products.name)", "lower(categories.name)", "lower(categories.slug)", "lower(products.description)"];
      const matchConditions = suggestionTokens.map(() => `(${suggestionFields.map((field) => `${field} LIKE ?`).join(" OR ")})`);
      const relevance = suggestionTokens.map(() => `
        CASE WHEN lower(products.name) LIKE ? THEN 5
          WHEN lower(categories.name) LIKE ? OR lower(categories.slug) LIKE ? THEN 3
          WHEN lower(products.description) LIKE ? THEN 1 ELSE 0 END
      `).join(" + ");
      const matchParameters = suggestionTokens.flatMap((token) => suggestionFields.map(() => `%${token}%`));
      const relevanceParameters = suggestionTokens.flatMap((token) => [`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`]);
      relatedProducts = database.prepare(`
        SELECT products.id, products.name, products.category, products.category_id AS categoryId,
          products.price_paise AS pricePaise, products.image_url AS imageUrl,
          categories.name AS categoryName, (${relevance}) AS relevance
        FROM products
        JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
        JOIN categories ON categories.id = products.category_id AND categories.active = 1
        WHERE ${matchConditions.join(" OR ")}
        GROUP BY products.id
        ORDER BY relevance DESC, products.featured DESC, products.id DESC
        LIMIT 8
      `).all(...relevanceParameters, ...matchParameters)
        .filter((product) => !products.some((match) => match.id === product.id));
    }
  }
  const categories = database.prepare(`
    SELECT DISTINCT products.category
    FROM products JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
    ORDER BY products.category
  `).all().map((row) => row.category);
  return {
    products,
    relatedProducts,
    categories,
    categoryTree: readCategories(),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  };
}

function getProductById(productId) {
  const product = database.prepare(`
    SELECT products.id, products.name, products.sku, products.category, products.category_id AS categoryId, products.description,
      products.price_paise AS pricePaise, products.image_url AS imageUrl, products.stock,
      products.featured, sellers.store_name AS sellerName, categories.slug AS categorySlug,
      categories.name AS categoryName,
      COALESCE(AVG(reviews.rating), 0) AS averageRating, COUNT(reviews.id) AS reviewCount
    FROM products
    JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
    JOIN categories ON categories.id = products.category_id AND categories.active = 1
    LEFT JOIN reviews ON reviews.product_id = products.id AND reviews.status = 'approved'
    WHERE products.id = ?
    GROUP BY products.id
  `).get(productId);
  if (!product) return null;
  const productImages = database.prepare(`
    SELECT image_url AS imageUrl, model_profile AS modelProfile, view_label AS viewLabel
    FROM product_images WHERE product_id = ? ORDER BY display_order, id
  `).all(product.id);
  const reviews = database.prepare(`
    SELECT reviews.id, reviews.rating, reviews.body, reviews.created_at AS createdAt,
      reviews.image_mime AS imageMime, users.name AS reviewerName,
      CASE WHEN reviews.image_data IS NULL THEN 0 ELSE 1 END AS hasImage
    FROM reviews JOIN users ON users.id = reviews.user_id
    WHERE reviews.product_id = ? AND reviews.status = 'approved'
    ORDER BY reviews.id DESC LIMIT 20
  `).all(product.id);
  const ratingCounts = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS fiveStar,
      SUM(CASE WHEN rating BETWEEN 3 AND 4 THEN 1 ELSE 0 END) AS moderate,
      SUM(CASE WHEN rating BETWEEN 1 AND 2 THEN 1 ELSE 0 END) AS bad
    FROM reviews WHERE product_id = ? AND status = 'approved'
  `).get(product.id);
  return {
    ...product,
    productImages,
    additionalImageUrls: productImages.map((image) => image.imageUrl),
    ratingBreakdown: {
      total: ratingCounts.total || 0,
      fiveStar: ratingCounts.fiveStar || 0,
      moderate: ratingCounts.moderate || 0,
      bad: ratingCounts.bad || 0
    },
    reviews
  };
}

module.exports = { listProducts, getProductById };
