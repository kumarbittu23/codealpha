function formatRupees(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
  }).format(paise / 100);
}

module.exports = formatRupees;
