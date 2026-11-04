const { getCatalogRepository } = require("../repositories/catalog-repository-store");
const { readCategories, flattenCategories } = require("./marketplace.shared");

async function listProducts(query) {
  const result = await getCatalogRepository().listProducts(query);
  if (result.categoryNotFound) return result;
  const categoryLookup = new Map(flattenCategories(readCategories()).map((category) => [category.id, category]));
  function addCategoryPath(product) {
    const category = categoryLookup.get(product.categoryId);
    return {
      ...product,
      categoryPath: category?.pathString || "",
      categoryPathLabel: category?.pathLabel || product.category
    };
  }
  return {
    ...result,
    products: result.products.map(addCategoryPath),
    relatedProducts: result.relatedProducts.map(addCategoryPath)
  };
}

async function getProduct(productId) {
  const product = await getCatalogRepository().getProductById(productId);
  if (!product) return null;
  const category = flattenCategories(readCategories()).find((item) => item.id === product.categoryId);
  return {
    ...product,
    categoryPath: category?.pathString || "",
    categoryPathLabel: category?.pathLabel || product.category
  };
}

module.exports = { listProducts, getProduct };
