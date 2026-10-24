const catalogRepository = require("../repositories/catalog.repository");
const { readCategories, flattenCategories } = require("./marketplace.shared");

function listProducts(query) {
  const result = catalogRepository.listProducts(query);
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

function getProduct(productId) {
  const product = catalogRepository.getProductById(productId);
  if (!product) return null;
  const category = flattenCategories(readCategories()).find((item) => item.id === product.categoryId);
  return {
    ...product,
    categoryPath: category?.pathString || "",
    categoryPathLabel: category?.pathLabel || product.category
  };
}

module.exports = { listProducts, getProduct };
