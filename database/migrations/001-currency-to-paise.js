function renameLegacyAmount(database, table, oldColumn, newColumn) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((column) => column.name === oldColumn) && !columns.some((column) => column.name === newColumn)) {
    database.exec(`ALTER TABLE ${table} RENAME COLUMN ${oldColumn} TO ${newColumn}`);
    database.exec(`UPDATE ${table} SET ${newColumn} = ${newColumn} * 83`);
  }
}

function migrateLegacyCurrency(database) {
  renameLegacyAmount(database, "products", "price_cents", "price_paise");
  renameLegacyAmount(database, "orders", "total_cents", "total_paise");
  renameLegacyAmount(database, "order_items", "price_cents", "price_paise");
}

module.exports = migrateLegacyCurrency;
