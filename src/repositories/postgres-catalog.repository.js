function createPostgresCatalogRepository(database) {
  async function rows(sql, parameters = []) {
    return (await database.query(sql, parameters)).rows;
  }

  return {
    async listProducts(query = {}) {
      const search = typeof query.search === "string" ? query.search.trim().slice(0, 80) : "";
      const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
      const limit = Math.min(48, Math.max(1, Number.parseInt(query.limit, 10) || 12));
      const offset = (page - 1) * limit;
      const conditions = ["sellers.status = 'active'", "categories.active = 1"];
      const parameters = [];
      if (search) {
        parameters.push(`%${search.toLowerCase()}%`);
        conditions.push(`(LOWER(products.name) LIKE $${parameters.length} OR LOWER(products.description) LIKE $${parameters.length})`);
      }
      const category = typeof query.category === "string" ? query.category.trim() : "";
      if (category && category !== "All") {
        parameters.push(category);
        conditions.push(`products.category = $${parameters.length}`);
      }
      const minPrice = Math.max(0, Number.parseInt(query.minPrice, 10) || 0);
      if (minPrice) {
        parameters.push(minPrice);
        conditions.push(`products.price_paise >= $${parameters.length}`);
      }
      const maxPrice = Math.max(0, Number.parseInt(query.maxPrice, 10) || 0);
      if (maxPrice) {
        parameters.push(maxPrice);
        conditions.push(`products.price_paise <= $${parameters.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const from = `FROM products
        JOIN sellers ON sellers.id = products.seller_id
        JOIN categories ON categories.id = products.category_id
        LEFT JOIN reviews ON reviews.product_id = products.id AND reviews.status = 'approved'
        ${where}`;
      const count = await rows(`SELECT COUNT(DISTINCT products.id)::integer AS total ${from}`, parameters);
      const orderBy = { price_low: "products.price_paise ASC", price_high: "products.price_paise DESC", newest: "products.id DESC" }[query.sort] || "products.featured DESC, products.id DESC";
      parameters.push(limit, offset);
      const products = await rows(`SELECT DISTINCT products.id, products.name, products.sku, products.category,
        products.category_id AS "categoryId", products.description, products.price_paise AS "pricePaise",
        products.image_url AS "imageUrl", products.stock, products.featured,
        sellers.store_name AS "sellerName", categories.slug AS "categorySlug", categories.name AS "categoryName",
        COALESCE(AVG(reviews.rating), 0)::float AS "averageRating", COUNT(reviews.id)::integer AS "reviewCount"
        ${from} GROUP BY products.id, sellers.store_name, categories.slug, categories.name
        ORDER BY ${orderBy} LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`, parameters);
      const categories = await rows("SELECT DISTINCT products.category FROM products JOIN sellers ON sellers.id = products.seller_id JOIN categories ON categories.id = products.category_id WHERE sellers.status = 'active' AND categories.active = 1 ORDER BY products.category");
      const total = Number(count[0]?.total || 0);
      return { products, relatedProducts: [], categories: categories.map((item) => item.category), categoryTree: [], pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },

    async getProductById(productId) {
      const products = await rows(`SELECT products.id, products.name, products.sku, products.category,
        products.category_id AS "categoryId", products.description, products.price_paise AS "pricePaise",
        products.image_url AS "imageUrl", products.stock, products.featured,
        sellers.store_name AS "sellerName", categories.slug AS "categorySlug", categories.name AS "categoryName",
        COALESCE(AVG(reviews.rating), 0)::float AS "averageRating", COUNT(reviews.id)::integer AS "reviewCount"
        FROM products JOIN sellers ON sellers.id = products.seller_id
        JOIN categories ON categories.id = products.category_id
        LEFT JOIN reviews ON reviews.product_id = products.id AND reviews.status = 'approved'
        WHERE products.id = $1 AND sellers.status = 'active' AND categories.active = 1
        GROUP BY products.id, sellers.store_name, categories.slug, categories.name`, [productId]);
      if (!products.length) return null;
      const product = products[0];
      const productImages = await rows(`SELECT image_url AS "imageUrl", model_profile AS "modelProfile", view_label AS "viewLabel"
        FROM product_images WHERE product_id = $1 ORDER BY display_order, id`, [productId]);
      const reviews = await rows(`SELECT reviews.id, reviews.rating, reviews.body, reviews.created_at AS "createdAt",
        reviews.image_mime AS "imageMime", users.name AS "reviewerName",
        CASE WHEN reviews.image_data IS NULL THEN 1 ELSE 0 END AS "hasImage"
        FROM reviews JOIN users ON users.id = reviews.user_id
        WHERE reviews.product_id = $1 AND reviews.status = 'approved' ORDER BY reviews.id DESC LIMIT 20`, [productId]);
      const breakdown = await rows(`SELECT COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE rating = 5)::integer AS "fiveStar",
        COUNT(*) FILTER (WHERE rating BETWEEN 3 AND 4)::integer AS moderate,
        COUNT(*) FILTER (WHERE rating BETWEEN 1 AND 2)::integer AS bad
        FROM reviews WHERE product_id = $1 AND status = 'approved'`, [productId]);
      return { ...product, productImages, additionalImageUrls: productImages.map((image) => image.imageUrl), ratingBreakdown: breakdown[0], reviews };
    }
  };
}

module.exports = createPostgresCatalogRepository;
